import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PptxGenJS from 'pptxgenjs';
import { Jimp, defaultFormats } from 'jimp';
import { PrismaService } from '../prisma/prisma.service';
import { Msg91Service } from '../notifications/msg91.service';
import { PosmMediaService } from '../capture/posm-media.service';
import { sniffImageMime } from '../media/watermark.util';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import {
  DEFAULT_SLIDE_LAYOUT,
  planRecceSlide,
  planInstalledSlide,
  pptxDimsLabel,
  type PlanElementInput,
  type SlidePlan,
} from './outlet-pptx.helper';
import { readPhoto, columnsForMode, type RepRecce, type ReportMode } from './outlet-execution.helper';
import {
  EmailReportsConfig,
  DEFAULT_ASM_RECCE_REMINDER,
  mergeEmailReportsConfig,
  readEmailReportsConfig,
} from './reports.config';
import { istDateLabel, istDateOnlyUtc, istHour } from './reports.time';
import { UpdateEmailReportsConfigDto } from './dto/update-email-reports-config.dto';
import { ListOutletReportDto } from './dto/list-outlet-report.dto';
import { tenantScope, vendorScope } from '../common/tenant-scope';
import { streamXlsx, type HyperlinkCell } from '../common/xlsx';
import type { Readable } from 'node:stream';
import {
  buildOutletExecutionRows,
  mediaHyperlinkTarget,
  type Cell,
  type ReportColumn,
  type ReportRow,
  type RepSite,
} from './outlet-execution.helper';

/** Rows pulled per DB round-trip while streaming the xlsx — bounds peak memory, not the total. */
const OUTLET_EXPORT_BATCH = 1_000;

/** The header band colour (a clean brand-ish green) for the Recce Report PPT slides. */
const PPTX_HEADER_GREEN = '1F7A3D';
/** Max outlets per PPT export (owner spec) — keeps full-res base64 images bounded in memory. */
const PPTX_MAX_OUTLETS = 3;
/**
 * Longest-side cap (px) for an embedded recce photo. Phone photos are multi-thousand-px; downscaling
 * to this before the JPEG re-encode bounds each slide's image bytes (and peak memory) for EVERY
 * export, while staying sharp on a 13.33in-wide slide. Aspect is always preserved (scaleToFit).
 */
const PPTX_IMG_MAX_PX = 1280;

/**
 * jimp image decoders, built ONCE from jimp's bundled default formats and used DIRECTLY (not via
 * `Jimp.read`, which lazily `import()`s the pure-ESM `file-type` — throwing under the CommonJS Jest
 * VM). Mirrors the decode path in `media/watermark.util`. A webp / PDF / corrupt buffer has no
 * decoder → the element renders caption-only rather than crashing the export.
 */
let PPTX_DECODERS: Map<
  string,
  (buffer: Buffer) => Promise<{ data: Buffer; width: number; height: number }>
> | null = null;
function pptxDecoders() {
  if (!PPTX_DECODERS) {
    PPTX_DECODERS = new Map();
    for (const make of defaultFormats) {
      const fmt = make();
      if (fmt.decode) PPTX_DECODERS.set(fmt.mime, fmt.decode as never);
    }
  }
  return PPTX_DECODERS;
}

/**
 * Prisma include that feeds the curated Recce Report row builder. ONE ROW PER RECCE: load ALL of the
 * outlet's recces (1 app + N manual). `include` (not `select`) returns ALL Recce scalars — recceMode,
 * status, hoReviewStatus, capturedAt/receivedAt, and the ASM/HO approval stamps (reviewedAt,
 * hoReviewedAt) — so the RepRecce fields flow through without an explicit select. Only the USER
 * relations (submittedBy for the promoter id, approvedBy + hoReviewedBy for the excel-only audit
 * trail) and the per-element POSMs (with their dimensions + photo JSON) are pulled explicitly.
 * Recces are ordered app-first then manual oldest-first (matching the helper's sort) for a stable,
 * page-safe row order.
 */
const OUTLET_REPORT_INCLUDE_RECCE = {
  // The servicing vendor's name feeds the "Vendor" report column (the vendorId filter targets this
  // relation) — select only `name`, never the whole Vendor row.
  vendor: { select: { name: true } },
  recces: {
    orderBy: [{ recceMode: 'asc' }, { receivedAt: 'asc' }, { id: 'asc' }],
    include: {
      submittedBy: { select: { promoterCode: true } },
      approvedBy: { select: { name: true } },
      hoReviewedBy: { select: { name: true } },
      posms: { include: { posmType: { select: { name: true } } } },
    },
  },
} satisfies Prisma.SiteInclude;

