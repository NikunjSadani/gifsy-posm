import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { ApprovalService } from './approval.service';
import { RejectRecceDto } from './dto/reject-recce.dto';
import { RecordsStage } from './dto/records-query.dto';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/** A Prisma "record to update/delete does not exist" error — what a 0-row guarded write throws. */
const notFoundError = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'x',
  } as never);

/**
 * Wave-2 ASM approval — SECURITY + transition proofs.
 * Locks: ASM sees only own-site recces; ASM cannot approve a foreign-site recce (403);
 * reject requires a valid reason code; double-approve → 409; bulk skips out-of-scope.
 */
function makePrisma() {
  const fns: Record<string, any> = {
    recce: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    site: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    installation: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    reccePosm: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
    installPosm: { count: jest.fn().mockResolvedValue(0) },
    posmType: { findMany: jest.fn().mockResolvedValue([]) },
    imageHash: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
  };
  // Supports BOTH the array form and the interactive-callback form (bulkApprove uses the latter,
  // passing the same mock object as the tx client).
  fns.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(fns)
      : Promise.all(arg as Promise<unknown>[]),
  );
  return { prisma: fns as unknown as PrismaService, fns };
}

const user = (over: Partial<JwtPayload>): JwtPayload => ({
  sub: 'u1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'T', ...over,
});

describe('ApprovalService.listQueue — scoping', () => {
  it('ASM: where pins the tenant AND site.asmUserId = user.sub, status SUBMITTED', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.listQueue(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), {});
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.site).toEqual({ asmUserId: 'asm-7' });
    expect(where.status).toBe('SUBMITTED');
  });

  it('CLIENT_ADMIN: tenant-scoped, no site narrowing', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.listQueue(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.site).toBeUndefined();
  });

  it('GIFSY_ADMIN un-assumed: platform-wide (no clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.listQueue(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), {});
    expect(fns.recce.findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  });

  it('ASM site filter merges into (never overwrites) the asm-territory pin', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.listQueue(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { town: 'Pune' });
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where.site).toEqual({ asmUserId: 'asm-7', town: { contains: 'Pune', mode: 'insensitive' } });
  });
});

