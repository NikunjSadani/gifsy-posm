import { BadRequestException } from '@nestjs/common';
import { SitesService } from './sites.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Wave-1 SECURITY proof: role-scoped listing never leaks across tenant OR vendor.
 * These lock the `where` the service hands Prisma for each role.
 */
function makePrisma() {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = { site: { findMany, count } } as unknown as PrismaService;
  return { prisma, findMany, count };
}

const user = (over: Partial<JwtPayload>): JwtPayload => ({
  sub: 'u1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'T', ...over,
});

describe('SitesService.list — role scoping', () => {
  it('VENDOR_FIELD: where AND-s vendorId (its own vendor) and pins the tenant', async () => {
    const { prisma, findMany, count } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v9', clientId: 'c1' }), {});
    const where = findMany.mock.calls[0][0].where;
    expect(where.vendorId).toBe('v9');
    expect(where.clientId).toBe('c1');
    expect(count.mock.calls[0][0].where.vendorId).toBe('v9');
  });

  it('VENDOR_HO: same vendor confinement', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_HO', vendorId: 'v2', clientId: 'c1' }), {});
    expect(findMany.mock.calls[0][0].where.vendorId).toBe('v2');
  });

  it('vendor role with NO vendorId → FAIL-CLOSED: returns nothing, issues NO query', async () => {
    const { prisma, findMany, count } = makePrisma();
    const svc = new SitesService(prisma);
    const res = await svc.list(user({ role: 'VENDOR_FIELD', vendorId: undefined }), {});
    expect(res).toEqual({ sites: [], total: 0, page: 1, limit: 50 });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('vendor role cannot widen via a vendorId filter (security pin wins)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v1' }), { vendorId: 'v2' });
    // The filter for a sibling vendor v2 is ignored; the pin to v1 holds.
    expect(findMany.mock.calls[0][0].where.vendorId).toBe('v1');
  });

  it('ASM: where AND-s asmUserId = user.sub and pins the tenant', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), {});
    const where = findMany.mock.calls[0][0].where;
    expect(where.asmUserId).toBe('asm-7');
    expect(where.clientId).toBe('c1');
    expect(where.vendorId).toBeUndefined();
  });

  it('CLIENT_ADMIN: tenant-scoped, no vendor/asm narrowing', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    const where = findMany.mock.calls[0][0].where;
    expect(where.clientId).toBe('c1');
    expect(where.vendorId).toBeUndefined();
    expect(where.asmUserId).toBeUndefined();
  });

  it('GIFSY_ADMIN un-assumed: platform-wide (no clientId filter)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'GIFSY_ADMIN', clientId: 'c1', assumed: false }), {});
    expect(findMany.mock.calls[0][0].where.clientId).toBeUndefined();
  });

  it('GIFSY_ADMIN assumed: pinned to the assumed tenant', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'GIFSY_ADMIN', clientId: 'cAssumed', assumed: true }), {});
    expect(findMany.mock.calls[0][0].where.clientId).toBe('cAssumed');
  });

  it('applies case-insensitive contains filters', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { name: 'foo', town: 'bar' });
    const where = findMany.mock.calls[0][0].where;
    expect(where.name).toEqual({ contains: 'foo', mode: 'insensitive' });
    expect(where.town).toEqual({ contains: 'bar', mode: 'insensitive' });
  });

  it('status filter scopes the query WITHIN the tenant where (never widens scope)', async () => {
    const { prisma, findMany, count } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { status: 'INACTIVE' as any });
    const where = findMany.mock.calls[0][0].where;
    // Status is AND-ed onto the caller's scope, not applied in place of it.
    expect(where.status).toBe('INACTIVE');
    expect(where.clientId).toBe('c1');
    // count() is issued with the SAME where so the header total matches what's reachable.
    expect(count.mock.calls[0][0].where.status).toBe('INACTIVE');
    expect(count.mock.calls[0][0].where.clientId).toBe('c1');
  });

  it('status filter cannot widen a vendor role beyond its vendor pin', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v1', clientId: 'c1' }), { status: 'ACTIVE' as any });
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('ACTIVE');
    expect(where.vendorId).toBe('v1');
  });

  it('absent status → no status filter (all statuses)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(findMany.mock.calls[0][0].where.status).toBeUndefined();
  });
});

// ── F8 — an un-assumed GIFSY_ADMIN cannot create a site (no tenant context) ────────
describe('SitesService.create — F8 tenant-context write gate', () => {
  it('rejects create from an un-assumed GIFSY_ADMIN (400)', async () => {
    const prisma = { site: { create: jest.fn() } } as unknown as PrismaService;
    const svc = new SitesService(prisma);
    await expect(
      svc.create(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), { code: 'A1', name: 'Alpha' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
