import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
    // Site used by the manual-recce Outlet-ID exists-check + code write at approve.
    site: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    // Installation count backs the attach orphan-cleanup guard (0 = source outlet now empty).
    installation: { count: jest.fn().mockResolvedValue(0) },
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
  it('CLIENT_ADMIN: pins the tenant + widens to app OR manual pending-HO clauses', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new RecceHoReviewService(prisma);
    await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    // R4 — app (ASM-approved, pending HO) OR manual (skipped ASM, SUBMITTED, pending HO).
    expect(where.OR).toEqual([
      { status: 'APPROVED', hoReviewStatus: 'PENDING' },
      { recceMode: 'MANUAL', status: 'SUBMITTED', hoReviewStatus: 'PENDING' },
    ]);
  });

  it('mode=manual narrows to the manual clause; mode=app to the app clause', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new RecceHoReviewService(prisma);
    await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { mode: 'manual' });
    expect(fns.recce.findMany.mock.calls[0][0].where.OR).toEqual([
      { recceMode: 'MANUAL', status: 'SUBMITTED', hoReviewStatus: 'PENDING' },
    ]);
    await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { mode: 'app' });
    expect(fns.recce.findMany.mock.calls[1][0].where.OR).toEqual([
      { status: 'APPROVED', hoReviewStatus: 'PENDING' },
    ]);
  });

  it('a manual queue item carries recceMode + outletId (null while the code is provisional)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([
      {
        id: 'rM', clientId: 'c1', status: 'SUBMITTED', recceMode: 'MANUAL', hoReviewStatus: 'PENDING', version: 1,
        capturedAt: null, receivedAt: new Date(), reviewedAt: null, hoReviewedAt: null,
        hoRejectionReasonCode: null, hoRejectionReason: null,
        geoFenceOk: null, distanceMeters: null, captureAccuracy: null, captureLat: null, captureLng: null,
        site: { id: 's1', code: 'MAN-abc', name: 'Prov Shop', town: null, lat: null, lng: null },
        submittedBy: { id: 'v1', name: 'Rep' }, hoReviewedBy: null,
        posms: [{ id: 'rp1', slotNo: 1, dimensions: {}, photo: { key: 'posm-media/c1/p.jpg' }, markup: null, qualityFlags: null, posmType: { id: 'pt1', code: 'B', name: 'Board' } }],
      },
    ]);
    const svc = new RecceHoReviewService(prisma);
    const res = await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(res.items[0].recceMode).toBe('MANUAL');
    expect(res.items[0].outletId).toBeNull(); // provisional MAN- code → no real Outlet ID yet
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

