import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { RecceHoReviewService } from './recce-ho-review.service';
import { RecceHoRejectDto } from './dto/recce-ho-reject.dto';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/** A Prisma "record to update not found" error — what a 0-row guarded write throws. */
const notFoundError = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'x',
  } as never);

/**
 * Recce-HO approval stage — scoping + transition proofs. This is the HO approval that sits between
 * ASM approval and installation, so it locks: the queue is status=APPROVED + hoReviewStatus=PENDING
 * (tenant-scoped, fail-closed); approve PENDING→APPROVED (status untouched); reject sets
 * hoReviewStatus=REJECTED AND status=REJECTED (back to the field) with a required reason code; the
 * write is status-guarded (concurrency → 409); cross-tenant id → 404; every transition audits.
 */
function makePrisma() {
  const fns: Record<string, any> = {
    recce: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    // Shared ImageHash store backing the duplicate-photo fraud signal (empty = no duplicate).
    imageHash: { findMany: jest.fn().mockResolvedValue([]) },
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

describe('RecceHoReviewService.listQueue — the recce-HO queue', () => {
  it('CLIENT_ADMIN: pins the tenant + status APPROVED + hoReviewStatus PENDING', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new RecceHoReviewService(prisma);
    await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.status).toBe('APPROVED');
    expect(where.hoReviewStatus).toBe('PENDING');
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (no clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new RecceHoReviewService(prisma);
    await svc.listQueue(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), {});
    expect(fns.recce.findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  });

  it('an assumed GIFSY_ADMIN is pinned to the assumed tenant', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new RecceHoReviewService(prisma);
    await svc.listQueue(user({ role: 'GIFSY_ADMIN', clientId: 'cX', assumed: true }), {});
    expect(fns.recce.findMany.mock.calls[0][0].where.clientId).toBe('cX');
  });

  it('includes the site + POSM photo view-paths so the HO console can render the recce', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([
      {
        id: 'r1', clientId: 'c1', status: 'APPROVED', hoReviewStatus: 'PENDING', version: 1,
        capturedAt: null, receivedAt: new Date(), reviewedAt: new Date(), hoReviewedAt: null,
        hoRejectionReasonCode: null, hoRejectionReason: null,
        geoFenceOk: true, distanceMeters: 3, captureAccuracy: 12, captureLat: null, captureLng: null,
        site: { id: 's1', code: 'S1', name: 'Site', town: 'Pune', lat: null, lng: null },
        submittedBy: { id: 'v1', name: 'Rep' }, hoReviewedBy: null,
        posms: [
          {
            id: 'rp1', slotNo: 1, dimensions: { width: 1, height: 1, unit: 'm' },
            photo: { key: 'posm-media/c1/recce.jpg' }, markup: null, qualityFlags: null,
            posmType: { id: 'pt1', code: 'BOARD', name: 'Board' },
          },
        ],
      },
    ]);
    const svc = new RecceHoReviewService(prisma);
    const res = await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(res.items[0].posms[0].photo?.viewPath).toContain('recce.jpg');
    expect(res.items[0].integrity.geoFenceOk).toBe(true);
    expect(res.items[0].hoReviewStatus).toBe('PENDING');
    // No reused photo in the store → the fraud flag is false (never dropped/undefined).
    expect(res.items[0].integrity.duplicatePhoto).toBe(false);
  });
});

describe('RecceHoReviewService — duplicate-photo fraud flag (mirrors the ASM console)', () => {
  /** One queue row shaped like RECCE_HO_INCLUDE, carrying the clientId the dup scan needs. */
  const recceRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1', clientId: 'c1', status: 'APPROVED', hoReviewStatus: 'PENDING', version: 1,
    capturedAt: null, receivedAt: new Date(), reviewedAt: new Date(), hoReviewedAt: null,
    hoRejectionReasonCode: null, hoRejectionReason: null,
    geoFenceOk: true, distanceMeters: 3, captureAccuracy: 12, captureLat: null, captureLng: null,
    site: { id: 's1', code: 'S1', name: 'Site', town: 'Pune', lat: null, lng: null },
    submittedBy: { id: 'v1', name: 'Rep' }, hoReviewedBy: null,
    posms: [{
      id: 'rp1', slotNo: 1, dimensions: { width: 1, height: 1, unit: 'm' },
      photo: { key: 'posm-media/c1/recce.jpg' }, markup: null, qualityFlags: null,
      posmType: { id: 'pt1', code: 'BOARD', name: 'Board' },
    }],
    ...over,
  });

  it('listQueue: surfaces duplicatePhoto=true when a photo hash is reused on a DIFFERENT owner', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([recceRow()]);
    // This recce's own hash...
    fns.imageHash.findMany
      .mockResolvedValueOnce([{ ownerId: 'r1', hash: 'h1' }])
      // ...also recorded under a DIFFERENT owner (another recce) in the same tenant → duplicate.
      .mockResolvedValueOnce([
        { ownerKind: 'RECCE', ownerId: 'r1', hash: 'h1' },
        { ownerKind: 'RECCE', ownerId: 'r2', hash: 'h1' },
      ]);
    const svc = new RecceHoReviewService(prisma);
    const res = await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(res.items[0].integrity.duplicatePhoto).toBe(true);
  });

  it('getRecce: surfaces duplicatePhoto=false when the hash appears only under this recce', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(recceRow());
    fns.imageHash.findMany
      .mockResolvedValueOnce([{ ownerId: 'r1', hash: 'h1' }])
      .mockResolvedValueOnce([{ ownerKind: 'RECCE', ownerId: 'r1', hash: 'h1' }]);
    const svc = new RecceHoReviewService(prisma);
    const res = await svc.getRecce(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'r1');
    expect(res.integrity.duplicatePhoto).toBe(false);
  });
});