describe('ApprovalService.approve — transition + scope re-check on the mutation', () => {
  it('ASM approves an own-site SUBMITTED recce → APPROVED + stamps approvedById/reviewedAt', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'SUBMITTED', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    fns.recce.update.mockResolvedValue({ id: 'r1', status: 'APPROVED' });
    const svc = new ApprovalService(prisma);
    await svc.approve(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1');
    const data = fns.recce.update.mock.calls[0][0].data;
    expect(data.status).toBe('APPROVED');
    expect(data.approvedById).toBe('asm-7');
    expect(data.reviewedAt).toBeInstanceOf(Date);
    // ASM approve hands the recce to the HO review stage (no longer unlocks install directly).
    expect(data.hoReviewStatus).toBe('PENDING');
    const audit = fns.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'APPROVE', entityType: 'RECCE', entityId: 'r1', actorId: 'asm-7' });
  });

  it('Fix 3: the transition + its audit row run inside ONE $transaction (atomic)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'SUBMITTED', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    const order: string[] = [];
    fns.recce.update.mockImplementation(async () => { order.push('update'); return { id: 'r1', status: 'APPROVED' }; });
    fns.auditLog.create.mockImplementation(async () => { order.push('audit'); return {}; });
    const svc = new ApprovalService(prisma);
    await svc.approve(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1');
    // A single transaction wraps both writes, in order (state change then append-only audit).
    expect(fns.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['update', 'audit']);
  });

  it('ASM cannot approve a FOREIGN-site recce → 403, never updates', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r9', status: 'SUBMITTED', clientId: 'c1', site: { asmUserId: 'someone-else' } });
    const svc = new ApprovalService(prisma);
    await expect(
      svc.approve(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r9'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('a recce id outside the caller tenant → 404 (findFirst carried the clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(null);
    const svc = new ApprovalService(prisma);
    await expect(svc.approve(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.recce.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'other', clientId: 'c1' });
  });

  it('double-approve (already APPROVED) → 409, never updates', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'APPROVED', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    const svc = new ApprovalService(prisma);
    await expect(
      svc.approve(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('A2: a concurrent approve whose guarded write matches 0 rows → 409, NO second audit row', async () => {
    const { prisma, fns } = makePrisma();
    // Pre-read still sees SUBMITTED (both racers pass assertSubmitted)...
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'SUBMITTED', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    // ...but the status-guarded update matches 0 rows because the winner already flipped it.
    fns.recce.update.mockRejectedValue(notFoundError());
    const svc = new ApprovalService(prisma);
    await expect(
      svc.approve(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1'),
    ).rejects.toBeInstanceOf(ConflictException);
    // The write is status-guarded, and the loser writes NO audit row.
    expect(fns.recce.update.mock.calls[0][0].where).toEqual({ id: 'r1', status: 'SUBMITTED' });
    expect(fns.auditLog.create).not.toHaveBeenCalled();
  });

  it('A2: a concurrent reject whose guarded write matches 0 rows → 409, NO second audit row', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'SUBMITTED', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    fns.recce.update.mockRejectedValue(notFoundError());
    const svc = new ApprovalService(prisma);
    await expect(
      svc.reject(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1', { reasonCode: 'BLURRY' } as RejectRecceDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fns.recce.update.mock.calls[0][0].where).toEqual({ id: 'r1', status: 'SUBMITTED' });
    expect(fns.auditLog.create).not.toHaveBeenCalled();
  });

  it('un-assumed GIFSY_ADMIN approve issues NO clientId filter (platform-wide)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'SUBMITTED', clientId: 'cX', site: { asmUserId: null } });
    fns.recce.update.mockResolvedValue({ id: 'r1', status: 'APPROVED' });
    const svc = new ApprovalService(prisma);
    await svc.approve(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), 'r1');
    expect(fns.recce.findFirst.mock.calls[0][0].where.clientId).toBeUndefined();
  });
});

describe('ApprovalService.reject — transition', () => {
  it('rejects a SUBMITTED recce → REJECTED + reason code, audit REJECT', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'SUBMITTED', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    fns.recce.update.mockResolvedValue({ id: 'r1', status: 'REJECTED' });
    const svc = new ApprovalService(prisma);
    await svc.reject(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1', { reasonCode: 'BLURRY' } as RejectRecceDto);
    const data = fns.recce.update.mock.calls[0][0].data;
    expect(data.status).toBe('REJECTED');
    expect(data.rejectionReasonCode).toBe('BLURRY');
    expect(fns.auditLog.create.mock.calls[0][0].data.action).toBe('REJECT');
  });

  it('reject on an already-REJECTED recce → 409', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'r1', status: 'REJECTED', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    const svc = new ApprovalService(prisma);
    await expect(
      svc.reject(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1', { reasonCode: 'OTHER' } as RejectRecceDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RejectRecceDto — a valid reason code is required', () => {
  it('rejects an unknown reasonCode', async () => {
    const dto = plainToInstance(RejectRecceDto, { reasonCode: 'NOT_A_CODE' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reasonCode')).toBe(true);
  });

  it('rejects a missing reasonCode', async () => {
    const dto = plainToInstance(RejectRecceDto, { reason: 'text only' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reasonCode')).toBe(true);
  });

  it('accepts a known reasonCode', async () => {
    const dto = plainToInstance(RejectRecceDto, { reasonCode: 'GEO_MISMATCH', reason: 'too far' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('ApprovalService.bulkApprove — scoped, approve-only, skips out-of-scope', () => {
  it('approves in-scope SUBMITTED recces and SKIPS foreign-site / non-submitted / missing', async () => {
    const { prisma, fns } = makePrisma();
    // First findMany = the scoped candidate read (with site); the second (status APPROVED + select)
    // is the A3 transitioned re-select inside the transaction.
    fns.recce.findMany.mockImplementation((args: any) => {
      if (args?.where?.status === 'APPROVED') return Promise.resolve([{ id: 'ok' }]);
      return Promise.resolve([
        { id: 'ok', status: 'SUBMITTED', site: { asmUserId: 'asm-7' } },
        { id: 'foreign', status: 'SUBMITTED', site: { asmUserId: 'other' } },
        { id: 'done', status: 'APPROVED', site: { asmUserId: 'asm-7' } },
        // 'missing' is absent from the result set entirely.
      ]);
    });
    const svc = new ApprovalService(prisma);
    const res = await svc.bulkApprove(
      user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }),
      { ids: ['ok', 'foreign', 'done', 'missing'] },
    );
    expect(res.approvedIds).toEqual(['ok']);
    expect(res.approvedCount).toBe(1);
    const reasons = Object.fromEntries(res.skipped.map((s) => [s.id, s.reason]));
    expect(reasons).toEqual({ foreign: 'FORBIDDEN', done: 'INVALID_STATUS_APPROVED', missing: 'NOT_FOUND' });
    // Only the approvable id is written, guarded on status SUBMITTED.
    expect(fns.recce.updateMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['ok'] }, status: 'SUBMITTED' });
    // Bulk approve also hands each approved recce to the HO review stage (hoReviewStatus PENDING).
    expect(fns.recce.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', hoReviewStatus: 'PENDING' });
    // Audit rows reflect the transitioned set, not the pre-read candidate list.
    expect(fns.auditLog.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ entityId: 'ok', action: 'APPROVE', entityType: 'RECCE' }),
    ]);
  });

  it('approves nothing when every id is out of scope (no write, no audit)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([{ id: 'foreign', status: 'SUBMITTED', site: { asmUserId: 'other' } }]);
    const svc = new ApprovalService(prisma);
    const res = await svc.bulkApprove(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { ids: ['foreign'] });
    expect(res.approvedCount).toBe(0);
    expect(fns.recce.updateMany).not.toHaveBeenCalled();
    expect(fns.auditLog.createMany).not.toHaveBeenCalled();
  });

  it('A3: reports the ACTUAL transitioned count/ids when a race already flipped some candidates', async () => {
    const { prisma, fns } = makePrisma();
    // Both ids pass scope + were SUBMITTED at read time → both candidates.
    // But between the read and the guarded write, a concurrent request flipped 'ok2', so the
    // re-select by THIS call's stamp returns only 'ok1'.
    fns.recce.findMany.mockImplementation((args: any) => {
      if (args?.where?.status === 'APPROVED') return Promise.resolve([{ id: 'ok1' }]);
      return Promise.resolve([
        { id: 'ok1', status: 'SUBMITTED', site: { asmUserId: 'asm-7' } },
        { id: 'ok2', status: 'SUBMITTED', site: { asmUserId: 'asm-7' } },
      ]);
    });
    // The guarded updateMany only flips the row still SUBMITTED.
    fns.recce.updateMany.mockResolvedValue({ count: 1 });
    const svc = new ApprovalService(prisma);
    const res = await svc.bulkApprove(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { ids: ['ok1', 'ok2'] });

    // Count + ids reflect only what THIS call transitioned — never the over-reported candidate list.
    expect(res.approvedIds).toEqual(['ok1']);
    expect(res.approvedCount).toBe(1);
    // The race-skipped candidate is surfaced as skipped, not silently claim-approved.
    expect(res.skipped).toContainEqual({ id: 'ok2', reason: 'INVALID_STATUS_RACE' });
    // Audit rows are appended ONLY for the transitioned id (no phantom 'ok2' APPROVE row).
    const auditData = fns.auditLog.createMany.mock.calls[0][0].data;
    expect(auditData).toHaveLength(1);
    expect(auditData[0]).toMatchObject({ entityId: 'ok1', action: 'APPROVE' });
  });
});

describe('ApprovalService.getRecce — scoped detail read (any status)', () => {
  const recceRow = () => ({
    id: 'r1', status: 'SUBMITTED', version: 1, clientId: 'c1',
    capturedAt: new Date(), receivedAt: new Date(),
    geoFenceOk: true, distanceMeters: null, captureAccuracy: 10, captureLat: null, captureLng: null,
    site: { id: 's1', code: 'A1', name: 'Site A1', town: 'Pune', lat: null, lng: null },
    submittedBy: { id: 'u1', name: 'Field' },
    posms: [],
  });

  it('ASM: findFirst pins tenant + site.asmUserId + id; returns the mapped item', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(recceRow());
    const svc = new ApprovalService(prisma);
    const item = await svc.getRecce(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1');
    const where = fns.recce.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'r1', clientId: 'c1', site: { asmUserId: 'asm-7' } });
    expect(item).toMatchObject({ id: 'r1', status: 'SUBMITTED' });
    expect(item.integrity.duplicatePhoto).toBe(false);
  });

  it('maps per-POSM qualityFlags: normalises a stored object and yields null when absent/legacy', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({
      ...recceRow(),
      posms: [
        {
          id: 'p1', slotNo: 1, posmType: { id: 't1', code: 'A', name: 'Board' },
          dimensions: null, photo: null, markup: null,
          qualityFlags: { blur: true, blank: true, lowLight: false, overexposed: true, lowAccuracy: false },
        },
        // Legacy recce: column was NULL before the feature existed.
        {
          id: 'p2', slotNo: 2, posmType: { id: 't2', code: 'B', name: 'Shelf' },
          dimensions: null, photo: null, markup: null, qualityFlags: null,
        },
      ],
    });
    const svc = new ApprovalService(prisma);
    const item = await svc.getRecce(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1');
    expect(item.posms[0].qualityFlags).toEqual({
      blur: true, blank: true, lowLight: false, overexposed: true, lowAccuracy: false,
    });
    expect(item.posms[1].qualityFlags).toBeNull();
  });

  it('an id outside the caller scope (findFirst → null) → 404', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(null);
    const svc = new ApprovalService(prisma);
    await expect(
      svc.getRecce(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CLIENT_ADMIN: tenant-scoped, no site narrowing', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(recceRow());
    const svc = new ApprovalService(prisma);
    await svc.getRecce(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), 'r1');
    const where = fns.recce.findFirst.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.site).toBeUndefined();
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (no clientId filter)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(recceRow());
    const svc = new ApprovalService(prisma);
    await svc.getRecce(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), 'r1');
    expect(fns.recce.findFirst.mock.calls[0][0].where.clientId).toBeUndefined();
  });
});

describe('ApprovalService.waterfall — scoped counts', () => {
  it('ASM: site/recce/install counts all carry the asm-territory pin', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.waterfall(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }));
    expect(fns.site.count.mock.calls[0][0].where).toEqual({ clientId: 'c1', asmUserId: 'asm-7' });
    expect(fns.recce.count.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-7' } });
    // ASM-approved recce count = recces an ASM actually signed off (status APPROVED && approvedById
    // set) — NOT a recceMode proxy. A MANUAL / resubmitted-then-HO-approved APP recce leaves
    // approvedById null, so neither is counted.
    expect(fns.recce.count.mock.calls[1][0].where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-7' }, status: 'APPROVED', approvedById: { not: null } });
    // HO-approved / installable count also pins hoReviewStatus APPROVED — the subset that is installable.
    expect(fns.recce.count.mock.calls[2][0].where).toEqual({
      clientId: 'c1', site: { asmUserId: 'asm-7' }, status: 'APPROVED', hoReviewStatus: 'APPROVED',
    });
    // Pending-install: HO-approved recces with no installation of THEIR OWN (recce-level
    // `installation: null`, not site-level) — the ASM site-territory pin survives untouched.
    expect(fns.recce.count.mock.calls[3][0].where).toEqual({
      clientId: 'c1',
      site: { asmUserId: 'asm-7' },
      status: 'APPROVED',
      hoReviewStatus: 'APPROVED',
      installation: null,
    });
    expect(fns.installation.count.mock.calls[1][0].where).toMatchObject({ status: 'AUDIT_APPROVED' });
  });

  it('reports ASM-approved (approved) and HO-approved (hoApproved) as DISTINCT counts', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.count.mockResolvedValue(10);
    // recce.count order: recced, approved (ASM), hoApproved (installable), pendingInstall.
    fns.recce.count
      .mockResolvedValueOnce(8) // recced
      .mockResolvedValueOnce(6) // ASM-approved (status APPROVED)
      .mockResolvedValueOnce(4) // HO-approved (status APPROVED && hoReviewStatus APPROVED)
      .mockResolvedValueOnce(1); // pendingInstall (HO-approved, no installation yet)
    fns.installation.count
      .mockResolvedValueOnce(3) // installed
      .mockResolvedValueOnce(2); // audited
    const svc = new ApprovalService(prisma);
    const res = await svc.waterfall(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));
    expect(res).toEqual({
      totalSites: 10, recced: 8, approved: 6, hoApproved: 4, installed: 3, audited: 2, pendingInstall: 1,
      // Distinct-outlet coverage for the % tiles (findMany defaults to [] → 0 here).
      sitesRecced: 0, sitesInstalled: 0,
    });
    // hoApproved (4) is a strict subset of approved (6) — never conflated.
    expect(res.hoApproved).toBeLessThanOrEqual(res.approved);
  });
});

describe('ApprovalService — R3: the ASM lane excludes MANUAL recces', () => {
  it('listQueue is APP-only (recceMode APP added to the queue where)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.listQueue(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), {});
    expect(fns.recce.findMany.mock.calls[0][0].where.recceMode).toBe('APP');
  });

  it('getRecce filters to APP recces (a manual id → 404)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(null);
    const svc = new ApprovalService(prisma);
    await expect(
      svc.getRecce(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.recce.findFirst.mock.calls[0][0].where.recceMode).toBe('APP');
  });

  it('approve on a MANUAL recce → 404 (it belongs to the HO console, never the ASM stage)', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'rM', status: 'SUBMITTED', clientId: 'c1', recceMode: 'MANUAL', site: { asmUserId: 'asm-7' } });
    const svc = new ApprovalService(prisma);
    await expect(
      svc.approve(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'rM'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('reject on a MANUAL recce → 404, never updates', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue({ id: 'rM', status: 'SUBMITTED', clientId: 'c1', recceMode: 'MANUAL', site: { asmUserId: 'asm-7' } });
    const svc = new ApprovalService(prisma);
    await expect(
      svc.reject(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'rM', { reasonCode: 'OTHER' } as RejectRecceDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('bulkApprove candidate read is APP-only (manual ids never enter the candidate set)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.bulkApprove(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { ids: ['x'] });
    expect(fns.recce.findMany.mock.calls[0][0].where.recceMode).toBe('APP');
  });
});

describe('ApprovalService — resubmitted (HO-bound) recces are excluded from the ASM lane', () => {
  it('listQueue pins hoReviewStatus NONE (a resubmitted SUBMITTED+APP recce is HO-bound, not ASM)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.listQueue(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), {});
    expect(fns.recce.findMany.mock.calls[0][0].where.hoReviewStatus).toBe('NONE');
  });

  it('approve load guard pins hoReviewStatus NONE → a resubmitted recce (PENDING) is a scoped miss (404)', async () => {
    const { prisma, fns } = makePrisma();
    // The hoReviewStatus:'NONE' predicate excludes the resubmitted recce → findFirst returns null.
    fns.recce.findFirst.mockResolvedValue(null);
    const svc = new ApprovalService(prisma);
    await expect(
      svc.approve(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.recce.findFirst.mock.calls[0][0].where.hoReviewStatus).toBe('NONE');
    expect(fns.recce.update).not.toHaveBeenCalled();
  });

  it('reject load guard also pins hoReviewStatus NONE', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findFirst.mockResolvedValue(null);
    const svc = new ApprovalService(prisma);
    await expect(
      svc.reject(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), 'r1', { reasonCode: 'BLURRY' } as RejectRecceDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fns.recce.findFirst.mock.calls[0][0].where.hoReviewStatus).toBe('NONE');
  });

  it('bulkApprove candidate read pins hoReviewStatus NONE (resubmitted recces never enter the set)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.bulkApprove(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { ids: ['x'] });
    expect(fns.recce.findMany.mock.calls[0][0].where.hoReviewStatus).toBe('NONE');
  });
});

describe('ApprovalService.records — scoped per-tile drill-down', () => {
  it('outlets: scoped site.findMany (ASM-territory pin) + empty byElementType + null recceId', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.findMany.mockResolvedValue([
      { id: 's1', code: 'A1', name: 'Site A1', town: 'Pune', status: 'ACTIVE' },
    ]);
    fns.site.count.mockResolvedValue(1);
    const svc = new ApprovalService(prisma);
    const res = await svc.records(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { stage: RecordsStage.OUTLETS });
    expect(fns.site.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', asmUserId: 'asm-7' });
    expect(res.items).toEqual([
      { id: 's1', outletCode: 'A1', outletName: 'Site A1', town: 'Pune', recceId: null, status: 'ACTIVE' },
    ]);
    expect(res.byElementType).toEqual([]);
    expect(res).toMatchObject({ total: 1, page: 1, limit: 50 });
    // The outlet stage never touches the element breakdown query.
    expect(fns.reccePosm.groupBy).not.toHaveBeenCalled();
  });

  it('recce: scoped recce.findMany (any status), recceId set only for APP (manual un-linked), newest-first', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([
      { id: 'r1', status: 'SUBMITTED', recceMode: 'APP', site: { code: 'A1', name: 'Site A1', town: 'Pune' } },
      { id: 'rM', status: 'SUBMITTED', recceMode: 'MANUAL', site: { code: 'A2', name: 'Site A2', town: null } },
    ]);
    fns.recce.count.mockResolvedValue(2);
    const svc = new ApprovalService(prisma);
    const res = await svc.records(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { stage: RecordsStage.RECCE });
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-7' } });
    expect(fns.recce.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    expect(res.items).toEqual([
      // APP recce → linkable; MANUAL recce still listed (counts toward the tile) but recceId null.
      { id: 'r1', outletCode: 'A1', outletName: 'Site A1', town: 'Pune', recceId: 'r1', status: 'SUBMITTED' },
      { id: 'rM', outletCode: 'A2', outletName: 'Site A2', town: null, recceId: null, status: 'SUBMITTED' },
    ]);
  });

  it('asm-approved: status APPROVED && approvedById set (manual + resubmitted-then-HO-approved APP excluded)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.records(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { stage: RecordsStage.ASM_APPROVED });
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-7' }, status: 'APPROVED', approvedById: { not: null } });
  });

  it('ho-approved: adds status APPROVED && hoReviewStatus APPROVED', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.records(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { stage: RecordsStage.HO_APPROVED });
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', status: 'APPROVED', hoReviewStatus: 'APPROVED' });
  });

  it('pending-install: recce-level installation:null with the ASM site pin preserved; breakdown rides the same where', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.records(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { stage: RecordsStage.PENDING_INSTALL });
    const where = {
      clientId: 'c1', site: { asmUserId: 'asm-7' },
      status: 'APPROVED', hoReviewStatus: 'APPROVED', installation: null,
    };
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual(where);
    // The element breakdown is grouped over the SAME scoped recce where (via the parent relation).
    expect(fns.reccePosm.groupBy.mock.calls[0][0].where).toEqual({ recce: where });
  });

  it('installed: scoped installation.findMany; recceId null; breakdown rides installPosm→installation scope', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findMany.mockResolvedValue([
      { id: 'i1', status: 'SUBMITTED', site: { code: 'A1', name: 'Site A1', town: 'Pune' } },
    ]);
    fns.installation.count.mockResolvedValue(1);
    const svc = new ApprovalService(prisma);
    const res = await svc.records(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), { stage: RecordsStage.INSTALLED });
    const installWhere = { clientId: 'c1', site: { asmUserId: 'asm-7' } };
    expect(fns.installation.findMany.mock.calls[0][0].where).toEqual(installWhere);
    expect(res.items).toEqual([
      { id: 'i1', outletCode: 'A1', outletName: 'Site A1', town: 'Pune', recceId: null, status: 'SUBMITTED' },
    ]);
    // Installed element lines = ReccePosm rows with a linked InstallPosm whose installation is in scope.
    expect(fns.reccePosm.groupBy.mock.calls[0][0].where).toEqual({ installPosm: { installation: installWhere } });
  });

  it('byElementType: groups element lines by PosmType (code+name, line count) busiest-first', async () => {
    const { prisma, fns } = makePrisma();
    fns.reccePosm.groupBy.mockResolvedValue([
      { posmTypeId: 't1', _count: { _all: 2 } },
      { posmTypeId: 't2', _count: { _all: 5 } },
    ]);
    fns.posmType.findMany.mockResolvedValue([
      { id: 't1', code: 'A', name: 'Board' },
      { id: 't2', code: 'B', name: 'Shelf' },
    ]);
    const svc = new ApprovalService(prisma);
    const res = await svc.records(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { stage: RecordsStage.RECCE });
    expect(res.byElementType).toEqual([
      { code: 'B', name: 'Shelf', count: 5 },
      { code: 'A', name: 'Board', count: 2 },
    ]);
  });

  it('pagination: defaults page 1 / limit 50 and caps limit at 200', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    const res = await svc.records(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { stage: RecordsStage.RECCE, limit: 9999 });
    expect(res.limit).toBe(200);
    expect(res.page).toBe(1);
    expect(fns.recce.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 200 });
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (no clientId filter) on a records stage', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.records(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), { stage: RecordsStage.RECCE });
    expect(fns.recce.findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  });
});
