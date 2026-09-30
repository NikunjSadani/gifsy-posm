import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HoReviewService } from './ho-review.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/** A Prisma "record to update not found" error — what a 0-row guarded write throws. */
const notFoundError = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'x',
  } as never);

/**
 * HO/Admin escalation stage — scoping + transition proofs. The HO stage is an APPROVAL/AUTHORITY
 * path (owner decision 2026-09-30), so it locks: only PENDING rows transition; the write is
 * status-guarded (concurrency → 409); the auditor's AUDIT_REJECTED status is NEVER rewritten
 * (only hoReviewStatus changes); cross-tenant id → 404; and every transition appends an audit row.
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
  fns.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(fns)
      : Promise.all(arg as Promise<unknown>[]),
  );
  return { prisma: fns as unknown as PrismaService, fns };
}

const user = (over: Partial<JwtPayload>): JwtPayload => ({
  sub: 'ho1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'HO', ...over,
});

describe('HoReviewService.listQueue — the escalation queue', () => {
  it('CLIENT_ADMIN: pins the tenant + status AUDIT_REJECTED + hoReviewStatus PENDING', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new HoReviewService(prisma);
    await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    const where = fns.installation.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.status).toBe('AUDIT_REJECTED');
    expect(where.hoReviewStatus).toBe('PENDING');
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (no clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new HoReviewService(prisma);
    await svc.listQueue(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), {});
    expect(fns.installation.findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  });

  it('surfaces the auditor rejection reason + before/after compare so HO can decide', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findMany.mockResolvedValue([
      {
        id: 'i1', status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING', version: 1,
        capturedAt: null, receivedAt: new Date(), auditedAt: new Date(), hoReviewedAt: null,
        rejectionReasonCode: 'POSM_NOT_VISIBLE', rejectionReason: 'blocked', hoRejectionReason: null,
        site: { id: 's1', code: 'S1', name: 'Site', town: 'Pune', lat: null, lng: null },
        submittedBy: { id: 'v1', name: 'Rep' }, auditedBy: { id: 'a1', name: 'Auditor' }, hoReviewedBy: null,
        recce: { id: 'r1', captureLat: null, captureLng: null, captureAccuracy: 12, geoFenceOk: true },
        posms: [
          {
            id: 'ip1', reccePosmId: 'rp1', photo: { key: 'posm-media/c1/install.jpg' },
            captureLat: null, captureLng: null, geoFenceOk: true,
            distanceFromRecce: 3.5, beforeAfterDiffOk: true, qualityFlags: null,
            reccePosm: { photo: 'posm-media/c1/recce.jpg', dimensions: { width: 1, height: 1, unit: 'm' }, markup: null, posmType: { id: 'pt1', code: 'BOARD', name: 'Board' } },
          },
        ],
      },
    ]);
    const svc = new HoReviewService(prisma);
    const res = await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(res.items[0].auditRejection).toEqual({ reasonCode: 'POSM_NOT_VISIBLE', reason: 'blocked' });
    expect(res.items[0].auditedBy).toEqual({ id: 'a1', name: 'Auditor' });
    expect(res.items[0].compare[0].installPhoto?.viewPath).toContain('install.jpg');
    expect(res.items[0].compare[0].reccePhoto?.viewPath).toContain('recce.jpg');
  });
});

describe('HoReviewService.approve/reject — transitions', () => {
  it('approve: hoReviewStatus PENDING → APPROVED + stamps reviewer; status is NOT rewritten', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING' });
    fns.installation.update.mockResolvedValue({ id: 'i1', hoReviewStatus: 'APPROVED' });
    const svc = new HoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', sub: 'ho-1', clientId: 'c1' }), 'i1');
    const call = fns.installation.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'i1', hoReviewStatus: 'PENDING' });
    expect(call.data.hoReviewStatus).toBe('APPROVED');
    expect(call.data.hoReviewedById).toBe('ho-1');
    expect(call.data.hoReviewedAt).toBeInstanceOf(Date);
    // The auditor's decision (installation.status) is never touched by the HO stage.
    expect(call.data.status).toBeUndefined();
    expect(fns.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'APPROVE', entityType: 'INSTALLATION_HO_REVIEW', entityId: 'i1',
    });
  });

  it('reject: hoReviewStatus PENDING → REJECTED + stores the HO note (terminal)', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING' });
    fns.installation.update.mockResolvedValue({ id: 'i1', hoReviewStatus: 'REJECTED' });
    const svc = new HoReviewService(prisma);
    await svc.reject(user({ role: 'CLIENT_ADMIN', sub: 'ho-1', clientId: 'c1' }), 'i1', { reason: 'upheld' });
    const call = fns.installation.update.mock.calls[0][0];
    expect(call.data.hoReviewStatus).toBe('REJECTED');
    expect(call.data.hoRejectionReason).toBe('upheld');
    expect(call.data.status).toBeUndefined();
    expect(fns.auditLog.create.mock.calls[0][0].data.action).toBe('REJECT');
  });

  it('the transition + its audit row run inside ONE $transaction, in order', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING' });
    const order: string[] = [];
    fns.installation.update.mockImplementation(async () => { order.push('update'); return { id: 'i1' }; });
    fns.auditLog.create.mockImplementation(async () => { order.push('audit'); return {}; });
    const svc = new HoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'i1');
    expect(fns.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['update', 'audit']);
  });

  it('a non-PENDING row (already decided) → 409, never updates', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'AUDIT_REJECTED', hoReviewStatus: 'APPROVED' });
    const svc = new HoReviewService(prisma);
    await expect(svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'i1')).rejects.toBeInstanceOf(ConflictException);
    expect(fns.installation.update).not.toHaveBeenCalled();
  });

  it('cross-tenant id (findFirst → null) → 404, carried the clientId filter', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue(null);
    const svc = new HoReviewService(prisma);
    await expect(svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.installation.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'other', clientId: 'c1' });
  });

  it('concurrency: guarded write matches 0 rows (P2025) → 409, NO second audit row', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findFirst.mockResolvedValue({ id: 'i1', status: 'AUDIT_REJECTED', hoReviewStatus: 'PENDING' });
    fns.installation.update.mockRejectedValue(notFoundError());
    const svc = new HoReviewService(prisma);
    await expect(svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'i1')).rejects.toBeInstanceOf(ConflictException);
    expect(fns.installation.update.mock.calls[0][0].where).toEqual({ id: 'i1', hoReviewStatus: 'PENDING' });
    expect(fns.auditLog.create).not.toHaveBeenCalled();
  });
});
