import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { AuditReviewService } from './audit-review.service';
import { RejectInstallationDto } from './dto/reject-installation.dto';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/** A Prisma "record to update/delete does not exist" error — what a 0-row guarded write throws. */
const notFoundError = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'x',
  } as never);

/**
 * Wave-2 Auditor review — scoping + transition proofs.
 * Locks: tenant-scoped queue; approve/reject transitions; cross-tenant id → 404;
 * double-audit → 409; reject requires a valid reason code.
 */
function makePrisma() {
  const fns: Record<string, any> = {
    installation: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  // Interactive-callback form: the transition + its audit row run inside ONE transaction; the
  // same mock object is handed back as the tx client.
  fns.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(fns)
      : Promise.all(arg as Promise<unknown>[]),
  );
  return { prisma: fns as unknown as PrismaService, fns };
}

const user = (over: Partial<JwtPayload>): JwtPayload => ({
  sub: 'u1', role: 'AUDITOR', clientId: 'c1', phone: '9800000000', name: 'T', ...over,
});

describe('AuditReviewService.listQueue — tenant scoping', () => {
  it('AUDITOR: where pins the tenant + status SUBMITTED', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AuditReviewService(prisma);
    await svc.listQueue(user({ role: 'AUDITOR', clientId: 'c1' }), {});
    const where = fns.installation.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.status).toBe('SUBMITTED');
  });

  it('GIFSY_ADMIN un-assumed: platform-wide (no clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AuditReviewService(prisma);
    await svc.listQueue(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), {});
    expect(fns.installation.findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  });

  it('assumed GIFSY operator: pinned to the assumed tenant', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AuditReviewService(prisma);
    await svc.listQueue(user({ role: 'GIFSY_ADMIN', clientId: 'cAssumed', assumed: true }), {});
    expect(fns.installation.findMany.mock.calls[0][0].where.clientId).toBe('cAssumed');
  });

  it('builds the per-image compare payload (recce vs install photo + distance + flags)', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findMany.mockResolvedValue([
      {
        id: 'i1', status: 'SUBMITTED', version: 1, capturedAt: null, receivedAt: new Date(),
        site: { id: 's1', code: 'S1', name: 'Site', town: 'Pune', lat: null, lng: null },
        submittedBy: { id: 'v1', name: 'Rep' },
        recce: { id: 'r1', captureLat: null, captureLng: null, captureAccuracy: 12, geoFenceOk: true },
        posms: [
          {
            id: 'ip1', reccePosmId: 'rp1', photo: { key: 'posm-media/c1/install.jpg' },
            captureLat: null, captureLng: null, geoFenceOk: true,
            distanceFromRecce: 3.5, beforeAfterDiffOk: true, qualityFlags: { blur: false },
            reccePosm: { photo: 'posm-media/c1/recce.jpg', dimensions: { width: 1, height: 1, unit: 'm' }, markup: null, posmType: { id: 'pt1', code: 'BOARD', name: 'Board' } },
          },
        ],
      },
    ]);
    const svc = new AuditReviewService(prisma);
    const res = await svc.listQueue(user({ role: 'AUDITOR', clientId: 'c1' }), {});
    const row = res.items[0].compare[0];
    expect(row.reccePhoto?.viewPath).toContain('recce.jpg');
    expect(row.installPhoto?.viewPath).toContain('install.jpg');
    expect(row.posmType.code).toBe('BOARD');
    expect(row.distanceFromRecce).toBe(3.5);
    expect(row.beforeAfterDiffOk).toBe(true);
  });
});

describe('AuditReviewService.getInstallation — scoped detail read (any status)', () => {
  const installRow = () => ({
    id: 'i1', status: 'AUDIT_APPROVED', version: 1, capturedAt: null, receivedAt: new Date(),
    site: { id: 's1', code: 'S1', name: 'Site', town: 'Pune', lat: null, lng: null },
    submittedBy: { id: 'v1', name: 'Rep' },
    recce: { id: 'r1', captureLat: null, captureLng: null, captureAccuracy: 12, geoFenceOk: true },
    posms: [
      {
        id: 'ip1', reccePosmId: 'rp1', photo: { key: 'posm-media/c1/install.jpg' },
        captureLat: null, captureLng: null, geoFenceOk: true,
        distanceFromRecce: 3.5, beforeAfterDiffOk: true, qualityFlags: null,
        reccePosm: { photo: 'posm-media/c1/recce.jpg', dimensions: { width: 1, height: 1, unit: 'm' }, markup: null, posmType: { id: 'pt1', code: 'BOARD', name: 'Board' } },
      },
    ],
  });

  it('AUDITOR: findFirst pins the tenant + id; returns the mapped compare item (even when already audited)', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue(installRow());
    const svc = new AuditReviewService(prisma);
    const item = await svc.getInstallation(user({ role: 'AUDITOR', clientId: 'c1' }), 'i1');
    expect(fns.installation.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'i1', clientId: 'c1' });
    expect(item).toMatchObject({ id: 'i1', status: 'AUDIT_APPROVED' });
    expect(item.compare[0].installPhoto?.viewPath).toContain('install.jpg');
    expect(item.compare[0].reccePhoto?.viewPath).toContain('recce.jpg');
  });

  it('a cross-tenant / missing id (findFirst → null) → 404', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue(null);
    const svc = new AuditReviewService(prisma);
    await expect(
      svc.getInstallation(user({ role: 'AUDITOR', clientId: 'c1' }), 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (no clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue(installRow());
    const svc = new AuditReviewService(prisma);
    await svc.getInstallation(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), 'i1');
    expect(fns.installation.findFirst.mock.calls[0][0].where.clientId).toBeUndefined();
  });
});

