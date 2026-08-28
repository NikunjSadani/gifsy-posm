import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { ApprovalService } from './approval.service';
import { RejectRecceDto } from './dto/reject-recce.dto';
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
    site: { count: jest.fn().mockResolvedValue(0) },
    installation: { count: jest.fn().mockResolvedValue(0) },
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
    const audit = fns.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: 'APPROVE', entityType: 'RECCE', entityId: 'r1', actorId: 'asm-7' });
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

describe('ApprovalService.waterfall — scoped counts', () => {
  it('ASM: site/recce/install counts all carry the asm-territory pin', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new ApprovalService(prisma);
    await svc.waterfall(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }));
    expect(fns.site.count.mock.calls[0][0].where).toEqual({ clientId: 'c1', asmUserId: 'asm-7' });
    expect(fns.recce.count.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-7' } });
    // approved recce count adds status APPROVED on top of the same scope
    expect(fns.recce.count.mock.calls[1][0].where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-7' }, status: 'APPROVED' });
    expect(fns.installation.count.mock.calls[1][0].where).toMatchObject({ status: 'AUDIT_APPROVED' });
  });
});
