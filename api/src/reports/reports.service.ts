import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Msg91Service } from '../notifications/msg91.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import {
  EmailReportsConfig,
  DEFAULT_ASM_RECCE_REMINDER,
  mergeEmailReportsConfig,
  readEmailReportsConfig,
} from './reports.config';
import { istDateLabel, istDateOnlyUtc, istHour } from './reports.time';
import { UpdateEmailReportsConfigDto } from './dto/update-email-reports-config.dto';
import { ListOutletReportDto } from './dto/list-outlet-report.dto';
import { tenantScope } from '../common/tenant-scope';
import { streamXlsx } from '../common/xlsx';
import type { Readable } from 'node:stream';
import {
  OUTLET_REPORT_COLUMNS,
  buildOutletExecutionRow,
  type RepSite,
} from './outlet-execution.helper';

/** Rows pulled per DB round-trip while streaming the xlsx — bounds peak memory, not the total. */
const OUTLET_EXPORT_BATCH = 1_000;

/** Prisma include that feeds the Outlet Execution row builder (one live recce + its install). */
const OUTLET_REPORT_INCLUDE = {
  vendor: { select: { name: true } },
  recces: {
    // `include` (not `select`) returns ALL Recce scalars, so the report's RepRecce fields —
    // status, the ASM rejectionReason*, and the recce-side HO-approval fields (hoReviewStatus,
    // hoRejectionReason*) — all flow through to buildOutletExecutionRow without an explicit select.
    include: {
      submittedBy: { select: { name: true, promoterCode: true } },
      posms: { include: { posmType: { select: { name: true } } } },
    },
  },
  installs: {
    include: {
      submittedBy: { select: { name: true, promoterCode: true } },
      posms: { select: { reccePosmId: true, captureLat: true, captureLng: true, distanceFromRecce: true } },
    },
  },
} satisfies Prisma.SiteInclude;

/** The raw digest counts for one tenant (all tenant-scoped, never cross-tenant). */
export interface DigestCounts {
  pendingRecceReview: number;
  pendingHoReview: number;
  pendingInstallAudit: number;
  openManualTasks: number;
  manualPendingReview: number;
  staleRecces: number;
  staleInstalls: number;
  approvedRecceLast24h: number;
  rejectedRecceLast24h: number;
}

/** The digest-type discriminator stored on EmailDigestLog (idempotency ledger). */
const DAILY_DIGEST = 'DAILY_DIGEST';