describe('AuditReviewService.approve/reject — transitions', () => {
  it('approves a SUBMITTED installation → AUDIT_APPROVED + stamps auditedById/auditedAt', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'SUBMITTED' });
    fns.installation.update.mockResolvedValue({ id: 'i1', status: 'AUDIT_APPROVED' });
    const svc = new AuditReviewService(prisma);
    await svc.approve(user({ role: 'AUDITOR', sub: 'aud-1', clientId: 'c1' }), 'i1');
    const data = fns.installation.update.mock.calls[0][0].data;
    expect(data.status).toBe('AUDIT_APPROVED');
    expect(data.auditedById).toBe('aud-1');
    expect(data.auditedAt).toBeInstanceOf(Date);
    expect(fns.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'APPROVE', entityType: 'INSTALLATION', entityId: 'i1' });
  });

  it('Fix 3: the transition + its audit row run inside ONE $transaction (atomic)', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'SUBMITTED' });
    fns.installation.update.mockResolvedValue({ id: 'i1', status: 'AUDIT_APPROVED' });
    const order: string[] = [];
    fns.installation.update.mockImplementation(async () => { order.push('update'); return { id: 'i1', status: 'AUDIT_APPROVED' }; });
    fns.auditLog.create.mockImplementation(async () => { order.push('audit'); return {}; });
    const svc = new AuditReviewService(prisma);
    await svc.approve(user({ role: 'AUDITOR', sub: 'aud-1', clientId: 'c1' }), 'i1');
    // A single transaction wraps both writes, in order (state change then append-only audit).
    expect(fns.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['update', 'audit']);
  });

  it('rejects a SUBMITTED installation → AUDIT_REJECTED + reason code, audit REJECT', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'SUBMITTED' });
    fns.installation.update.mockResolvedValue({ id: 'i1', status: 'AUDIT_REJECTED' });
    const svc = new AuditReviewService(prisma);
    await svc.reject(user({ role: 'AUDITOR', sub: 'aud-1', clientId: 'c1' }), 'i1', { reasonCode: 'POSM_NOT_VISIBLE' } as RejectInstallationDto);
    const data = fns.installation.update.mock.calls[0][0].data;
    expect(data.status).toBe('AUDIT_REJECTED');
    expect(data.rejectionReasonCode).toBe('POSM_NOT_VISIBLE');
    expect(fns.auditLog.create.mock.calls[0][0].data.action).toBe('REJECT');
  });

  it('a cross-tenant installation id → 404 (findFirst carried the clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue(null);
    const svc = new AuditReviewService(prisma);
    await expect(svc.approve(user({ role: 'AUDITOR', clientId: 'c1' }), 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.installation.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'other', clientId: 'c1' });
  });

  it('double-audit (already AUDIT_APPROVED) → 409, never updates', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'AUDIT_APPROVED' });
    const svc = new AuditReviewService(prisma);
    await expect(svc.approve(user({ role: 'AUDITOR', clientId: 'c1' }), 'i1')).rejects.toBeInstanceOf(ConflictException);
    expect(fns.installation.update).not.toHaveBeenCalled();
  });

  it('A2: a concurrent approve whose guarded write matches 0 rows → 409, NO second audit row', async () => {
    const { prisma, fns } = makePrisma();
    // Pre-read still sees SUBMITTED (both racers pass assertSubmitted)...
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'SUBMITTED' });
    // ...but the status-guarded update matches 0 rows because the winner already flipped it.
    fns.installation.update.mockRejectedValue(notFoundError());
    const svc = new AuditReviewService(prisma);
    await expect(svc.approve(user({ role: 'AUDITOR', sub: 'aud-1', clientId: 'c1' }), 'i1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fns.installation.update.mock.calls[0][0].where).toEqual({ id: 'i1', status: 'SUBMITTED' });
    expect(fns.auditLog.create).not.toHaveBeenCalled();
  });

  it('A2: a concurrent reject whose guarded write matches 0 rows → 409, NO second audit row', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'SUBMITTED' });
    fns.installation.update.mockRejectedValue(notFoundError());
    const svc = new AuditReviewService(prisma);
    await expect(
      svc.reject(user({ role: 'AUDITOR', sub: 'aud-1', clientId: 'c1' }), 'i1', {
        reasonCode: 'POSM_NOT_VISIBLE',
      } as RejectInstallationDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fns.installation.update.mock.calls[0][0].where).toEqual({ id: 'i1', status: 'SUBMITTED' });
    expect(fns.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('RejectInstallationDto — a valid reason code is required', () => {
  it('rejects an unknown reasonCode', async () => {
    const errors = await validate(plainToInstance(RejectInstallationDto, { reasonCode: 'NOPE' }));
    expect(errors.some((e) => e.property === 'reasonCode')).toBe(true);
  });

  it('accepts a known reasonCode', async () => {
    const errors = await validate(plainToInstance(RejectInstallationDto, { reasonCode: 'WRONG_POSM' }));
    expect(errors).toHaveLength(0);
  });
});