describe('RecceHoReviewService.approve/reject — transitions', () => {
  it('approve: hoReviewStatus PENDING → APPROVED + stamps reviewer; status is NOT rewritten', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED', hoReviewStatus: 'PENDING' });
    fns.recce.update.mockResolvedValue({ id: 'r1', hoReviewStatus: 'APPROVED' });
    const svc = new RecceHoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', sub: 'ho-1', clientId: 'c1' }), 'r1');
    const call = fns.recce.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'r1', hoReviewStatus: 'PENDING' });
    expect(call.data.hoReviewStatus).toBe('APPROVED');
    expect(call.data.hoReviewedById).toBe('ho-1');
    expect(call.data.hoReviewedAt).toBeInstanceOf(Date);
    // The recce's status (APPROVED) is left intact — HO approve only flips the HO stage.
    expect(call.data.status).toBeUndefined();
    expect(fns.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'APPROVE', entityType: 'RECCE_HO_REVIEW', entityId: 'r1',
    });
  });

  it('reject: hoReviewStatus PENDING → REJECTED AND status → REJECTED + stores the reason code', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED', hoReviewStatus: 'PENDING' });
    fns.recce.update.mockResolvedValue({ id: 'r1', hoReviewStatus: 'REJECTED', status: 'REJECTED' });
    const svc = new RecceHoReviewService(prisma);
    await svc.reject(user({ role: 'CLIENT_ADMIN', sub: 'ho-1', clientId: 'c1' }), 'r1', { reasonCode: 'BLURRY', reason: 'redo' } as RecceHoRejectDto);
    const call = fns.recce.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'r1', hoReviewStatus: 'PENDING' });
    expect(call.data.hoReviewStatus).toBe('REJECTED');
    // The recce goes BACK to the field (status REJECTED), unlike the install-side HO reject.
    expect(call.data.status).toBe('REJECTED');
    expect(call.data.hoRejectionReasonCode).toBe('BLURRY');
    expect(call.data.hoRejectionReason).toBe('redo');
    expect(fns.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'REJECT', entityType: 'RECCE_HO_REVIEW', entityId: 'r1',
    });
  });

  it('the transition + its audit row run inside ONE $transaction, in order', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED', hoReviewStatus: 'PENDING' });
    const order: string[] = [];
    fns.recce.update.mockImplementation(async () => { order.push('update'); return { id: 'r1' }; });
    fns.auditLog.create.mockImplementation(async () => { order.push('audit'); return {}; });
    const svc = new RecceHoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'r1');
    expect(fns.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['update', 'audit']);
  });

  it('a non-PENDING row (already decided) → 409, never updates', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED', hoReviewStatus: 'APPROVED' });
    const svc = new RecceHoReviewService(prisma);
    await expect(svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'r1')).rejects.toBeInstanceOf(ConflictException);
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('cross-tenant id (findFirst → null) → 404, carried the clientId filter (fail-closed)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(null);
    const svc = new RecceHoReviewService(prisma);
    await expect(svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.recce.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'other', clientId: 'c1' });
  });

  it('concurrency: guarded write matches 0 rows (P2025) → 409, NO second audit row', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED', hoReviewStatus: 'PENDING' });
    fns.recce.update.mockRejectedValue(notFoundError());
    const svc = new RecceHoReviewService(prisma);
    await expect(svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'r1')).rejects.toBeInstanceOf(ConflictException);
    expect(fns.recce.update.mock.calls[0][0].where).toEqual({ id: 'r1', hoReviewStatus: 'PENDING' });
    expect(fns.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('RecceHoRejectDto — a valid reason code is required', () => {
  it('rejects a missing reasonCode', async () => {
    const dto = plainToInstance(RecceHoRejectDto, { reason: 'text only' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reasonCode')).toBe(true);
  });

  it('rejects an unknown reasonCode', async () => {
    const dto = plainToInstance(RecceHoRejectDto, { reasonCode: 'NOT_A_CODE' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reasonCode')).toBe(true);
  });

  it('accepts a known reasonCode (+ optional note)', async () => {
    const dto = plainToInstance(RecceHoRejectDto, { reasonCode: 'GEO_MISMATCH', reason: 'too far' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