/**
 * ReportsService — the automated per-tenant email digest (pending work + stale-item reminders).
 *
 * Config lives on `Client.settings.emailReports` (settings-backed, merged without clobbering
 * siblings). Counts are computed DIRECTLY with tenant-scoped Prisma counts (NOT via
 * AnalyticsService) — every query pins ONE clientId, so a digest can never leak another tenant's
 * rows. Delivery reuses the chassis MSG91 SMTP transport (Msg91Service.sendEmail), which has a
 * DEV bypass that LOGS instead of sending when MSG91_SMTP_PASS is unset (fully testable locally).
 *
 * The hourly cron (see reports.cron.ts) calls {@link runDailyDigestCron}; idempotency is the
 * `EmailDigestLog` unique ledger (clientId, digestType, forDate) — a P2002 means "already sent
 * today" so a restart / double-fire never double-emails.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly msg91: Msg91Service,
  ) {}

  // ── Config (tenant-scoped by the caller's clientId) ───────────────────────────────

  /** GET /v1/reports/config — the tenant's emailReports config (defaults when unset). */
  async getConfig(user: JwtPayload): Promise<EmailReportsConfig> {
    const client = await this.prisma.client.findUnique({
      where: { id: user.clientId },
      select: { settings: true },
    });
    return readEmailReportsConfig(client?.settings);
  }

  /**
   * PUT /v1/reports/config — validate (DTO) + de-dup recipients (case-insensitive), MERGE into
   * Client.settings without clobbering sibling keys, return the saved config. Field-level rules
   * (valid emails, hour 0–23, thresholds >= 1) are enforced by the DTO; this normalizes.
   */
  async putConfig(
    user: JwtPayload,
    dto: UpdateEmailReportsConfigDto,
  ): Promise<EmailReportsConfig> {
    const config: EmailReportsConfig = {
      enabled: dto.enabled,
      recipients: this.dedupeEmails(dto.recipients),
      sendHourLocal: dto.sendHourLocal,
      staleRecceHours: dto.staleRecceHours,
      staleInstallHours: dto.staleInstallHours,
      asmRecceReminders: dto.asmRecceReminders ?? DEFAULT_ASM_RECCE_REMINDER,
    };

    // Read-modify-write the settings blob so the emailReports key merges in WITHOUT clobbering
    // posmCapture / geoFence / any other sibling setting on the same tenant. Wrapped in an
    // interactive transaction (re-read + merge + write on one connection) to shrink the
    // lost-update window against a concurrent settings writer. NOTE: this is a mitigation, not
    // a hard lock — a fully race-safe fix (SELECT … FOR UPDATE / JSON-path write) is a broader
    // settings-layer concern shared by every settings editor; tracked as a residual.
    await this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({
        where: { id: user.clientId },
        select: { settings: true },
      });
      const merged = mergeEmailReportsConfig(client?.settings, config);
      await tx.client.update({
        where: { id: user.clientId },
        data: { settings: merged as Prisma.InputJsonValue },
      });
    });
    return config;
  }

  // ── Preview + manual send ─────────────────────────────────────────────────────────

  /** GET /v1/reports/preview — the rendered digest HTML + raw counts, WITHOUT sending. */
  async preview(user: JwtPayload): Promise<{ html: string; counts: DigestCounts }> {
    const now = new Date();
    const config = await this.getConfig(user);
    const { name } = await this.tenantName(user.clientId);
    const counts = await this.computeCounts(user.clientId, config, now);
    const html = this.buildDigestHtml(name, counts, now);
    return { html, counts };
  }

  /**
   * POST /v1/reports/send-now — build + email the digest to the configured recipients NOW (admin
   * test). Does NOT consult / insert the idempotency ledger (it is a manual test send, exempt
   * from the once-per-day guard). 400 when no recipients are configured.
   */
  async sendNow(
    user: JwtPayload,
  ): Promise<{ sent: boolean; recipients: string[]; html: string }> {
    const now = new Date();
    const config = await this.getConfig(user);
    if (config.recipients.length === 0) {
      throw new BadRequestException('no recipients configured');
    }
    const { name } = await this.tenantName(user.clientId);
    const counts = await this.computeCounts(user.clientId, config, now);
    const html = this.buildDigestHtml(name, counts, now);
    const subject = this.subject(name, now);

    await this.msg91.sendEmail({ to: config.recipients, subject, html });
    this.logger.log(
      `send-now: digest for "${name}" (${user.clientId}) sent to ${config.recipients.length} recipient(s)`,
    );
    return { sent: true, recipients: config.recipients, html };
  }

  // ── Scheduled sweep (called by the hourly cron) ────────────────────────────────────

  /**
   * Hourly idempotent sweep. For EACH client whose emailReports is enabled AND whose
   * sendHourLocal === the current IST hour AND has >= 1 recipient: claim today's slot in the
   * EmailDigestLog unique ledger, then build + send. A P2002 on the claim means the digest was
   * already sent today (restart / double-fire) → skip. Every tenant is wrapped so one failure
   * never aborts the loop. `now` is injectable for tests (defaults to real time).
   */
  async runDailyDigestCron(now: Date = new Date()): Promise<void> {
    const currentHour = istHour(now);
    const forDate = istDateOnlyUtc(now);

    let clients: { id: string; name: string; settings: unknown }[];
    try {
      clients = await this.prisma.client.findMany({
        select: { id: true, name: true, settings: true },
      });
    } catch (e) {
      this.logger.error(`digest cron: failed to list clients: ${this.reason(e)}`);
      return;
    }

    for (const client of clients) {
      try {
        const config = readEmailReportsConfig(client.settings);
        if (!config.enabled) continue;
        // Fire from the configured hour ONWARD (not only exactly at it), so a transient send
        // failure earlier in the day is retried on the next hourly tick until it succeeds —
        // at-least-once WITHIN the day. The ledger (claimed below, rolled back on failure)
        // still makes it exactly-once on success: after a successful send every later hour
        // P2002s and skips. A digest that never succeeds by day-end is dropped (forDate rolls).
        if (currentHour < config.sendHourLocal) continue;
        if (config.recipients.length === 0) {
          this.logger.log(
            `digest cron: "${client.name}" (${client.id}) is enabled at hour ${currentHour} but has 0 recipients — skipping`,
          );
          continue;
        }

        // Build BEFORE claiming the ledger so the snapshot in meta is accurate; the claim is the
        // idempotency point. (Building is read-only, so a lost race just discards the work.)
        const counts = await this.computeCounts(client.id, config, now);

        // Idempotency claim — INSERT today's ledger row. A P2002 means another fire (or a prior
        // run today) already sent, so skip WITHOUT emailing. The row is only created AFTER the
        // recipients check, so a logged row always implies a real send attempt.
        try {
          await this.prisma.emailDigestLog.create({
            data: {
              clientId: client.id,
              digestType: DAILY_DIGEST,
              forDate,
              meta: { recipients: config.recipients, counts } as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (e) {
          if (this.isUniqueViolation(e)) {
            this.logger.log(
              `digest cron: "${client.name}" (${client.id}) already sent for ${forDate.toISOString().slice(0, 10)} — skipping`,
            );
            continue;
          }
          throw e;
        }

        const html = this.buildDigestHtml(client.name, counts, now);
        const subject = this.subject(client.name, now);
        try {
          await this.msg91.sendEmail({ to: config.recipients, subject, html });
        } catch (sendErr) {
          // The claim was committed before the send; roll it back so a LATER hour today re-tries
          // (never lose a day's digest to a transient SMTP failure). A rare duplicate on a
          // partial failure is an acceptable trade for a reminder digest.
          await this.prisma.emailDigestLog
            .delete({
              where: { clientId_digestType_forDate: { clientId: client.id, digestType: DAILY_DIGEST, forDate } },
            })
            .catch(() => undefined);
          this.logger.error(
            `digest cron: send failed for "${client.name}" (${client.id}) — rolled back the claim to retry this day: ${this.reason(sendErr)}`,
          );
          continue;
        }
        this.logger.log(
          `digest cron: sent "${client.name}" (${client.id}) to ${config.recipients.length} recipient(s)`,
        );
      } catch (e) {
        // One tenant's failure must NEVER abort the sweep for the others.
        this.logger.error(
          `digest cron: tenant ${client.id} failed: ${this.reason(e)}`,
        );
      }
    }
  }

  // ── Per-ASM pending-recce reminders (threshold-triggered) ──────────────────────────

  /**
   * Email EACH ASM the list of THEIR outlets whose recce is still pending their approval beyond the
   * tenant's `thresholdHours`, with days-pending per outlet. Threshold-triggered (runs every hourly
   * tick); a per-recce `lastRemindedAt` ledger re-reminds a given recce at most every
   * `reminderIntervalHours`, so an ASM is not spammed. Targeted to the ASM's own email — tenant-
   * scoped on every query. One tenant's (or one ASM's) failure never aborts the rest.
   */
  async runAsmRecceReminders(now: Date = new Date()): Promise<void> {
    let clients: { id: string; name: string; settings: unknown }[];
    try {
      clients = await this.prisma.client.findMany({ select: { id: true, name: true, settings: true } });
    } catch (e) {
      this.logger.error(`asm-reminder cron: failed to list clients: ${this.reason(e)}`);
      return;
    }

    for (const client of clients) {
      try {
        const cfg = readEmailReportsConfig(client.settings).asmRecceReminders;
        if (!cfg.enabled) continue;

        const thresholdCutoff = new Date(now.getTime() - cfg.thresholdHours * 3_600_000);
        const remindCutoff = new Date(now.getTime() - cfg.reminderIntervalHours * 3_600_000);

        // Eligible: a SUBMITTED recce (pending ASM approval) in this tenant, received before the
        // threshold, on a site that HAS an assigned ASM, and not reminded within the interval.
        const recces = await this.prisma.recce.findMany({
          where: {
            clientId: client.id,
            status: 'SUBMITTED',
            receivedAt: { lte: thresholdCutoff },
            site: { asmUserId: { not: null } },
            OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: remindCutoff } }],
          },
          select: {
            id: true,
            receivedAt: true,
            site: {
              select: {
                code: true, name: true, town: true, asmUserId: true,
                asm: { select: { email: true, name: true, isActive: true } },
              },
            },
          },
        });
        if (recces.length === 0) continue;

        // Group by the assigned ASM — only ACTIVE ASMs with an email can be mailed (others stay
        // eligible, un-stamped, so they are picked up once that ASM has an email/is reactivated).
        interface Grp { email: string; name: string; ids: string[]; items: { label: string; days: number; hours: number }[] }
        const byAsm = new Map<string, Grp>();
        for (const r of recces) {
          const asm = r.site.asm;
          if (!asm || !asm.isActive || !asm.email) continue;
          const hours = Math.floor((now.getTime() - r.receivedAt.getTime()) / 3_600_000);
          const days = Math.floor(hours / 24);
          const key = r.site.asmUserId as string;
          let g = byAsm.get(key);
          if (!g) { g = { email: asm.email, name: asm.name, ids: [], items: [] }; byAsm.set(key, g); }
          g.ids.push(r.id);
          g.items.push({ label: `${r.site.name} (${r.site.code})${r.site.town ? ` — ${r.site.town}` : ''}`, days, hours });
        }

        // Idempotency window = the reminder-INTERVAL bucket (epoch-aligned), NOT the hour. Keying the
        // ledger to the full interval (like the daily digest keys to the whole day) makes the CLAIM
        // the sole cross-tick guard: two instances in the same window collide on the unique key, and a
        // post-send fault that fails to stamp `lastRemindedAt` still can't re-send within the window
        // because the claim row persists. `lastRemindedAt` is then just a belt-and-suspenders filter.
        const windowMs = cfg.reminderIntervalHours * 3_600_000;
        const periodKey = String(Math.floor(now.getTime() / windowMs));

        for (const [asmUserId, g] of byAsm.entries()) {
          // Longest-pending first — the most urgent at the top.
          g.items.sort((a, b) => b.hours - a.hours);

          // Idempotency CLAIM — insert this ASM's ledger row for the current tick BEFORE emailing.
          // A P2002 means another instance/fire already claimed this (clientId, asmUserId, periodKey)
          // → skip WITHOUT sending, which kills the multi-instance duplicate-email race. Mirrors the
          // daily digest's EmailDigestLog claim. (`lastRemindedAt` stays the across-tick throttle.)
          try {
            await this.prisma.asmReminderLog.create({
              data: { clientId: client.id, asmUserId, periodKey, itemCount: g.items.length },
            });
          } catch (claimErr) {
            if (this.isUniqueViolation(claimErr)) {
              this.logger.log(`asm-reminder: "${client.name}" → ${g.email} already sent for ${periodKey} — skipping`);
              continue;
            }
            throw claimErr;
          }

          const subject = `${g.items.length} recce${g.items.length === 1 ? '' : 's'} pending your approval — ${client.name}`;
          const html = this.buildAsmReminderHtml(client.name, g.name, g.items, now);

          // SEND is the only failure that rolls back the claim: a genuine SMTP failure means no email
          // went out, so release the window and let a later tick retry (at-least-once).
          try {
            await this.msg91.sendEmail({ to: [g.email], subject, html });
          } catch (sendErr) {
            await this.prisma.asmReminderLog
              .delete({ where: { clientId_asmUserId_periodKey: { clientId: client.id, asmUserId, periodKey } } })
              .catch(() => undefined);
            this.logger.error(`asm-reminder: send failed for ${g.email} (${client.id}) — rolled back the claim: ${this.reason(sendErr)}`);
            continue;
          }

          // The email WENT OUT. Stamp the included recces as reminded — but if THIS write fails, do NOT
          // roll back the claim: the interval-bucket claim row already prevents a re-send for this window,
          // so a failed stamp degrades to the ledger guard instead of causing a repeating duplicate email.
          try {
            await this.prisma.recce.updateMany({ where: { id: { in: g.ids } }, data: { lastRemindedAt: now } });
          } catch (stampErr) {
            this.logger.error(`asm-reminder: emailed ${g.email} but failed to stamp lastRemindedAt (ledger still guards the window): ${this.reason(stampErr)}`);
          }
          this.logger.log(`asm-reminder: "${client.name}" → ${g.email} (${g.items.length} pending)`);
        }
      } catch (e) {
        this.logger.error(`asm-reminder cron: tenant ${client.id} failed: ${this.reason(e)}`);
      }
    }
  }

  /**
   * Retention sweep for the idempotency ledgers (AsmReminderLog + EmailDigestLog). A ledger row only
   * matters inside its own window (an hour-to-day idempotency bucket), so anything older than
   * `retentionDays` is dead weight and safe to delete — it can never affect a current claim. Keeps the
   * two append-only ledgers from growing unbounded. Called once a day from the cron; failure is logged,
   * never thrown.
   */
  async pruneStaleLedgers(now: Date = new Date(), retentionDays = 30): Promise<void> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 3_600_000);
    try {
      const [reminders, digests] = await Promise.all([
        this.prisma.asmReminderLog.deleteMany({ where: { sentAt: { lt: cutoff } } }),
        this.prisma.emailDigestLog.deleteMany({ where: { sentAt: { lt: cutoff } } }),
      ]);
      if (reminders.count || digests.count) {
        this.logger.log(
          `ledger prune: removed ${reminders.count} asm-reminder + ${digests.count} digest row(s) older than ${retentionDays}d`,
        );
      }
    } catch (e) {
      this.logger.error(`ledger prune failed: ${this.reason(e)}`);
    }
  }

  /** Build the per-ASM reminder email — a table of pending outlets + how long each has waited. */
  buildAsmReminderHtml(
    tenantName: string,
    asmName: string,
    items: { label: string; days: number; hours: number }[],
    now: Date,
  ): string {
    const esc = (s: string) => this.escapeHtml(s);
    const age = (it: { days: number; hours: number }) =>
      it.days >= 1 ? `${it.days} day${it.days === 1 ? '' : 's'}` : `${it.hours}h`;
    const rows = items
      .map(
        (it) =>
          `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${esc(it.label)}</td>` +
          `<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;font-weight:600;color:${it.days >= 3 ? '#b91c1c' : '#b45309'};">${age(it)}</td></tr>`,
      )
      .join('');
    return (
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:640px;">` +
      `<p>Hi ${esc(asmName)},</p>` +
      `<p>You have <strong>${items.length}</strong> recce${items.length === 1 ? '' : 's'} pending your approval for <strong>${esc(tenantName)}</strong>. Please review and approve (or reject) them.</p>` +
      `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0;">` +
      `<thead><tr><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #ddd;">Outlet</th>` +
      `<th style="text-align:right;padding:8px 12px;border-bottom:2px solid #ddd;">Pending</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      `<p style="color:#666;font-size:12px;">Items pending 3+ days are shown in red. This is an automated reminder — reply is not monitored.</p>` +
      `</div>`
    );
  }

  // ── Counts (tenant-scoped — the isolation chokepoint) ──────────────────────────────

  /**
   * The digest counts for ONE tenant. EVERY query pins `clientId`, so no count can include
   * another tenant's rows. Stale windows and the last-24h windows are computed from `now`
   * (injectable) so the numbers are deterministic in tests.
   */
  async computeCounts(
    clientId: string,
    config: EmailReportsConfig,
    now: Date,
  ): Promise<DigestCounts> {
    const staleRecceBefore = new Date(now.getTime() - config.staleRecceHours * 3_600_000);
    const staleInstallBefore = new Date(now.getTime() - config.staleInstallHours * 3_600_000);
    const since24h = new Date(now.getTime() - 24 * 3_600_000);

    const [
      pendingRecceReview,
      pendingHoReview,
      pendingInstallAudit,
      openManualTasks,
      manualPendingReview,
      staleRecces,
      staleInstalls,
      approvedRecceLast24h,
      rejectedRecceLast24h,
    ] = await Promise.all([
      this.prisma.recce.count({ where: { clientId, status: 'SUBMITTED' } }),
      // ASM-approved recces still awaiting HO sign-off (the new stage between ASM approval and
      // install). Invisible to the SUBMITTED-only counts above, so counted explicitly here.
      this.prisma.recce.count({ where: { clientId, status: 'APPROVED', hoReviewStatus: 'PENDING' } }),
      this.prisma.installation.count({ where: { clientId, status: 'SUBMITTED' } }),
      this.prisma.manualTask.count({ where: { clientId, status: 'OPEN' } }),
      this.prisma.manualTaskSubmission.count({ where: { clientId, status: 'SUBMITTED' } }),
      this.prisma.recce.count({
        where: { clientId, status: 'SUBMITTED', receivedAt: { lt: staleRecceBefore } },
      }),
      this.prisma.installation.count({
        where: { clientId, status: 'SUBMITTED', receivedAt: { lt: staleInstallBefore } },
      }),
      this.prisma.recce.count({
        where: { clientId, status: 'APPROVED', reviewedAt: { gte: since24h } },
      }),
      this.prisma.recce.count({
        where: { clientId, status: 'REJECTED', reviewedAt: { gte: since24h } },
      }),
    ]);

    return {
      pendingRecceReview,
      pendingHoReview,
      pendingInstallAudit,
      openManualTasks,
      manualPendingReview,
      staleRecces,
      staleInstalls,
      approvedRecceLast24h,
      rejectedRecceLast24h,
    };
  }

  // ── HTML rendering (self-contained, inline styles, no external assets) ─────────────

  /** The subject line: `POSM daily digest — <tenant> — <YYYY-MM-DD (IST)>`. */
  private subject(tenantName: string, now: Date): string {
    return `Elements daily digest — ${tenantName} — ${istDateLabel(now)}`;
  }

  /**
   * Render the digest as a self-contained HTML email — header, a small counts table, and a
   * "needs attention" callout when stale counts > 0. Inline styles only (email clients strip
   * <style>/external CSS); every dynamic value is HTML-escaped.
   */
  buildDigestHtml(tenantName: string, counts: DigestCounts, now: Date): string {
    const date = istDateLabel(now);
    const staleTotal = counts.staleRecces + counts.staleInstalls;
    const esc = (s: string) => this.escapeHtml(s);

    const row = (label: string, value: number, emphasize = false): string => {
      const valStyle = emphasize && value > 0
        ? 'color:#b91c1c;font-weight:700;'
        : 'color:#111827;font-weight:600;';
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;">${esc(label)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px;${valStyle}">${value}</td>
        </tr>`;
    };

    const callout = staleTotal > 0
      ? `
      <div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
        <div style="color:#b91c1c;font-weight:700;font-size:14px;margin-bottom:4px;">⚠ Needs attention</div>
        <div style="color:#7f1d1d;font-size:13px;">
          ${counts.staleRecces} stale recce${counts.staleRecces === 1 ? '' : 's'}
          and ${counts.staleInstalls} stale installation${counts.staleInstalls === 1 ? '' : 's'}
          have been waiting past their review threshold.
        </div>
      </div>`
      : '';

    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="background:#111827;padding:20px 24px;">
          <div style="color:#ffffff;font-size:18px;font-weight:700;">Elements daily digest</div>
          <div style="color:#9ca3af;font-size:13px;margin-top:2px;">${esc(tenantName)} &middot; ${esc(date)}</div>
        </div>
        <div style="padding:20px 24px;">
          ${callout}
          <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Pending work</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
            ${row('Recces awaiting review', counts.pendingRecceReview)}
            ${row('Recces awaiting HO approval', counts.pendingHoReview)}
            ${row('Installations awaiting audit', counts.pendingInstallAudit)}
            ${row('Open manual tasks', counts.openManualTasks)}
            ${row('Manual submissions awaiting review', counts.manualPendingReview)}
            ${row('Stale recces (past threshold)', counts.staleRecces, true)}
            ${row('Stale installations (past threshold)', counts.staleInstalls, true)}
          </table>
          <div style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Last 24 hours</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${row('Recces approved', counts.approvedRecceLast24h)}
            ${row('Recces rejected', counts.rejectedRecceLast24h)}
          </table>
        </div>
        <div style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
          Automated digest from the Element platform. Manage recipients in Settings &rarr; Email reports.
        </div>
      </div>
    </div>
  </body>
</html>`;
  }

  // ── Internals ──────────────────────────────────────────────────────────────────────

  /** Case-insensitive de-dup, preserving first-seen order + original casing. */
  private dedupeEmails(recipients: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of recipients) {
      const email = r.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
    return out;
  }

  private async tenantName(clientId: string): Promise<{ name: string }> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true },
    });
    return { name: client?.name ?? 'Tenant' };
  }

  private isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  private reason(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Outlet Execution Report (owner spec 2026-09-30) ─────────────────────────────────

  /**
   * The tenant/vendor `where` for the report. Tenant-scoped like the admin dashboards: a
   * CLIENT_ADMIN / assumed operator is pinned to their tenant; an un-assumed GIFSY_ADMIN is
   * platform-wide (scope === undefined ⇒ no clientId filter). Text filters are ci-`contains`.
   */
  private outletReportWhere(user: JwtPayload, q: ListOutletReportDto): Prisma.SiteWhereInput {
    const where: Prisma.SiteWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    if (q.siteCode) where.code = { contains: q.siteCode, mode: 'insensitive' };
    if (q.town) where.town = { contains: q.town, mode: 'insensitive' };
    if (q.region) where.region = { contains: q.region, mode: 'insensitive' };
    if (q.state) where.state = { contains: q.state, mode: 'insensitive' };
    if (q.vendorId) where.vendorId = q.vendorId;
    return where;
  }

  /** Load matching sites (with the report include) and map each to an ordered report row. */
  private async loadOutletRows(
    user: JwtPayload,
    q: ListOutletReportDto,
    skip: number,
    take: number,
  ): Promise<{ rows: Record<string, string>[]; total: number }> {
    const where = this.outletReportWhere(user, q);
    const [sites, total] = await Promise.all([
      this.prisma.site.findMany({
        where,
        // `id` tiebreaker (matching the xlsx export): Site.code is unique only PER tenant, so the
        // un-assumed GIFSY platform-wide view can have two tenants share a code — without a unique
        // tiebreaker, skip/take paging could skip or duplicate a row across pages.
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip,
        take,
        include: OUTLET_REPORT_INCLUDE,
      }),
      this.prisma.site.count({ where }),
    ]);
    const rows = sites.map((s) => buildOutletExecutionRow(s as unknown as RepSite));
    return { rows, total };
  }

  /** GET /v1/reports/outlet-execution — one paginated page of the report for the on-screen table. */
  async outletExecution(user: JwtPayload, q: ListOutletReportDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(500, Math.max(1, q.limit ?? 50));
    const { rows, total } = await this.loadOutletRows(user, q, (page - 1) * limit, limit);
    return { columns: [...OUTLET_REPORT_COLUMNS], rows, total, page, limit };
  }

  /**
   * GET /v1/reports/outlet-execution.xlsx — EVERY matching row as a streamed .xlsx (no row cap).
   * Rows are pulled in {@link OUTLET_EXPORT_BATCH}-sized pages by a stable `id` cursor (unique, so
   * inserts during a long export can't skip or duplicate rows) and written straight to the response
   * stream, so peak memory is one batch regardless of tenant size. The explicit header list keeps a
   * zero-row export as a header-only sheet. Returns a Readable the controller hands to StreamableFile.
   */
  outletExecutionXlsxStream(user: JwtPayload, q: ListOutletReportDto): Readable {
    const where = this.outletReportWhere(user, q);
    let cursorId: string | undefined;
    let exhausted = false;

    const nextBatch = async (): Promise<Record<string, string>[]> => {
      if (exhausted) return [];
      const sites = await this.prisma.site.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take: OUTLET_EXPORT_BATCH,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        include: OUTLET_REPORT_INCLUDE,
      });
      if (sites.length < OUTLET_EXPORT_BATCH) exhausted = true;
      if (sites.length > 0) cursorId = sites[sites.length - 1].id;
      return sites.map((s) => buildOutletExecutionRow(s as unknown as RepSite));
    };

    return streamXlsx({
      sheetName: 'Outlet Execution',
      headers: [...OUTLET_REPORT_COLUMNS],
      nextBatch,
    });
  }
}