/**
 * The INSTALLED-mode include — the recce include PLUS the per-recce installation (status, dates, the
 * installer's promoterCode, the install auditor) AND, on each recce POSM, its 1:1 InstallPosm (photo,
 * geo, distance). Kept SEPARATE from the recce include so recce-mode queries stay lean (they never
 * load the install relations).
 */
const OUTLET_REPORT_INCLUDE_INSTALLED = {
  vendor: { select: { name: true } },
  recces: {
    orderBy: [{ recceMode: 'asc' }, { receivedAt: 'asc' }, { id: 'asc' }],
    include: {
      submittedBy: { select: { promoterCode: true } },
      approvedBy: { select: { name: true } },
      hoReviewedBy: { select: { name: true } },
      posms: { include: { posmType: { select: { name: true } }, installPosm: true } },
      installation: {
        include: {
          submittedBy: { select: { promoterCode: true } },
          auditedBy: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.SiteInclude;

/** The report include for a mode: the lean recce include, or the installed include with the install
 *  relations folded in. */
function outletReportInclude(mode: ReportMode): Prisma.SiteInclude {
  return mode === 'installed' ? OUTLET_REPORT_INCLUDE_INSTALLED : OUTLET_REPORT_INCLUDE_RECCE;
}

/** Normalise the DTO's `mode` query param to the report variant (default `recce`). */
function reportMode(mode: string | undefined): ReportMode {
  return mode === 'installed' ? 'installed' : 'recce';
}

/** The raw digest counts for one tenant (all tenant-scoped, never cross-tenant). */
export interface DigestCounts {
  pendingRecceReview: number;
  pendingHoReview: number;
  pendingInstallAudit: number;
  openManualTasks: number;
  manualPendingReview: number;
  staleRecces: number;
  staleInstalls: number;
  /** Recces ASM-approved in the last 24h (status APPROVED, regardless of HO). */
  approvedRecceLast24h: number;
  /** Recces HO-approved (installable) in the last 24h (status APPROVED && hoReviewStatus APPROVED). */
  hoApprovedRecceLast24h: number;
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
    private readonly posmMedia: PosmMediaService,
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
            // APP-only: a MANUAL recce skips the ASM stage (field → HO directly), so it must never
            // be reminded to an ASM as "pending your approval" even when attached to an ASM-owned
            // outlet. hoReviewStatus NONE additionally excludes a RESUBMITTED APP recce (SUBMITTED +
            // APP but HO-bound) — it skipped ASM on resubmit, so the ASM must not be nagged for it.
            // Mirrors the ASM queue filter (approval.service.listQueue: SUBMITTED + APP + NONE).
            recceMode: 'APP',
            hoReviewStatus: 'NONE',
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
      hoApprovedRecceLast24h,
      rejectedRecceLast24h,
    ] = await Promise.all([
      // Recces awaiting ASM review — APP recces STILL in the ASM stage, mirroring the ASM queue
      // (approval.service: status SUBMITTED + recceMode APP + hoReviewStatus NONE). A MANUAL recce
      // (hoReviewStatus PENDING) and a RESUBMITTED app recce (SUBMITTED + APP but HO-bound,
      // hoReviewStatus PENDING) are both excluded here, so neither double-counts against the
      // pendingHoReview line below.
      this.prisma.recce.count({ where: { clientId, status: 'SUBMITTED', recceMode: 'APP', hoReviewStatus: 'NONE' } }),
      // Recces sitting in the HO queue — mirrors the recce-ho-review queue filter: ANY recce at
      // hoReviewStatus PENDING (status-agnostic). Covers APP ASM-approved (status APPROVED), MANUAL
      // (status SUBMITTED), AND resubmitted APP (status SUBMITTED). Disjoint from pendingRecceReview
      // (pinned to hoReviewStatus NONE), so no recce is counted on both lines.
      this.prisma.recce.count({
        where: { clientId, hoReviewStatus: 'PENDING' },
      }),
      this.prisma.installation.count({ where: { clientId, status: 'SUBMITTED' } }),
      this.prisma.manualTask.count({ where: { clientId, status: 'OPEN' } }),
      this.prisma.manualTaskSubmission.count({ where: { clientId, status: 'SUBMITTED' } }),
      this.prisma.recce.count({
        where: { clientId, status: 'SUBMITTED', receivedAt: { lt: staleRecceBefore } },
      }),
      this.prisma.installation.count({
        where: { clientId, status: 'SUBMITTED', receivedAt: { lt: staleInstallBefore } },
      }),
      // ASM-approved in the last 24h — status APPROVED by the reviewedAt (ASM) stamp, regardless
      // of HO. Keyed on reviewedAt (the ASM decision time), matching the "Recces rejected" line.
      this.prisma.recce.count({
        where: { clientId, status: 'APPROVED', reviewedAt: { gte: since24h } },
      }),
      // HO-approved (installable) in the last 24h — status APPROVED && hoReviewStatus APPROVED,
      // keyed on the HO decision time (hoReviewedAt), so it counts the HO sign-off, not the ASM one.
      this.prisma.recce.count({
        where: {
          clientId,
          status: 'APPROVED',
          hoReviewStatus: 'APPROVED',
          hoReviewedAt: { gte: since24h },
        },
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
      hoApprovedRecceLast24h,
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
            ${row('Recces ASM-approved', counts.approvedRecceLast24h)}
            ${row('Recces HO-approved (installable)', counts.hoApprovedRecceLast24h)}
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
   * Vendor FLEET confinement for EVERY report surface (JSON / .xlsx / .pptx), modeled EXACTLY on
   * analytics.resolveScope. Returns the vendorId a vendor-role caller (VENDOR_HO / VENDOR_FIELD) is
   * pinned to — AND it into the Site `where` so that caller can see ONLY their own fleet — or null
   * for a non-vendor role (where the tenant scope alone governs: CLIENT_ADMIN tenant-wide, un-assumed
   * GIFSY platform-wide).
   *
   * FAIL-CLOSED: a vendor-role token that (defensively) carries NO vendorId throws a 403 — it must
   * NEVER fall through to an unconfined, fleet-leaking read. Distinguish by ROLE, not the bare null
   * (see vendorScope's contract): null from a vendor role = deny, null from a non-vendor = tenant-governed.
   */
  private vendorFleetId(user: JwtPayload): string | null {
    const isVendor = user.role === 'VENDOR_HO' || user.role === 'VENDOR_FIELD';
    const v = vendorScope(user); // vendorId for a vendor role, else null
    if (isVendor && !v) {
      throw new ForbiddenException('Vendor login is not associated with a fleet');
    }
    return isVendor ? v : null;
  }

  /**
   * The tenant/vendor `where` for the report. Tenant-scoped like the admin dashboards: a
   * CLIENT_ADMIN / assumed operator is pinned to their tenant; an un-assumed GIFSY_ADMIN is
   * platform-wide (scope === undefined ⇒ no clientId filter). Text filters are ci-`contains`.
   *
   * VENDOR confinement (fail-closed, modeled on analytics.resolveScope): a VENDOR_HO / VENDOR_FIELD
   * caller is pinned to their OWN fleet (`vendorId`) on top of the tenant scope — and a vendor with
   * no vendorId is denied. A vendor's `?vendorId` filter is IGNORED (it can never widen OR re-point
   * scope to a sibling fleet); only an admin's `?vendorId` narrows.
   */
  private outletReportWhere(user: JwtPayload, q: ListOutletReportDto): Prisma.SiteWhereInput {
    const where: Prisma.SiteWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    if (q.siteCode) where.code = { contains: q.siteCode, mode: 'insensitive' };
    if (q.town) where.town = { contains: q.town, mode: 'insensitive' };
    if (q.region) where.region = { contains: q.region, mode: 'insensitive' };
    if (q.state) where.state = { contains: q.state, mode: 'insensitive' };
    // Vendor pin FIRST (fail-closed): a vendor sees only their fleet and any injected `?vendorId` is
    // ignored. Only when the caller is NOT a vendor does an admin `?vendorId` narrow the view.
    const fleetId = this.vendorFleetId(user);
    if (fleetId) where.vendorId = fleetId;
    else if (q.vendorId) where.vendorId = q.vendorId;
    // Installed mode: restrict to outlets that have at least one installed recce, so `total` reflects
    // outlets with installations and pages aren't padded with install-less outlets (the row builder
    // then emits exactly those recces that HAVE an installation).
    if (reportMode(q.mode) === 'installed') {
      where.recces = { some: { installation: { isNot: null } } };
    }
    return where;
  }

  /** Load matching sites (with the mode's report include) and map each to one-row-per-recce rows. */
  private async loadOutletRows(
    user: JwtPayload,
    q: ListOutletReportDto,
    skip: number,
    take: number,
  ): Promise<{ rows: ReportRow[]; total: number }> {
    const mode = reportMode(q.mode);
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
        include: outletReportInclude(mode),
      }),
      this.prisma.site.count({ where }),
    ]);
    // flatMap: each site expands to one row per recce (recce mode: app-only → 1, mixed → 1 + N,
    // none → 1; installed mode: one per recce WITH an installation, else 0).
    const rows = sites.flatMap((s) => buildOutletExecutionRows(s as unknown as RepSite, mode));
    return { rows, total };
  }

  /**
   * GET /v1/reports/outlet-execution — one paginated page of the report for the on-screen table.
   * Paging is BY OUTLET (skip/take over Sites): `total` is the outlet count and page N holds `limit`
   * outlets, but because an outlet expands to one row per recce (1 app + N manual), `rows.length` can
   * EXCEED `limit`. The FE derives its page count from `total` (outlets), so a multi-recce outlet
   * never straddles a page boundary — every row of an outlet stays on that outlet's page.
   */
  async outletExecution(user: JwtPayload, q: ListOutletReportDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(500, Math.max(1, q.limit ?? 50));
    const { rows, total } = await this.loadOutletRows(user, q, (page - 1) * limit, limit);
    return { columns: columnsForMode(reportMode(q.mode)), rows, total, page, limit };
  }

  /**
   * Project one curated report row onto the .xlsx record (keyed by column LABEL, which is what
   * streamXlsx uses as both the header and the per-row lookup). ALL columns are included — the
   * excel-only `audit` group too (the FE table skips those, but the download is a full audit trail).
   * A `photo` cell becomes a clickable {@link HyperlinkCell} ("Photo", or "Photo (lat, lng)" when the
   * capture carried a geotag) pointing at the auth-gated view path; every other cell is plain text.
   */
  private rowToXlsxRecord(
    row: ReportRow,
    origin: string | undefined,
    columns: ReportColumn[],
  ): Record<string, string | HyperlinkCell> {
    const rec: Record<string, string | HyperlinkCell> = {};
    for (const col of columns) {
      rec[col.label] = this.cellToXlsx(row.cells[col.key], origin);
    }
    return rec;
  }

  /**
   * One cell → a string or a hyperlink sentinel for the xlsx writer. For a photo, the link target is
   * made ABSOLUTE on the caller's app origin + `/api` surface (via {@link mediaHyperlinkTarget}) so a
   * logged-in user can click it straight from Excel; with no/invalid origin it degrades to the raw
   * relative view-path. The display text (cellSafe-guarded downstream) still carries the geotag.
   */
  private cellToXlsx(cell: Cell | undefined, origin: string | undefined): string | HyperlinkCell {
    if (!cell) return '';
    switch (cell.t) {
      case 'text':
      case 'status':
        return cell.v;
      case 'photo': {
        const geo =
          cell.lat != null && cell.lng != null
            ? ` (${cell.lat.toFixed(5)}, ${cell.lng.toFixed(5)})`
            : '';
        return {
          __hyperlink: true,
          text: `Photo${geo}`,
          target: mediaHyperlinkTarget(cell.viewPath, origin),
        };
      }
      case 'empty':
      default:
        return '';
    }
  }

  /**
   * GET /v1/reports/outlet-execution.xlsx — EVERY matching row as a streamed .xlsx (no row cap).
   * Rows are pulled in {@link OUTLET_EXPORT_BATCH}-sized pages by a stable `id` cursor (unique, so
   * inserts during a long export can't skip or duplicate rows) and written straight to the response
   * stream, so peak memory is one batch regardless of tenant size. The explicit header list keeps a
   * zero-row export as a header-only sheet. Returns a Readable the controller hands to StreamableFile.
   */
  outletExecutionXlsxStream(user: JwtPayload, q: ListOutletReportDto): Readable {
    const mode = reportMode(q.mode);
    const where = this.outletReportWhere(user, q);
    const columns = columnsForMode(mode);
    const include = outletReportInclude(mode);
    // The FE passes its own `window.location.origin` so photo links can be ABSOLUTE on the public
    // app surface (the backend sits behind the Next proxy and can't reliably know it). Validated +
    // remapped per-cell in mediaHyperlinkTarget; an absent/invalid origin degrades to a relative link.
    const origin = q.origin;
    let cursorId: string | undefined;
    let exhausted = false;

    const nextBatch = async (): Promise<Record<string, string | HyperlinkCell>[]> => {
      if (exhausted) return [];
      const sites = await this.prisma.site.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take: OUTLET_EXPORT_BATCH,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        include,
      });
      if (sites.length < OUTLET_EXPORT_BATCH) exhausted = true;
      if (sites.length > 0) cursorId = sites[sites.length - 1].id;
      return sites
        .flatMap((s) => buildOutletExecutionRows(s as unknown as RepSite, mode))
        .map((r) => this.rowToXlsxRecord(r, origin, columns));
    };

    // The export includes EVERY column for the mode — the install group + excel-only audit groups
    // included (col.label is both the header and the per-row key streamXlsx projects onto).
    return streamXlsx({
      sheetName: mode === 'installed' ? 'Installation Report' : 'Recce Report',
      headers: columns.map((c) => c.label),
      nextBatch,
    });
  }

  // ── Recce Report PowerPoint export (owner spec 2026-10-24) ──────────────────────────

  /**
   * GET /v1/reports/outlet-execution.pptx — a PowerPoint with ONE SLIDE PER OUTLET (1–3 outlets).
   * Each slide has a wide green header band (identity + "(W X H) - date - GPS", GPS linking to Google
   * Maps) and, on the LEFT, the recce element photo(s) at natural aspect with the element-placement
   * box drawn as a thin green rectangle mapped from the stored markup. The right half is left as the
   * seam for the future INSTALLED variant (Phase C).
   *
   * Tenant-scoped like the rest of the report (a CLIENT_ADMIN / assumed operator is pinned to their
   * tenant; an un-assumed GIFSY_ADMIN is platform-wide). Photo bytes are read SERVER-SIDE through the
   * same media/storage driver the `/v1/media/view` endpoint uses (never an HTTP call to our own API),
   * embedded as base64 JPEG. Bounded memory: capped at 3 outlets × ≤2 elements of full-res images.
   */
  async outletExecutionPptx(
    user: JwtPayload,
    outletCodesRaw: string | undefined,
    mode: ReportMode = 'recce',
  ): Promise<Buffer> {
    const pptx = await this.buildRecceDeck(user, outletCodesRaw, mode);
    // nodebuffer output → a Node Buffer ready for StreamableFile. (The media-encode step inside
    // `write` does a dynamic `import('node:fs')`, which only works under real Node — see the deck
    // builder's unit tests + the standalone boot smoke for why the two are split.)
    return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  }

  /**
   * Build the Recce Report deck (validate → load sites tenant-scoped → one slide per outlet), WITHOUT
   * writing it. Split out from {@link outletExecutionPptx} so the slide structure is unit-testable:
   * building (addSlide/addText/addImage/addShape) is pure in-memory bookkeeping, whereas `write()`
   * invokes pptxgenjs's media encoder, which `import()`s node built-ins (fine under real Node, but it
   * throws under the CommonJS Jest VM). Returns the populated PptxGenJS instance.
   */
  async buildRecceDeck(
    user: JwtPayload,
    outletCodesRaw: string | undefined,
    mode: ReportMode = 'recce',
  ): Promise<PptxGenJS> {
    const codes = this.parsePptxOutletCodes(outletCodesRaw);

    // Tenant scope, mirroring outletReportWhere: pin clientId unless the caller is platform-wide.
    const where: Prisma.SiteWhereInput = { code: { in: codes } };
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    // VENDOR fleet pin (fail-closed), IDENTICAL to outletReportWhere: a VENDOR_HO / VENDOR_FIELD is
    // confined to their own fleet, so a vendor can NEVER PPT-export a sibling fleet's outlet by code
    // (the code alone is not a key — it must also be in their fleet). A vendor with no vendorId 403s.
    const fleetId = this.vendorFleetId(user);
    if (fleetId) where.vendorId = fleetId;

    const sites = (await this.prisma.site.findMany({
      where,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      include: outletReportInclude(mode),
    })) as unknown as RepSite[];

    // Order the slides by the caller's requested code order (nice UX); a platform-wide GIFSY read can
    // match the same code in >1 tenant, so there may be more than `codes.length` sites — keep them all
    // (still bounded: ≤3 codes, images fetched + released one element at a time).
    const ordered: RepSite[] = [];
    for (const code of codes) {
      for (const s of sites) if (s.code === code) ordered.push(s);
    }

    // Bound the RESULTING sites, not just the codes: an un-assumed GIFSY platform-wide read can match
    // the same code in >1 tenant (Site.code is unique only per tenant), so 3 codes could resolve to
    // many sites. Cap to PPTX_MAX_OUTLETS in the deterministic (requested-code, then code+id) order
    // above so a platform-wide export can never materialise more than 3 slides.
    const capped = ordered.slice(0, PPTX_MAX_OUTLETS);

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'RECCE_WIDE', width: DEFAULT_SLIDE_LAYOUT.slideW, height: DEFAULT_SLIDE_LAYOUT.slideH });
    pptx.layout = 'RECCE_WIDE';

    for (const site of capped) {
      const plan = await this.buildOutletSlidePlan(user, site, mode);
      this.renderRecceSlide(pptx, plan);
    }
    return pptx;
  }

  /**
   * Parse + validate the `outletCodes` query (comma-separated). 1–3 distinct non-empty codes, else a
   * 400 with the owner's exact message. De-dupes (case-sensitively — outlet codes are exact keys).
   */
  private parsePptxOutletCodes(raw: string | undefined): string[] {
    const codes = [...new Set((raw ?? '').split(',').map((c) => c.trim()).filter(Boolean))];
    if (codes.length < 1 || codes.length > PPTX_MAX_OUTLETS) {
      throw new BadRequestException('Select 1–3 outlets for a PPT export.');
    }
    return codes;
  }

  /**
   * Build the pure slide plan for one outlet: pick its recce (APP first, else oldest manual), resolve
   * each present element's photo bytes (via the media service), and hand the decoded elements to the
   * pure {@link planRecceSlide}. An outlet with no recce — or a recce with no usable element photo —
   * yields an `empty` plan (a "No recce captured" slide), never a crash.
   */
  private async buildOutletSlidePlan(
    user: JwtPayload,
    site: RepSite,
    mode: ReportMode = 'recce',
  ): Promise<SlidePlan> {
    const recce = this.pickPrimaryRecce(site);
    if (!recce) {
      // No recce at all → an empty slide ("No recce captured"), for either layout.
      return mode === 'installed'
        ? planInstalledSlide({
            outletName: site.name, town: site.town, state: site.state,
            recceDate: null, installDate: null, geo: null, elements: [],
          })
        : planRecceSlide({
            outletName: site.name, town: site.town, state: site.state,
            recceDate: null, geo: null, elements: [],
          });
    }

    // Present elements in slot order (1 then 2). Each needs its recce photo bytes decoded; in installed
    // mode its install photo bytes are decoded too (via the SAME media path, downscaled identically).
    const posms = [...recce.posms].sort((a, b) => a.slotNo - b.slotNo);
    const elements: PlanElementInput[] = [];
    for (const p of posms) {
      const { key } = readPhoto(p.photo);
      const image = key ? await this.decodeImageForSlide(user, key) : null;
      const el: PlanElementInput = {
        slotNo: p.slotNo,
        posmTypeName: p.posmType?.name ?? null,
        dimsInner: pptxDimsLabel(p.dimensions),
        markup: p.markup,
        image: image ?? undefined,
      };
      if (mode === 'installed' && p.installPosm) {
        const { key: ikey } = readPhoto(p.installPosm.photo);
        const installImage = ikey ? await this.decodeImageForSlide(user, ikey) : null;
        el.installImage = installImage ?? undefined;
      }
      elements.push(el);
    }

    if (mode === 'installed') {
      const inst = recce.installation ?? null;
      return planInstalledSlide({
        outletName: site.name,
        town: site.town,
        state: site.state,
        recceDate: recce.capturedAt ?? recce.receivedAt,
        installDate: inst ? (inst.capturedAt ?? inst.receivedAt) : null,
        geo: this.resolveRecceGeo(recce),
        elements,
      });
    }

    return planRecceSlide({
      outletName: site.name,
      town: site.town,
      state: site.state,
      recceDate: recce.capturedAt ?? recce.receivedAt,
      geo: this.resolveRecceGeo(recce),
      elements,
    });
  }

  /**
   * The recce to feature on an outlet's slide: the APP recce if present (the single in-app recce),
   * otherwise the oldest MANUAL recce. Mirrors the per-outlet grain of the report (which sorts
   * APP-first then manual oldest-first); the PPT shows one recce per outlet, so it takes the first.
   */
  private pickPrimaryRecce(site: RepSite): RepRecce | null {
    if (!site.recces || site.recces.length === 0) return null;
    const sorted = [...site.recces].sort((a, b) => {
      const am = a.recceMode === 'MANUAL' ? 1 : 0;
      const bm = b.recceMode === 'MANUAL' ? 1 : 0;
      if (am !== bm) return am - bm;
      const at = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const bt = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      if (at !== bt) return at - bt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return sorted[0];
  }

  /**
   * The capture geotag for the GPS header link: the first element photo that carries a geo, else the
   * recce's representative capture lat/lng. Null when nothing is geotagged (the GPS link is omitted).
   */
  private resolveRecceGeo(recce: RepRecce): { lat: number; lng: number } | null {
    for (const p of recce.posms ?? []) {
      const { lat, lng } = readPhoto(p.photo);
      if (lat != null && lng != null) return { lat, lng };
    }
    const lat = Number(recce.captureLat);
    const lng = Number(recce.captureLng);
    if (recce.captureLat != null && recce.captureLng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    return null;
  }

  /**
   * Read a photo's bytes through the SAME media service the `/v1/media/view` endpoint uses (tenant-
   * enforced from the object key's folder; an un-assumed GIFSY reads any tenant), decode via jimp's
   * bundled decoders to get the natural dimensions, and re-encode to a bounded JPEG base64 data URL
   * for embedding. Returns null (caption-only element, no crash) when the photo is missing, oversized,
   * or not a jimp-decodable image (e.g. webp/PDF). Never throws.
   */
  private async decodeImageForSlide(
    user: JwtPayload,
    key: string,
  ): Promise<{ dataUrl: string; natW: number; natH: number } | null> {
    try {
      const { bytes } = await this.posmMedia.viewMedia(user, key);
      const mime = sniffImageMime(bytes);
      if (!mime) return null;
      const decode = pptxDecoders().get(mime);
      if (!decode) return null;
      const bitmap = await decode(bytes);
      const img = Jimp.fromBitmap(bitmap);
      const natW = img.bitmap.width;
      const natH = img.bitmap.height;
      if (!(natW > 0) || !(natH > 0)) return null;
      // Downscale an oversized photo to a sane longest side BEFORE re-encoding, so the embedded JPEG
      // (and the whole deck) stays bounded in size/memory for all exports. scaleToFit preserves
      // aspect; the guard means a small photo is never upscaled. The natural aspect that the box math
      // relies on is unchanged, so markup boxes still land correctly.
      if (Math.max(natW, natH) > PPTX_IMG_MAX_PX) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (img as any).scaleToFit({ w: PPTX_IMG_MAX_PX, h: PPTX_IMG_MAX_PX });
      }
      const outW = img.bitmap.width;
      const outH = img.bitmap.height;
      // Re-encode to JPEG so the embedded image is always a PowerPoint-supported format (webp/gif are
      // normalised away), at the (possibly downscaled) size.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jpeg: Buffer = await (img as any).getBuffer('image/jpeg');
      return { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, natW: outW, natH: outH };
    } catch (e) {
      this.logger.warn(`pptx: could not embed photo ${key}: ${this.reason(e)}`);
      return null;
    }
  }

  /**
   * Render one slide plan onto the deck: the green header band with the two centred title lines (the
   * GPS run hyperlinked), then either a "No recce captured" note or, for each element, the photo at
   * its fitted rect, the green stroke box over it (when markup exists), and the caption below.
   */
  private renderRecceSlide(pptx: PptxGenJS, plan: SlidePlan): void {
    const L = DEFAULT_SLIDE_LAYOUT;
    const slide = pptx.addSlide();

    // Header band + centred title. Line 1 is bold; line 2 is a run list so the "GPS" run can be a
    // hyperlink. The band fill is set on the text box so it spans the full slide width.
    const hasLine2 = plan.line2.length > 0;
    const runs: PptxGenJS.TextProps[] = [
      { text: plan.line1, options: { bold: true, fontSize: 17, breakLine: hasLine2 } },
    ];
    plan.line2.forEach((seg, i) => {
      runs.push({
        text: seg.text,
        options: {
          fontSize: 13,
          breakLine: i === plan.line2.length - 1,
          ...(seg.link
            ? { hyperlink: { url: seg.link, tooltip: 'Open in Google Maps' }, underline: { style: 'sng' }, color: 'FFFFFF' }
            : {}),
        },
      });
    });
    slide.addText(runs, {
      x: 0,
      y: 0,
      w: '100%',
      h: L.headerH,
      align: 'center',
      valign: 'middle',
      color: 'FFFFFF',
      fill: { color: PPTX_HEADER_GREEN },
    });

    if (plan.empty) {
      slide.addText('No recce captured', {
        x: 0,
        y: L.headerH,
        w: '100%',
        h: L.slideH - L.headerH,
        align: 'center',
        valign: 'middle',
        fontSize: 20,
        color: '888888',
      });
      return;
    }

    for (const el of plan.elements) {
      if (el.dataUrl && el.imageRect) {
        slide.addImage({
          data: el.dataUrl,
          x: el.imageRect.x,
          y: el.imageRect.y,
          w: el.imageRect.w,
          h: el.imageRect.h,
        });
      }
      // Draw EACH markup shape faithfully over the photo (matching the FE MarkupOverlay): a rect is a
      // thin green rectangle outline; a freehand path is a green polyline via custom geometry. NO fill.
      // object-fit: contain means every shape is mapped onto the fitted image rect, so each lands
      // exactly where the on-screen overlay draws. Degenerate shapes were dropped by the planner.
      for (const box of el.boxes) {
        if (box.kind === 'rect') {
          slide.addShape(pptx.ShapeType.rect, {
            x: box.rect.x,
            y: box.rect.y,
            w: box.rect.w,
            h: box.rect.h,
            fill: { type: 'none' },
            line: { color: PPTX_HEADER_GREEN, width: 1.5 },
          });
        } else {
          // custom-geometry polyline — the shape box is the fitted image rect and the points are
          // LOCAL to it (inches from its top-left), which is what pptxgenjs expects. `custGeom` is a
          // real runtime ShapeType (absent from the shipped .d.ts enum), so cast the literal.
          slide.addShape('custGeom' as unknown as PptxGenJS.ShapeType, {
            x: box.box.x,
            y: box.box.y,
            w: box.box.w,
            h: box.box.h,
            fill: { type: 'none' },
            line: { color: PPTX_HEADER_GREEN, width: 1.5 },
            points: box.points.map((p, i) =>
              i === 0 ? { x: p.x, y: p.y, moveTo: true } : { x: p.x, y: p.y },
            ),
          });
        }
      }
      slide.addText(el.caption, {
        x: el.captionRect.x,
        y: el.captionRect.y,
        w: el.captionRect.w,
        h: el.captionRect.h,
        align: 'center',
        valign: 'middle',
        fontSize: 11,
        color: '444444',
      });

      // Installed variant — the RIGHT (install) side: the install photo (plain, no box) or an
      // "Awaiting installation" placeholder, plus the "After · Installed" caption. These fields are
      // undefined for a recce-only slide, so this is a no-op there.
      if (el.installImageRect) {
        if (el.installDataUrl) {
          slide.addImage({
            data: el.installDataUrl,
            x: el.installImageRect.x,
            y: el.installImageRect.y,
            w: el.installImageRect.w,
            h: el.installImageRect.h,
          });
        } else if (el.installPlaceholder) {
          slide.addText('Awaiting installation', {
            x: el.installImageRect.x,
            y: el.installImageRect.y,
            w: el.installImageRect.w,
            h: el.installImageRect.h,
            align: 'center',
            valign: 'middle',
            fontSize: 14,
            italic: true,
            color: '999999',
            fill: { color: 'F3F4F6' },
            line: { color: 'DDDDDD', width: 1, dashType: 'dash' },
          });
        }
      }
      if (el.installCaption && el.installCaptionRect) {
        slide.addText(el.installCaption, {
          x: el.installCaptionRect.x,
          y: el.installCaptionRect.y,
          w: el.installCaptionRect.w,
          h: el.installCaptionRect.h,
          align: 'center',
          valign: 'middle',
          fontSize: 11,
          color: '444444',
        });
      }
    }
  }
}