describe('RecceHoReviewService.approve — MANUAL recces (Outlet-ID gate)', () => {
  const manualRecce = (over: Record<string, unknown> = {}) => ({
    id: 'rM', clientId: 'c1', status: 'SUBMITTED', hoReviewStatus: 'PENDING', recceMode: 'MANUAL',
    site: { id: 's1', code: 'MAN-abc', name: 'Prov Shop', vendorId: 'V1' },
    ...over,
  });

  it('no outletId + a provisional outlet code → 400, never updates', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce());
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fns.recce.update).not.toHaveBeenCalled();
    expect(fns.site.update).not.toHaveBeenCalled();
  });

  it('with a new outletId → writes site.code AND sets status=APPROVED + hoReviewStatus=APPROVED', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce());
    fns.site.findFirst.mockResolvedValue(null); // no collision
    fns.recce.update.mockResolvedValue({ id: 'rM', status: 'APPROVED', hoReviewStatus: 'APPROVED' });
    const svc = new RecceHoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', sub: 'ho-1', clientId: 'c1' }), 'rM', { outletId: 'OUT-9' });
    // The provisional code is overwritten with the real Outlet ID.
    expect(fns.site.update.mock.calls[0][0]).toMatchObject({ where: { id: 's1' }, data: { code: 'OUT-9' } });
    const data = fns.recce.update.mock.calls[0][0].data;
    // No ASM stage → HO sets BOTH, so the install gate (status===APPROVED && hoReviewStatus===APPROVED) passes.
    expect(data.status).toBe('APPROVED');
    expect(data.hoReviewStatus).toBe('APPROVED');
    expect(fns.recce.update.mock.calls[0][0].where).toEqual({ id: 'rM', hoReviewStatus: 'PENDING' });
  });

  it('D6 exists-check: an outletId matching a DIFFERENT outlet → 409 with that outlet name, no write', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce());
    fns.site.findFirst.mockResolvedValue({ name: 'Shah Stores' }); // OUT-9 already belongs elsewhere
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'OUT-9' }),
    ).rejects.toThrow(/Shah Stores/);
    expect(fns.recce.update).not.toHaveBeenCalled();
    // The exists-check excludes the recce's own site row.
    expect(fns.site.findFirst.mock.calls[0][0].where).toMatchObject({ clientId: 'c1', code: 'OUT-9', id: { not: 's1' } });
  });

  it('outlet already carries a REAL code, no outletId → approves without rewriting the code', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce({ site: { id: 's1', code: 'OUT1', name: 'Real Shop' } }));
    fns.recce.update.mockResolvedValue({ id: 'rM' });
    const svc = new RecceHoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', {});
    expect(fns.site.update).not.toHaveBeenCalled();
    expect(fns.recce.update.mock.calls[0][0].data.status).toBe('APPROVED');
    expect(fns.recce.update.mock.calls[0][0].data.hoReviewStatus).toBe('APPROVED');
  });

  it('outlet already carries a REAL code + a DIFFERENT outletId → 409, never renames the master outlet (audit F1)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce({ site: { id: 's1', code: 'OUT1', name: 'Real Shop' } }));
    fns.site.findFirst.mockResolvedValue(null); // the new id is free elsewhere — still must not rename an established outlet
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'OUT-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fns.site.update).not.toHaveBeenCalled();
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('a provided outletId using the reserved MAN- prefix → 400, no write (audit F2)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce());
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'MAN-xyz' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fns.site.update).not.toHaveBeenCalled();
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('ATTACH on collision (attachToExisting) — re-parents onto the existing outlet, approves, deactivates + audits the orphan provisional', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce()); // provisional MAN-abc, vendor V1
    // Target: active, same fleet, NO lat/lng → geo re-fence is skipped (returns {}).
    fns.site.findFirst.mockResolvedValue({ id: 's2', code: 'OUT-9', name: 'Shah Stores', vendorId: 'V1', status: 'ACTIVE' });
    fns.recce.update.mockResolvedValue({ id: 'rM', status: 'APPROVED', hoReviewStatus: 'APPROVED', siteId: 's2' });
    fns.recce.count.mockResolvedValue(0); // source now empty
    fns.installation.count.mockResolvedValue(0);
    const svc = new RecceHoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', sub: 'ho-1', clientId: 'c1' }), 'rM', { outletId: 'OUT-9', attachToExisting: true });
    const upd = fns.recce.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'rM', hoReviewStatus: 'PENDING' });
    expect(upd.data).toMatchObject({ siteId: 's2', status: 'APPROVED', hoReviewStatus: 'APPROVED' });
    // the orphaned provisional source outlet is deactivated AND the Site change is audited (F4)
    expect(fns.site.update.mock.calls[0][0]).toMatchObject({ where: { id: 's1' }, data: { status: 'INACTIVE' } });
    expect(fns.auditLog.create.mock.calls.some((c: any[]) => c[0].data.entityType === 'SITE' && c[0].data.entityId === 's1')).toBe(true);
  });

  it('ATTACH blocked across fleets — target serviced by a different vendor → 409, no write', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce()); // vendor V1
    fns.site.findFirst.mockResolvedValue({ id: 's2', code: 'OUT-9', name: 'Other Fleet Shop', vendorId: 'V2', status: 'ACTIVE' });
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'OUT-9', attachToExisting: true }),
    ).rejects.toThrow(/different fleet/i);
    expect(fns.recce.update).not.toHaveBeenCalled();
    expect(fns.site.update).not.toHaveBeenCalled();
  });

  it('ATTACH onto a FLEET-LESS target → succeeds + the outlet adopts the recce\'s fleet (audit F5)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce()); // provisional, vendor V1
    fns.site.findFirst.mockResolvedValue({ id: 's2', code: 'OUT-9', name: 'Unassigned Outlet', vendorId: null, status: 'ACTIVE' });
    fns.recce.update.mockResolvedValue({ id: 'rM', siteId: 's2' });
    fns.recce.count.mockResolvedValue(0);
    fns.installation.count.mockResolvedValue(0);
    const svc = new RecceHoReviewService(prisma);
    await svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'OUT-9', attachToExisting: true });
    expect(fns.recce.update.mock.calls[0][0].data.siteId).toBe('s2'); // re-parented
    // the fleet-less target adopts the recce's fleet (V1)
    expect(fns.site.update.mock.calls.some((c: any[]) => c[0].where.id === 's2' && c[0].data.vendorId === 'V1')).toBe(true);
  });

  it('ATTACH blocked onto a DEACTIVATED target outlet → 409, no write (audit F2)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce()); // provisional, vendor V1
    fns.site.findFirst.mockResolvedValue({ id: 's2', code: 'OUT-9', name: 'Dead Outlet', vendorId: 'V1', status: 'INACTIVE' });
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'OUT-9', attachToExisting: true }),
    ).rejects.toThrow(/deactivated/i);
    expect(fns.recce.update).not.toHaveBeenCalled();
    expect(fns.site.update).not.toHaveBeenCalled();
  });

  it('ATTACH refused from a REAL (non-provisional) source — can\'t MOVE an established-outlet recce (audit F3)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce({ site: { id: 's1', code: 'OUT1', name: 'Real Source', vendorId: 'V1' } }));
    fns.site.findFirst.mockResolvedValue({ id: 's2', code: 'OUT-9', name: 'Target', vendorId: 'V1', status: 'ACTIVE' });
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'OUT-9', attachToExisting: true }),
    ).rejects.toThrow(/can't be moved to another outlet/i);
    expect(fns.recce.update).not.toHaveBeenCalled();
    expect(fns.site.update).not.toHaveBeenCalled();
  });

  it('without attachToExisting a colliding Outlet ID still 409s (default stays "pick another ID")', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(manualRecce());
    fns.site.findFirst.mockResolvedValue({ id: 's2', code: 'OUT-9', name: 'Shah Stores', vendorId: 'V1' });
    const svc = new RecceHoReviewService(prisma);
    await expect(
      svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'rM', { outletId: 'OUT-9' }),
    ).rejects.toThrow(/already belongs to another outlet/i);
    expect(fns.recce.update).not.toHaveBeenCalled();
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
