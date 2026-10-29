import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SitesService } from './sites.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
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

  it('VENDOR_FIELD: hard-pinned to ACTIVE outlets (deactivated are hidden)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v9', clientId: 'c1' }), {});
    expect(findMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });

  it('VENDOR_FIELD cannot reveal INACTIVE via a status filter (ignored → still ACTIVE)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v9', clientId: 'c1' }), { status: 'INACTIVE' } as any);
    expect(findMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });

  it('ASM: hard-pinned to ACTIVE outlets', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'ASM', sub: 'asm-7', clientId: 'c1' }), {});
    expect(findMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });

  it('CLIENT_ADMIN: sees ALL statuses by default, and can filter to INACTIVE (admin-only visibility)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(findMany.mock.calls[0][0].where.status).toBeUndefined();
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { status: 'INACTIVE' } as any);
    expect(findMany.mock.calls[1][0].where.status).toBe('INACTIVE');
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

  it('rsCode + beatName are EXACT case-insensitive matches (not contains)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { rsCode: 'RS1', beatName: 'Beat 1' });
    const where = findMany.mock.calls[0][0].where;
    expect(where.rsCode).toEqual({ equals: 'RS1', mode: 'insensitive' });
    expect(where.beatName).toEqual({ equals: 'Beat 1', mode: 'insensitive' });
  });

  it('beatNames (multi-select) → case-INSENSITIVE OR membership (mixed-case data not hidden)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { beatNames: ['Beat 1', 'Beat 2'] });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { beatName: { equals: 'Beat 1', mode: 'insensitive' } },
      { beatName: { equals: 'Beat 2', mode: 'insensitive' } },
    ]);
    expect(findMany.mock.calls[0][0].where.beatName).toBeUndefined();
  });

  it('beatNames WINS over a single beatName when both are present', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { beatName: 'Beat 9', beatNames: ['Beat 1'] });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ beatName: { equals: 'Beat 1', mode: 'insensitive' } }]);
    expect(findMany.mock.calls[0][0].where.beatName).toBeUndefined();
  });

  it('empty beatNames array falls back to the single beatName behaviour', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { beatName: 'Beat 9', beatNames: [] });
    expect(findMany.mock.calls[0][0].where.beatName).toEqual({ equals: 'Beat 9', mode: 'insensitive' });
  });

  it('no beat filter when neither beatName nor beatNames is set', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(findMany.mock.calls[0][0].where.beatName).toBeUndefined();
  });

  it('pendingRecce=true → OR(no recce, rejected APP recce) AND-ed onto scope', async () => {
    const { prisma, findMany, count } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v1', clientId: 'c1' }), { pendingRecce: true });
    const where = findMany.mock.calls[0][0].where;
    // Now includes outlets with NO recce OR a REJECTED app recce — pushed into AND as its own OR group.
    const pendingOr = [
      { recces: { none: {} } },
      { recces: { some: { recceMode: 'APP', status: 'REJECTED' } } },
    ];
    expect(where.AND).toEqual([{ OR: pendingOr }]);
    expect(where.OR).toBeUndefined(); // no beat filter, so no top-level OR
    expect(where.vendorId).toBe('v1'); // still hard-pinned to the caller's vendor
    expect(count.mock.calls[0][0].where.AND).toEqual([{ OR: pendingOr }]); // same filter on the total
  });

  it('pendingRecce list flags hasRejectedRecce per outlet and strips the joined relation', async () => {
    const { prisma, findMany } = makePrisma();
    findMany.mockResolvedValueOnce([
      { id: 's1', code: 'A', name: 'Rejected one', status: 'ACTIVE', recces: [{ id: 'r1' }] },
      { id: 's2', code: 'B', name: 'Never recced', status: 'ACTIVE', recces: [] },
    ]);
    const svc = new SitesService(prisma);
    const res = await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v1', clientId: 'c1' }), { pendingRecce: true });
    // The join is id-only, filtered to REJECTED app recces, and limited to one row.
    expect(findMany.mock.calls[0][0].include).toEqual({
      recces: { where: { recceMode: 'APP', status: 'REJECTED' }, select: { id: true }, take: 1 },
    });
    expect(res.sites[0]).toMatchObject({ id: 's1', hasRejectedRecce: true });
    expect(res.sites[1]).toMatchObject({ id: 's2', hasRejectedRecce: false });
    // The relation used only to derive the flag is not leaked in the payload.
    expect((res.sites[0] as Record<string, unknown>).recces).toBeUndefined();
  });

  it('a non-pendingRecce list does not join recces (no include)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});
    expect(findMany.mock.calls[0][0].include).toBeUndefined();
  });

  it('beatNames + pendingRecce → BOTH OR groups AND-ed (the beat-OR is NOT clobbered)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(
      user({ role: 'VENDOR_FIELD', vendorId: 'v1', clientId: 'c1' }),
      { beatNames: ['Beat 1', 'Beat 2'], pendingRecce: true },
    );
    const where = findMany.mock.calls[0][0].where;
    // The beat-OR was moved out of the top-level OR into AND, so the pendingRecce-OR can't overwrite it.
    expect(where.OR).toBeUndefined();
    expect(where.AND).toEqual([
      { OR: [
        { beatName: { equals: 'Beat 1', mode: 'insensitive' } },
        { beatName: { equals: 'Beat 2', mode: 'insensitive' } },
      ] },
      { OR: [
        { recces: { none: {} } },
        { recces: { some: { recceMode: 'APP', status: 'REJECTED' } } },
      ] },
    ]);
    expect(where.vendorId).toBe('v1'); // vendor pin intact
  });

  it('pendingRecce absent/false leaves the recce filter off (all reachable sites)', async () => {
    const { prisma, findMany } = makePrisma();
    const svc = new SitesService(prisma);
    await svc.list(user({ role: 'VENDOR_FIELD', vendorId: 'v1', clientId: 'c1' }), { pendingRecce: false });
    expect(findMany.mock.calls[0][0].where.recces).toBeUndefined();
    expect(findMany.mock.calls[0][0].where.AND).toBeUndefined();
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
describe('SitesService.get — scoped single fetch (reachable by VENDOR_FIELD)', () => {
  // GET /v1/sites/:id is exposed to VENDOR_FIELD (recce page resolves one outlet's gsbAllowed),
  // so get()'s vendor+tenant scoping is a security boundary: a field login must only ever read
  // an outlet its own vendor services, and a vendor with no scope must fail closed (404).
  function makeGetPrisma(site: unknown = null) {
    const findFirst = jest.fn().mockResolvedValue(site);
    const prisma = { site: { findFirst } } as unknown as PrismaService;
    return { prisma, findFirst };
  }

  it('VENDOR_FIELD: findFirst where AND-s vendorId + clientId + id', async () => {
    const { prisma, findFirst } = makeGetPrisma({ id: 's1', clientId: 'c1', vendorId: 'v9' });
    const svc = new SitesService(prisma);
    await svc.get(user({ role: 'VENDOR_FIELD', vendorId: 'v9', clientId: 'c1' }), 's1');
    expect(findFirst).toHaveBeenCalledWith({ where: { clientId: 'c1', vendorId: 'v9', id: 's1' } });
  });

  it('VENDOR_FIELD with NO vendorId → FAIL-CLOSED: 404, issues NO query', async () => {
    const { prisma, findFirst } = makeGetPrisma();
    const svc = new SitesService(prisma);
    await expect(
      svc.get(user({ role: 'VENDOR_FIELD', vendorId: undefined }), 's1'),
    ).rejects.toThrow('Outlet not found');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('a scoped miss (other vendor / wrong id) → 404', async () => {
    const { prisma } = makeGetPrisma(null);
    const svc = new SitesService(prisma);
    await expect(
      svc.get(user({ role: 'VENDOR_FIELD', vendorId: 'v9', clientId: 'c1' }), 'sX'),
    ).rejects.toThrow('Outlet not found');
  });
});

describe('SitesService.create — F8 tenant-context write gate', () => {
  it('rejects create from an un-assumed GIFSY_ADMIN (400)', async () => {
    const prisma = { site: { create: jest.fn() } } as unknown as PrismaService;
    const svc = new SitesService(prisma);
    await expect(
      svc.create(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), { code: 'A1', name: 'Alpha' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ── Filter drop-down options — scoped like list(), fail-closed for an unscoped vendor ──
describe('SitesService.rsCodeOptions', () => {
  function makeOptionPrisma(rows: { rsCode: string | null; rsName?: string | null }[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { site: { findMany } } as unknown as PrismaService;
    return { prisma, findMany };
  }

  it('returns distinct, sorted {code,name} under the ACTIVE vendor pin, dropping blank codes (VENDOR_FIELD)', async () => {
    const { prisma, findMany } = makeOptionPrisma([
      { rsCode: 'RS2', rsName: 'North RS' }, { rsCode: 'RS1', rsName: 'South RS' },
      { rsCode: null, rsName: 'X' }, { rsCode: '', rsName: 'Y' },
    ]);
    const svc = new SitesService(prisma);
    const res = await svc.rsCodeOptions(user({ role: 'VENDOR_FIELD', vendorId: 'v9', clientId: 'c1' }));
    expect(res).toEqual({
      rsCodes: [
        { code: 'RS1', name: 'South RS' },
        { code: 'RS2', name: 'North RS' },
      ],
    });
    const args = findMany.mock.calls[0][0];
    expect(args.distinct).toEqual(['rsCode']);
    expect(args.select).toEqual({ rsCode: true, rsName: true });
    expect(args.orderBy).toEqual([{ rsCode: 'asc' }]); // must start with the distinct column
    expect(args.where.vendorId).toBe('v9');
    expect(args.where.clientId).toBe('c1');
    expect(args.where.status).toBe('ACTIVE'); // non-admin → ACTIVE-only
  });

  it('maps a null rsName to name: null (code kept)', async () => {
    const { prisma } = makeOptionPrisma([{ rsCode: 'RS1', rsName: null }]);
    const svc = new SitesService(prisma);
    const res = await svc.rsCodeOptions(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));
    expect(res).toEqual({ rsCodes: [{ code: 'RS1', name: null }] });
  });

  it('admin is NOT pinned to ACTIVE (sees all statuses)', async () => {
    const { prisma, findMany } = makeOptionPrisma([]);
    const svc = new SitesService(prisma);
    await svc.rsCodeOptions(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));
    expect(findMany.mock.calls[0][0].where.status).toBeUndefined();
  });

  it('FAIL-CLOSED: a vendor with no scope returns [] and issues NO query', async () => {
    const { prisma, findMany } = makeOptionPrisma([]);
    const svc = new SitesService(prisma);
    const res = await svc.rsCodeOptions(user({ role: 'VENDOR_FIELD', vendorId: undefined }));
    expect(res).toEqual({ rsCodes: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('SitesService.beatOptions', () => {
  function makeOptionPrisma(rows: { beatName: string | null }[] = []) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { site: { findMany } } as unknown as PrismaService;
    return { prisma, findMany };
  }

  it('requires the rsCode query param (400 when missing/blank)', async () => {
    const { prisma, findMany } = makeOptionPrisma([]);
    const svc = new SitesService(prisma);
    await expect(
      svc.beatOptions(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), '  '),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns distinct sorted Beats for an EXACT (case-insensitive) rsCode under the vendor pin', async () => {
    const { prisma, findMany } = makeOptionPrisma([
      { beatName: 'Beat B' }, { beatName: 'Beat A' }, { beatName: null },
    ]);
    const svc = new SitesService(prisma);
    const res = await svc.beatOptions(user({ role: 'VENDOR_FIELD', vendorId: 'v9', clientId: 'c1' }), 'RS1');
    expect(res).toEqual({ beats: ['Beat A', 'Beat B'] });
    const args = findMany.mock.calls[0][0];
    expect(args.distinct).toEqual(['beatName']);
    expect(args.where.rsCode).toEqual({ equals: 'RS1', mode: 'insensitive' });
    expect(args.where.vendorId).toBe('v9');
    expect(args.where.status).toBe('ACTIVE');
  });

  it('FAIL-CLOSED: a vendor with no scope returns [] and issues NO query', async () => {
    const { prisma, findMany } = makeOptionPrisma([]);
    const svc = new SitesService(prisma);
    const res = await svc.beatOptions(user({ role: 'VENDOR_FIELD', vendorId: undefined }), 'RS1');
    expect(res).toEqual({ beats: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});

// ── RS code + Beat are now MANDATORY on create, non-clearable on update ─────────────
describe('CreateSiteDto — rsCode + beatName are required', () => {
  const base = { code: 'A1', name: 'Alpha', rsCode: 'RS1', beatName: 'Beat 1' };

  it('rejects a payload missing rsCode and beatName', async () => {
    const errors = await validate(plainToInstance(CreateSiteDto, { code: 'A1', name: 'Alpha' }));
    const props = errors.map((e) => e.property);
    expect(props).toContain('rsCode');
    expect(props).toContain('beatName');
  });

  it('rejects empty-string rsCode / beatName', async () => {
    const errors = await validate(plainToInstance(CreateSiteDto, { ...base, rsCode: '', beatName: '' }));
    const props = errors.map((e) => e.property);
    expect(props).toContain('rsCode');
    expect(props).toContain('beatName');
  });

  it('accepts a payload carrying both', async () => {
    const errors = await validate(plainToInstance(CreateSiteDto, base));
    expect(errors).toHaveLength(0);
  });
});

describe('UpdateSiteDto — rsCode + beatName optional but non-clearable', () => {
  it('accepts omitting them (unchanged)', async () => {
    const errors = await validate(plainToInstance(UpdateSiteDto, { name: 'New' }));
    expect(errors).toHaveLength(0);
  });

  it('rejects clearing them to empty strings', async () => {
    const errors = await validate(plainToInstance(UpdateSiteDto, { rsCode: '', beatName: '' }));
    const props = errors.map((e) => e.property);
    expect(props).toContain('rsCode');
    expect(props).toContain('beatName');
  });

  it('accepts non-empty values', async () => {
    const errors = await validate(plainToInstance(UpdateSiteDto, { rsCode: 'RS9', beatName: 'Beat 9' }));
    expect(errors).toHaveLength(0);
  });
});
