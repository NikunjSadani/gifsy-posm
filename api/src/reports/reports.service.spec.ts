import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import type { Readable } from 'node:stream';
import { ReportsService } from './reports.service';
import { CURATED_COLUMNS, type RepSite, type RepRecce } from './outlet-execution.helper';
import { UpdateEmailReportsConfigDto } from './dto/update-email-reports-config.dto';
import {
  DEFAULT_EMAIL_REPORTS_CONFIG,
  mergeEmailReportsConfig,
  readEmailReportsConfig,
} from './reports.config';
import { istDateOnlyUtc, istHour } from './reports.time';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { Msg91Service } from '../notifications/msg91.service';

/** A Prisma unique-constraint error — what the ledger create hits on a same-day double-fire. */
const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
    code: 'P2002',
    clientVersion: 'x',
  } as never);

function makePrisma() {
  const fns: Record<string, any> = {
    client: {
      findUnique: jest.fn().mockResolvedValue({ settings: {}, name: 'Acme' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    recce: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    site: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    installation: { count: jest.fn().mockResolvedValue(0) },
    manualTask: { count: jest.fn().mockResolvedValue(0) },
    manualTaskSubmission: { count: jest.fn().mockResolvedValue(0) },
    emailDigestLog: {
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    asmReminderLog: {
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  // Interactive-transaction shim: run the callback with the same mock as the tx client.
  fns.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(fns)
      : Promise.all(arg as Promise<unknown>[]),
  );
  return { prisma: fns as unknown as PrismaService, fns };
}

function makeMsg91() {
  const sendEmail = jest.fn().mockResolvedValue(undefined);
  return { msg91: { sendEmail } as unknown as Msg91Service, sendEmail };
}

function makeService() {
  const { prisma, fns } = makePrisma();
  const { msg91, sendEmail } = makeMsg91();
  const service = new ReportsService(prisma, msg91);
  return { service, fns, sendEmail };
}

const admin = (over: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'u1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'T', ...over,
});

const fullConfig = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  recipients: ['a@x.com'],
  sendHourLocal: 8,
  staleRecceHours: 24,
  staleInstallHours: 48,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// DTO validation
// ─────────────────────────────────────────────────────────────────────────────
describe('UpdateEmailReportsConfigDto validation', () => {
  const validate1 = async (obj: Record<string, unknown>) =>
    validate(plainToInstance(UpdateEmailReportsConfigDto, obj));

  it('accepts a valid config', async () => {
    expect(await validate1(fullConfig())).toHaveLength(0);
  });

  it('rejects an invalid recipient email', async () => {
    const errs = await validate1(fullConfig({ recipients: ['a@x.com', 'not-an-email'] }));
    expect(errs.some((e) => e.property === 'recipients')).toBe(true);
  });

  it('rejects sendHourLocal out of 0–23', async () => {
    expect((await validate1(fullConfig({ sendHourLocal: 24 }))).length).toBeGreaterThan(0);
    expect((await validate1(fullConfig({ sendHourLocal: -1 }))).length).toBeGreaterThan(0);
  });

  it('rejects stale thresholds < 1', async () => {
    expect((await validate1(fullConfig({ staleRecceHours: 0 }))).length).toBeGreaterThan(0);
    expect((await validate1(fullConfig({ staleInstallHours: 0 }))).length).toBeGreaterThan(0);
  });

  it('rejects a non-boolean enabled', async () => {
    const errs = await validate1({ ...fullConfig(), enabled: 'yes' });
    expect(errs.some((e) => e.property === 'enabled')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Config reader / merger (settings-backed, no clobber)
// ─────────────────────────────────────────────────────────────────────────────
describe('readEmailReportsConfig', () => {
  it('returns defaults when emailReports is absent', () => {
    expect(readEmailReportsConfig({})).toEqual(DEFAULT_EMAIL_REPORTS_CONFIG);
    expect(readEmailReportsConfig(null)).toEqual(DEFAULT_EMAIL_REPORTS_CONFIG);
    expect(readEmailReportsConfig(undefined)).toEqual(DEFAULT_EMAIL_REPORTS_CONFIG);
  });

  it('independently defaults each missing field', () => {
    const cfg = readEmailReportsConfig({ emailReports: { enabled: true } });
    expect(cfg.enabled).toBe(true);
    expect(cfg.recipients).toEqual([]);
    expect(cfg.sendHourLocal).toBe(8);
    expect(cfg.staleRecceHours).toBe(24);
    expect(cfg.staleInstallHours).toBe(48);
  });

  it('de-dups recipients case-insensitively and clamps bad numbers', () => {
    const cfg = readEmailReportsConfig({
      emailReports: {
        recipients: ['A@x.com', 'a@X.com', ' b@x.com '],
        sendHourLocal: 99,
        staleRecceHours: 0,
      },
    });
    expect(cfg.recipients).toEqual(['A@x.com', 'b@x.com']);
    expect(cfg.sendHourLocal).toBe(8); // 99 out of range → default
    expect(cfg.staleRecceHours).toBe(24); // 0 < 1 → default
  });
});

describe('mergeEmailReportsConfig (no clobber)', () => {
  it('merges emailReports WITHOUT touching sibling settings keys', () => {
    const settings = {
      posmCapture: { geoFence: { enabled: true, radiusMeters: 100 } },
      somethingElse: 42,
    };
    const merged = mergeEmailReportsConfig(settings, fullConfig() as never);
    expect(merged.posmCapture).toEqual({ geoFence: { enabled: true, radiusMeters: 100 } });
    expect(merged.somethingElse).toBe(42);
    expect(merged.emailReports).toEqual(fullConfig());
  });

  it('produces a fresh object (does not mutate the original settings)', () => {
    const settings: Record<string, unknown> = { posmCapture: { x: 1 } };
    const merged = mergeEmailReportsConfig(settings, fullConfig() as never);
    expect(merged).not.toBe(settings);
    expect(settings.emailReports).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// putConfig — merge + dedup persisted
// ─────────────────────────────────────────────────────────────────────────────
describe('ReportsService.putConfig', () => {
  it('de-dups recipients and merges into settings without clobbering', async () => {
    const { service, fns } = makeService();
    fns.client.findUnique.mockResolvedValue({ settings: { posmCapture: { x: 1 } } });
    const dto = plainToInstance(UpdateEmailReportsConfigDto, fullConfig({
      recipients: ['A@x.com', 'a@x.com', 'b@x.com'],
    }));

    const saved = await service.putConfig(admin(), dto);

    expect(saved.recipients).toEqual(['A@x.com', 'b@x.com']);
    const updateArg = fns.client.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'c1' });
    expect(updateArg.data.settings.posmCapture).toEqual({ x: 1 });
    expect(updateArg.data.settings.emailReports.recipients).toEqual(['A@x.com', 'b@x.com']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeCounts — tenant-scoped (isolation)
// ─────────────────────────────────────────────────────────────────────────────
describe('ReportsService.computeCounts', () => {
  it('pins clientId on EVERY count query (no cross-tenant leak)', async () => {
    const { service, fns } = makeService();
    const now = new Date('2026-08-28T02:30:00Z');
    await service.computeCounts('c1', fullConfig() as never, now);

    for (const model of [fns.recce, fns.installation, fns.manualTask, fns.manualTaskSubmission]) {
      for (const call of model.count.mock.calls) {
        expect(call[0].where.clientId).toBe('c1');
      }
    }
  });

  it('computes stale windows from the configured thresholds relative to now', async () => {
    const { service, fns } = makeService();
    const now = new Date('2026-08-28T10:00:00Z');
    await service.computeCounts('c1', fullConfig({ staleRecceHours: 24, staleInstallHours: 48 }) as never, now);

    const staleRecceCall = fns.recce.count.mock.calls.find(
      (c: any[]) => c[0].where.status === 'SUBMITTED' && c[0].where.receivedAt,
    );
    const staleInstallCall = fns.installation.count.mock.calls.find(
      (c: any[]) => c[0].where.status === 'SUBMITTED' && c[0].where.receivedAt,
    );
    expect(staleRecceCall[0].where.receivedAt.lt).toEqual(new Date('2026-08-27T10:00:00Z'));
    expect(staleInstallCall[0].where.receivedAt.lt).toEqual(new Date('2026-08-26T10:00:00Z'));
  });

  it('maps counts by domain (returns the right shape)', async () => {
    const { service, fns } = makeService();
    fns.recce.count
      .mockResolvedValueOnce(3) // pendingRecceReview
      .mockResolvedValueOnce(9) // pendingHoReview (ASM-approved, awaiting HO)
      .mockResolvedValueOnce(1) // staleRecces
      .mockResolvedValueOnce(5) // approvedRecceLast24h (ASM-approved in 24h)
      .mockResolvedValueOnce(4) // hoApprovedRecceLast24h (HO-approved / installable in 24h)
      .mockResolvedValueOnce(2); // rejectedRecceLast24h
    fns.installation.count
      .mockResolvedValueOnce(4) // pendingInstallAudit
      .mockResolvedValueOnce(1); // staleInstalls
    fns.manualTask.count.mockResolvedValueOnce(6);
    fns.manualTaskSubmission.count.mockResolvedValueOnce(7);

    const counts = await service.computeCounts('c1', fullConfig() as never, new Date());
    expect(counts).toEqual({
      pendingRecceReview: 3,
      pendingHoReview: 9,
      pendingInstallAudit: 4,
      openManualTasks: 6,
      manualPendingReview: 7,
      staleRecces: 1,
      staleInstalls: 1,
      approvedRecceLast24h: 5,
      hoApprovedRecceLast24h: 4,
      rejectedRecceLast24h: 2,
    });
  });

  it('counts pendingHoReview as ANY recce at hoReviewStatus PENDING (app/manual/resubmit), and renders the digest line', async () => {
    const { service, fns } = makeService();
    await service.computeCounts('c1', fullConfig() as never, new Date());
    // The HO-queue count is now simply tenant + hoReviewStatus PENDING (status-agnostic): it covers
    // APP ASM-approved (status APPROVED), MANUAL (status SUBMITTED), AND resubmitted-APP (status
    // SUBMITTED) — the last of which the old app/manual OR would have silently dropped.
    const hoCall = fns.recce.count.mock.calls.find(
      (c: any[]) =>
        c[0].where.hoReviewStatus === 'PENDING' &&
        c[0].where.status === undefined &&
        c[0].where.OR === undefined &&
        c[0].where.reviewedAt === undefined &&
        c[0].where.hoReviewedAt === undefined,
    );
    expect(hoCall).toBeDefined();
    expect(hoCall[0].where).toEqual({ clientId: 'c1', hoReviewStatus: 'PENDING' });

    // And it surfaces as a dedicated line in the rendered digest (mirrors the pending-recce line).
    const html = service.buildDigestHtml('Acme', {
      pendingRecceReview: 0, pendingHoReview: 4, pendingInstallAudit: 0, openManualTasks: 0,
      manualPendingReview: 0, staleRecces: 0, staleInstalls: 0, approvedRecceLast24h: 0,
      hoApprovedRecceLast24h: 0, rejectedRecceLast24h: 0,
    }, new Date());
    expect(html).toContain('Recces awaiting HO approval');
    expect(html).toContain('>4<');
  });

  it('hoApprovedRecceLast24h counts ONLY status APPROVED && hoReviewStatus APPROVED (by hoReviewedAt), and the digest distinguishes ASM vs HO approved', async () => {
    const { service, fns } = makeService();
    const now = new Date('2026-08-28T10:00:00Z');
    await service.computeCounts('c1', fullConfig() as never, now);

    // The HO-approved-last-24h count pins status APPROVED + hoReviewStatus APPROVED and windows on
    // hoReviewedAt (the HO decision time), NOT reviewedAt (the ASM time).
    const hoApprovedCall = fns.recce.count.mock.calls.find(
      (c: any[]) =>
        c[0].where.status === 'APPROVED' &&
        c[0].where.hoReviewStatus === 'APPROVED' &&
        c[0].where.hoReviewedAt,
    );
    expect(hoApprovedCall).toBeDefined();
    expect(hoApprovedCall[0].where.clientId).toBe('c1');
    expect(hoApprovedCall[0].where.hoReviewedAt.gte).toEqual(new Date('2026-08-27T10:00:00Z'));

    // The ASM-approved-last-24h count does NOT pin hoReviewStatus (ASM stage, regardless of HO).
    const asmApprovedCall = fns.recce.count.mock.calls.find(
      (c: any[]) =>
        c[0].where.status === 'APPROVED' && c[0].where.reviewedAt && !c[0].where.hoReviewStatus,
    );
    expect(asmApprovedCall).toBeDefined();

    // The rendered digest labels the two distinctly — never a bare "Recces approved".
    const html = service.buildDigestHtml('Acme', {
      pendingRecceReview: 0, pendingHoReview: 0, pendingInstallAudit: 0, openManualTasks: 0,
      manualPendingReview: 0, staleRecces: 0, staleInstalls: 0, approvedRecceLast24h: 7,
      hoApprovedRecceLast24h: 3, rejectedRecceLast24h: 1,
    }, now);
    expect(html).toContain('Recces ASM-approved');
    expect(html).toContain('Recces HO-approved (installable)');
    expect(html).not.toContain('>Recces approved<');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendNow — manual test send (no ledger)
// ─────────────────────────────────────────────────────────────────────────────
describe('ReportsService.sendNow', () => {
  it('400s when no recipients configured, and never emails or touches the ledger', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findUnique.mockResolvedValue({ settings: { emailReports: fullConfig({ recipients: [] }) } });
    await expect(service.sendNow(admin())).rejects.toBeInstanceOf(BadRequestException);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fns.emailDigestLog.create).not.toHaveBeenCalled();
  });

  it('sends to configured recipients WITHOUT consulting the idempotency ledger', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findUnique.mockResolvedValue({
      settings: { emailReports: fullConfig({ recipients: ['a@x.com', 'b@x.com'] }) },
      name: 'Acme',
    });
    const res = await service.sendNow(admin());
    expect(res.sent).toBe(true);
    expect(res.recipients).toEqual(['a@x.com', 'b@x.com']);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toEqual(['a@x.com', 'b@x.com']);
    expect(sendEmail.mock.calls[0][0].subject).toContain('Acme');
    expect(fns.emailDigestLog.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runDailyDigestCron — hour gate + recipients gate + idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('ReportsService.runDailyDigestCron', () => {
  // 2026-08-28T02:30:00Z == 08:00 IST → matches sendHourLocal 8.
  const at8IST = new Date('2026-08-28T02:30:00Z');

  it('sends for an enabled tenant at its send hour, claiming the ledger first', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ sendHourLocal: 8 }) } },
    ]);
    await service.runDailyDigestCron(at8IST);

    expect(fns.emailDigestLog.create).toHaveBeenCalledTimes(1);
    const created = fns.emailDigestLog.create.mock.calls[0][0].data;
    expect(created.clientId).toBe('c1');
    expect(created.digestType).toBe('DAILY_DIGEST');
    expect(created.forDate).toEqual(istDateOnlyUtc(at8IST));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('SKIPS a tenant already logged today (P2002) — no email', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ sendHourLocal: 8 }) } },
    ]);
    fns.emailDigestLog.create.mockRejectedValue(uniqueError());

    await service.runDailyDigestCron(at8IST);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('SKIPS a disabled tenant', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ enabled: false, sendHourLocal: 8 }) } },
    ]);
    await service.runDailyDigestCron(at8IST);
    expect(fns.emailDigestLog.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('ROLLS BACK the ledger claim when the send throws (so a later hour retries that day)', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ sendHourLocal: 8 }) } },
    ]);
    sendEmail.mockRejectedValueOnce(new Error('smtp timeout'));
    await service.runDailyDigestCron(at8IST);
    // The claim was created, then deleted because the send failed — no permanent lost digest.
    expect(fns.emailDigestLog.create).toHaveBeenCalledTimes(1);
    expect(fns.emailDigestLog.delete).toHaveBeenCalledTimes(1);
    expect(fns.emailDigestLog.delete.mock.calls[0][0].where.clientId_digestType_forDate).toMatchObject({
      clientId: 'c1',
      digestType: 'DAILY_DIGEST',
    });
  });

  it('FIRES when the current hour is AFTER sendHourLocal (retry window, not only exactly at it)', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ sendHourLocal: 8 }) } },
    ]);
    const at12IST = new Date('2026-08-28T06:30:00Z'); // 12:00 IST, past sendHour 8
    await service.runDailyDigestCron(at12IST);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('SKIPS when the current hour is BEFORE sendHourLocal', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ sendHourLocal: 8 }) } },
    ]);
    const at6IST = new Date('2026-08-28T00:30:00Z'); // 06:00 IST, before sendHour 8
    await service.runDailyDigestCron(at6IST);
    expect(fns.emailDigestLog.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('SKIPS a tenant whose sendHourLocal != current IST hour', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ sendHourLocal: 9 }) } },
    ]);
    await service.runDailyDigestCron(at8IST); // hour is 8, tenant wants 9
    expect(fns.emailDigestLog.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('SKIPS an enabled/right-hour tenant with 0 recipients (no ledger row, no email)', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', settings: { emailReports: fullConfig({ sendHourLocal: 8, recipients: [] }) } },
    ]);
    await service.runDailyDigestCron(at8IST);
    expect(fns.emailDigestLog.create).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('one tenant failing does NOT abort the sweep for the others', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([
      { id: 'c1', name: 'Bad', settings: { emailReports: fullConfig({ sendHourLocal: 8 }) } },
      { id: 'c2', name: 'Good', settings: { emailReports: fullConfig({ sendHourLocal: 8 }) } },
    ]);
    // First tenant's ledger create throws a NON-unique error → caught, loop continues.
    fns.emailDigestLog.create
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});

    await service.runDailyDigestCron(at8IST);
    expect(fns.emailDigestLog.create).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledTimes(1); // only the good tenant emailed
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IST time helpers
// ─────────────────────────────────────────────────────────────────────────────
describe('reports.time (IST helpers)', () => {
  it('istHour reflects the +5:30 offset', () => {
    expect(istHour(new Date('2026-08-28T02:30:00Z'))).toBe(8); // 08:00 IST
    expect(istHour(new Date('2026-08-27T18:31:00Z'))).toBe(0); // 00:01 IST next day
  });

  it('istDateOnlyUtc maps two same-IST-day instants to the SAME forDate', () => {
    const a = istDateOnlyUtc(new Date('2026-08-28T02:30:00Z')); // 08:00 IST 28th
    const b = istDateOnlyUtc(new Date('2026-08-28T17:00:00Z')); // 22:30 IST 28th
    expect(a).toEqual(b);
    expect(a).toEqual(new Date(Date.UTC(2026, 7, 28)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-ASM pending-recce reminders (threshold-triggered)
// ─────────────────────────────────────────────────────────────────────────────
describe('ReportsService.runAsmRecceReminders', () => {
  const reminderSettings = (over = {}) => ({
    settings: { emailReports: { asmRecceReminders: { enabled: true, thresholdHours: 24, reminderIntervalHours: 24, ...over } } },
  });
  const recceRow = (over: any = {}) => ({
    id: over.id ?? 'r1',
    receivedAt: over.receivedAt ?? new Date(Date.now() - 3 * 24 * 3600_000), // 3 days ago
    site: { code: 'A1', name: 'Alpha', town: 'Pune', asmUserId: 'asm1',
      asm: { email: 'asm1@kw.in', name: 'ASM One', isActive: true }, ...over.site },
  });

  it('does nothing when the feature is disabled', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme', settings: { emailReports: { asmRecceReminders: { enabled: false } } } }]);
    await service.runAsmRecceReminders(new Date());
    expect(fns.recce.findMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('emails each ASM only THEIR pending outlets and stamps lastRemindedAt on those recces', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme', ...reminderSettings() }]);
    fns.recce.findMany.mockResolvedValue([
      recceRow({ id: 'r1' }),
      recceRow({ id: 'r2', site: { code: 'A2', name: 'Beta', town: null, asmUserId: 'asm1', asm: { email: 'asm1@kw.in', name: 'ASM One', isActive: true } } }),
      recceRow({ id: 'r3', site: { code: 'B1', name: 'Gamma', town: 'Delhi', asmUserId: 'asm2', asm: { email: 'asm2@kw.in', name: 'ASM Two', isActive: true } } }),
    ]);
    const now = new Date();
    await service.runAsmRecceReminders(now);

    // Query is tenant + SUBMITTED + APP + HO-NONE + threshold + has-asm + not-recently-reminded.
    // recceMode APP + hoReviewStatus NONE together exclude manual recces AND resubmitted APP recces
    // (SUBMITTED + APP but HO-bound) — neither is pending an ASM, so neither may be reminded.
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ clientId: 'c1', status: 'SUBMITTED', recceMode: 'APP', hoReviewStatus: 'NONE' });
    expect(where.site).toMatchObject({ asmUserId: { not: null } });

    // Two ASMs → two emails, each to the right address.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const tos = sendEmail.mock.calls.map((c: any[]) => c[0].to[0]).sort();
    expect(tos).toEqual(['asm1@kw.in', 'asm2@kw.in']);
    // ASM One's email lists 2 outlets; the HTML names them.
    const asm1Call = sendEmail.mock.calls.find((c: any[]) => c[0].to[0] === 'asm1@kw.in')[0];
    expect(asm1Call.subject).toMatch(/2 recces pending your approval/);
    expect(asm1Call.html).toContain('Alpha');
    expect(asm1Call.html).toContain('Beta');
    // Stamped exactly the recces that were sent (r1,r2 for asm1 and r3 for asm2).
    const stamped = fns.recce.updateMany.mock.calls.flatMap((c: any[]) => c[0].where.id.in).sort();
    expect(stamped).toEqual(['r1', 'r2', 'r3']);
    for (const c of fns.recce.updateMany.mock.calls) expect(c[0].data).toEqual({ lastRemindedAt: now });
    // Idempotency claim — one ledger row per ASM for this tick, keyed by (clientId, asmUserId, periodKey).
    expect(fns.asmReminderLog.create).toHaveBeenCalledTimes(2);
    const claimedAsms = fns.asmReminderLog.create.mock.calls.map((c: any[]) => c[0].data.asmUserId).sort();
    expect(claimedAsms).toEqual(['asm1', 'asm2']);
    const claim = fns.asmReminderLog.create.mock.calls[0][0].data;
    expect(claim).toMatchObject({ clientId: 'c1' });
    expect(typeof claim.periodKey).toBe('string'); // IST hour bucket
  });

  it('SKIPS an ASM already claimed this tick (P2002) — no email, not stamped', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme', ...reminderSettings() }]);
    fns.recce.findMany.mockResolvedValue([recceRow({ id: 'r1' })]);
    fns.asmReminderLog.create.mockRejectedValueOnce(uniqueError()); // another instance won the race
    await service.runAsmRecceReminders(new Date());
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fns.recce.updateMany).not.toHaveBeenCalled();
    expect(fns.asmReminderLog.delete).not.toHaveBeenCalled(); // never sent → nothing to roll back
  });

  it('skips an ASM with no email / inactive account (not emailed, not stamped → stays eligible)', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme', ...reminderSettings() }]);
    fns.recce.findMany.mockResolvedValue([
      recceRow({ id: 'r1', site: { code: 'A1', name: 'Alpha', town: null, asmUserId: 'asm1', asm: { email: null, name: 'No Email', isActive: true } } }),
      recceRow({ id: 'r2', site: { code: 'B1', name: 'Gamma', town: null, asmUserId: 'asm2', asm: { email: 'asm2@kw.in', name: 'ASM Two', isActive: false } } }),
    ]);
    await service.runAsmRecceReminders(new Date());
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fns.recce.updateMany).not.toHaveBeenCalled();
  });

  it('a send failure does NOT stamp AND rolls back the claim (so it retries next tick)', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme', ...reminderSettings() }]);
    fns.recce.findMany.mockResolvedValue([recceRow({ id: 'r1' })]);
    sendEmail.mockRejectedValueOnce(new Error('smtp down'));
    await service.runAsmRecceReminders(new Date()); // must not throw
    expect(fns.recce.updateMany).not.toHaveBeenCalled();
    // The claim was committed before the send, so it must be rolled back to allow a later retry.
    expect(fns.asmReminderLog.delete).toHaveBeenCalledTimes(1);
    expect(fns.asmReminderLog.delete.mock.calls[0][0].where.clientId_asmUserId_periodKey).toMatchObject({
      clientId: 'c1', asmUserId: 'asm1',
    });
  });

  it('pruneStaleLedgers deletes BOTH ledgers older than the retention cutoff', async () => {
    const { service, fns } = makeService();
    const now = new Date('2026-10-02T00:00:00Z');
    await service.pruneStaleLedgers(now, 30);
    const cutoff = new Date(now.getTime() - 30 * 24 * 3600_000);
    expect(fns.asmReminderLog.deleteMany).toHaveBeenCalledWith({ where: { sentAt: { lt: cutoff } } });
    expect(fns.emailDigestLog.deleteMany).toHaveBeenCalledWith({ where: { sentAt: { lt: cutoff } } });
  });

  it('a POST-send stamp failure does NOT roll back the claim (ledger guards the window; no repeating dup)', async () => {
    const { service, fns, sendEmail } = makeService();
    fns.client.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme', ...reminderSettings() }]);
    fns.recce.findMany.mockResolvedValue([recceRow({ id: 'r1' })]);
    // Email SENDS fine, but stamping lastRemindedAt afterwards fails (DB blip).
    fns.recce.updateMany.mockRejectedValueOnce(new Error('db blip'));
    await service.runAsmRecceReminders(new Date()); // must not throw
    expect(sendEmail).toHaveBeenCalledTimes(1); // the email went out
    // Claim must STAY (the interval-bucket ledger row now guards against a re-send this window) —
    // rolling it back here is exactly what caused the repeating-duplicate bug the audit found.
    expect(fns.asmReminderLog.delete).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Outlet-execution "Recce Report" — curated columns/rows contract + .xlsx stream
// ─────────────────────────────────────────────────────────────────────────────
const sampleRecce = (): RepRecce => ({
  id: 'recA', recceMode: 'APP', status: 'APPROVED', hoReviewStatus: 'APPROVED',
  capturedAt: new Date('2026-08-28T02:30:00Z'), receivedAt: new Date('2026-08-28T02:30:00Z'),
  reviewedAt: new Date('2026-08-28T03:30:00Z'), hoReviewedAt: new Date('2026-08-28T04:30:00Z'),
  submittedBy: { promoterCode: 'P100' }, approvedBy: { name: 'Asha ASM' }, hoReviewedBy: { name: 'Hari HO' },
  posms: [
    { id: 'rp1', slotNo: 1, posmType: { name: 'Standard Board' }, dimensions: { width: 24, height: 12, unit: 'in' }, photo: { key: 'r1', geo: { lat: 19.2401, lng: 73.1301 } } },
  ],
});
const sampleSite = (): RepSite => ({
  id: 'siteA', code: 'A8', name: 'Kalyan Mega Mart',
  town: 'Kalyan', state: 'MH', rsCode: 'WB2.09', rsName: 'Das', channel: 'GT',
  vendor: { name: 'Prime Fleet' },
  recces: [sampleRecce()],
});

const streamToBuffer = (s: Readable): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    s.on('data', (c) => chunks.push(c as Buffer));
    s.on('end', () => resolve(Buffer.concat(chunks)));
    s.on('error', reject);
  });

describe('ReportsService.outletExecution (curated contract)', () => {
  it('returns the curated columns — incl. the excel-only audit group — and one row per recce with cells', async () => {
    const { service, fns } = makeService();
    fns.site.findMany.mockResolvedValue([sampleSite()]);
    fns.site.count.mockResolvedValue(1);

    const res = await service.outletExecution(admin(), {});
    // The column contract is exactly CURATED_COLUMNS (same reference the FE builds to).
    expect(res.columns).toBe(CURATED_COLUMNS);
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    // Audit columns are present and flagged excel-only; outlet identity is pinned.
    const audit = res.columns.filter((c) => c.group === 'audit');
    expect(audit.map((c) => c.key)).toEqual(['capturedOn', 'asmApprovedBy', 'asmApprovedOn', 'hoApprovedBy', 'hoApprovedOn']);
    expect(audit.every((c) => c.excelOnly === true)).toBe(true);
    expect(res.columns.filter((c) => c.pinned).map((c) => c.key)).toEqual(['outletCode', 'outletName']);

    // One recce → one row; the photo cell carries key + viewPath + geotag.
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe('recA');
    expect(res.rows[0].cells.el1Photo).toEqual({ t: 'photo', key: 'r1', viewPath: '/v1/media/view?key=r1', lat: 19.2401, lng: 73.1301 });
    expect(res.rows[0].cells.recceStatus).toEqual({ t: 'status', v: 'HO approved', tone: 'approved' });
  });

  it('keeps tenant scope + text filters on the Site query (unchanged)', async () => {
    const { service, fns } = makeService();
    await service.outletExecution(admin(), { siteCode: 'A8', town: 'Kalyan', region: 'West', state: 'MH', vendorId: 'v9' });
    const where = fns.site.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1'); // tenant-scoped to the caller
    expect(where.code).toEqual({ contains: 'A8', mode: 'insensitive' });
    expect(where.town).toEqual({ contains: 'Kalyan', mode: 'insensitive' });
    expect(where.region).toEqual({ contains: 'West', mode: 'insensitive' });
    expect(where.state).toEqual({ contains: 'MH', mode: 'insensitive' });
    expect(where.vendorId).toBe('v9');
  });
});

describe('ReportsService.outletExecutionXlsxStream', () => {
  it('writes the curated headers (incl. the excel-only audit columns) and renders the photo cell as a hyperlink', async () => {
    const { service, fns } = makeService();
    // One batch then exhausted (1 site < the 1000-batch size ends the stream).
    fns.site.findMany.mockResolvedValueOnce([sampleSite()]).mockResolvedValue([]);

    const buf = await streamToBuffer(service.outletExecutionXlsxStream(admin(), {}));
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

    const header = aoa[0];
    // Every curated label is a header, excel-only audit columns included.
    for (const label of CURATED_COLUMNS.map((c) => c.label)) expect(header).toContain(label);
    expect(header).toContain('ASM Approved By');
    expect(header).toContain('Captured On');

    const dataRow = aoa[1];
    // The photo cell rendered as hyperlink TEXT (never "[object Object]"), with the geotag inline.
    const imageCol = header.indexOf('Element 1 Image');
    expect(dataRow[imageCol]).toBe('Photo (19.24010, 73.13010)');
    expect(aoa.flat().some((v) => String(v).includes('[object Object]'))).toBe(false);
    // The Vendor column is present and carries the servicing fleet (the vendor filter is no longer
    // filtering on an invisible field).
    expect(header).toContain('Vendor');
    expect(dataRow[header.indexOf('Vendor')]).toBe('Prime Fleet');
    // Audit-trail values are present in the Excel row.
    expect(dataRow[header.indexOf('ASM Approved By')]).toBe('Asha ASM');
    expect(dataRow[header.indexOf('HO Approved By')]).toBe('Hari HO');
  });

  it('with no origin, the photo hyperlink target DEGRADES to the relative backend view-path', async () => {
    const { service, fns } = makeService();
    fns.site.findMany.mockResolvedValueOnce([sampleSite()]).mockResolvedValue([]);

    const buf = await streamToBuffer(service.outletExecutionXlsxStream(admin(), {}));
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const imageCol = aoa[0].indexOf('Element 1 Image');
    const addr = XLSX.utils.encode_cell({ r: 1, c: imageCol });
    expect((ws[addr] as XLSX.CellObject).l?.Target).toBe('/v1/media/view?key=r1');
  });

  it('with a valid origin, the photo hyperlink target is ABSOLUTE on the app origin + /api surface', async () => {
    const { service, fns } = makeService();
    fns.site.findMany.mockResolvedValueOnce([sampleSite()]).mockResolvedValue([]);

    const buf = await streamToBuffer(
      service.outletExecutionXlsxStream(admin(), { origin: 'https://app.kwality.in' }),
    );
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const imageCol = aoa[0].indexOf('Element 1 Image');
    const addr = XLSX.utils.encode_cell({ r: 1, c: imageCol });
    expect((ws[addr] as XLSX.CellObject).l?.Target).toBe('https://app.kwality.in/api/media/view?key=r1');
  });

  it('an INVALID origin (e.g. carrying a path) falls back to the relative view-path (never a bad absolute URL)', async () => {
    const { service, fns } = makeService();
    fns.site.findMany.mockResolvedValueOnce([sampleSite()]).mockResolvedValue([]);

    const buf = await streamToBuffer(
      service.outletExecutionXlsxStream(admin(), { origin: 'https://evil.test/phish' }),
    );
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const imageCol = aoa[0].indexOf('Element 1 Image');
    const addr = XLSX.utils.encode_cell({ r: 1, c: imageCol });
    expect((ws[addr] as XLSX.CellObject).l?.Target).toBe('/v1/media/view?key=r1');
  });
});
