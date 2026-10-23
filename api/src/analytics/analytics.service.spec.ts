import { ForbiddenException, StreamableFile } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * AnalyticsService — SECURITY (scoping) + correctness proofs.
 *
 * Locks the module's single security invariant on every surface: a VENDOR_HO is confined to its
 * OWN fleet (site.vendorId / recce.site.vendorId) and FAILS CLOSED with no vendorId; a
 * CLIENT_ADMIN is tenant-pinned; an un-assumed GIFSY_ADMIN is platform-wide (no clientId); an
 * ASM is territory-pinned (site.asmUserId). Plus a rate 0-guard (no divide-by-zero).
 */
function makePrisma() {
  const fns: Record<string, any> = {
    site: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    recce: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    installation: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    vendor: { findMany: jest.fn().mockResolvedValue([]) },
    manualTask: { count: jest.fn().mockResolvedValue(0) },
    manualTaskSubmission: { count: jest.fn().mockResolvedValue(0) },
    reccePosm: { groupBy: jest.fn().mockResolvedValue([]) },
    posmType: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma: fns as unknown as PrismaService, fns };
}

const user = (over: Partial<JwtPayload>): JwtPayload => ({
  sub: 'u1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'T', ...over,
});

// The where used by the FIRST site.count call in summary() (the totalSites universe).
const firstSiteWhere = (fns: Record<string, any>) => fns.site.count.mock.calls[0][0].where;
const firstRecceWhere = (fns: Record<string, any>) => fns.recce.count.mock.calls[0][0].where;

describe('AnalyticsService.summary — scoping', () => {
  it('CLIENT_ADMIN: every base query is tenant-pinned, no vendor/asm narrowing', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.summary(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));

    expect(firstSiteWhere(fns)).toEqual({ clientId: 'c1' });
    expect(firstRecceWhere(fns)).toEqual({ clientId: 'c1' });
    expect(fns.installation.count.mock.calls[0][0].where).toEqual({ clientId: 'c1' });
    expect(fns.manualTask.count.mock.calls[0][0].where).toMatchObject({ clientId: 'c1', status: 'OPEN' });
    // No fleet / territory predicate leaked onto the site scope.
    expect(firstSiteWhere(fns).vendorId).toBeUndefined();
    expect(firstSiteWhere(fns).asmUserId).toBeUndefined();
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (NO clientId filter anywhere)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.summary(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }));

    expect(firstSiteWhere(fns).clientId).toBeUndefined();
    expect(firstRecceWhere(fns).clientId).toBeUndefined();
    expect(fns.installation.count.mock.calls[0][0].where.clientId).toBeUndefined();
    expect(fns.manualTask.count.mock.calls[0][0].where.clientId).toBeUndefined();
  });

  it('assumed GIFSY_ADMIN: pinned to the assumed tenant (NOT platform-wide)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.summary(user({ role: 'GIFSY_ADMIN', clientId: 'cB', assumed: true }));
    expect(firstSiteWhere(fns)).toEqual({ clientId: 'cB' });
  });

  it('VENDOR_HO: confined to their OWN fleet on site AND recce (site.vendorId)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.summary(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }));

    expect(firstSiteWhere(fns)).toEqual({ clientId: 'c1', vendorId: 'v-7' });
    // Recce/Installation carry no vendorId column → confinement rides the site relation.
    expect(firstRecceWhere(fns)).toEqual({ clientId: 'c1', site: { vendorId: 'v-7' } });
    expect(fns.installation.count.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { vendorId: 'v-7' } });
    // Manual submissions are fleet-scoped by their denormalized vendorId.
    expect(fns.manualTaskSubmission.count.mock.calls[0][0].where).toMatchObject({ clientId: 'c1', vendorId: 'v-7' });
  });

  it('VENDOR_HO with NO vendorId: FAILS CLOSED (403), never runs an unscoped query', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await expect(
      svc.summary(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: undefined })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fns.site.count).not.toHaveBeenCalled();
    expect(fns.recce.count).not.toHaveBeenCalled();
  });

  it('ASM: confined to their territory (site.asmUserId), recce via the site relation', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.summary(user({ role: 'ASM', sub: 'asm-3', clientId: 'c1' }));

    expect(firstSiteWhere(fns)).toEqual({ clientId: 'c1', asmUserId: 'asm-3' });
    expect(firstRecceWhere(fns)).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-3' } });
  });

  it('pendingRecceReview pins hoReviewStatus NONE; pendingHoReview is just hoReviewStatus PENDING', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.summary(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));
    // recce.count order: 0 recced, 1 approved, 2 hoApproved, 3 rejectedRecce, 4 pendingRecceReview,
    // 5 geoTrue, 6 geoDecided, 7 recceManual, 8 pendingHoReview.
    // pendingRecceReview = SUBMITTED app recces STILL in the ASM stage (hoReviewStatus NONE).
    expect(fns.recce.count.mock.calls[4][0].where).toEqual({
      clientId: 'c1', status: 'SUBMITTED', recceMode: 'APP', hoReviewStatus: 'NONE',
    });
    // pendingHoReview = ANY recce awaiting HO sign-off (covers app-approved, manual, resubmitted-app).
    expect(fns.recce.count.mock.calls[8][0].where).toEqual({ clientId: 'c1', hoReviewStatus: 'PENDING' });
  });
});

describe('AnalyticsService.summary — KPI math + 0-guards', () => {
  it('rates are NULL when denominators are 0 (no data → null → "—", never a misleading 0)', async () => {
    const { prisma } = makePrisma(); // all counts default to 0
    const svc = new AnalyticsService(prisma);
    const res = await svc.summary(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));

    expect(res.kpis.recceApprovalRatePct).toBeNull();
    expect(res.kpis.installAuditApprovalRatePct).toBeNull();
    expect(res.kpis.geoFencePassRatePct).toBeNull();
    // No AUDIT_APPROVED install with timestamps → avgTurnaroundDays omitted entirely.
    expect(res.kpis).not.toHaveProperty('avgTurnaroundDays');
  });

  it('computes approval rate among DECIDED recces + geo pass among verifiable fixes', async () => {
    const { prisma, fns } = makePrisma();
    // Order of the Promise.all in summary(): [totalSites(site), recced, approved(ASM), hoApproved,
    // rejectedRecce, pendingRecceReview, geoTrue, geoDecided](recce ×7), then installation ×4,
    // then manual ×2, then recceManual(recce, LAST) for the app-vs-manual split.
    fns.site.count.mockResolvedValueOnce(10); // totalSites
    // recced, approved(ASM), hoApproved, rejectedRecce, pending, geoTrue, geoDecided, …, recceManual
    const recceCounts = [8, 6, 4, 2, 0, 9, 10, /* recceManual (last recce.count) */ 3];
    let ri = 0;
    fns.recce.count.mockImplementation(() => Promise.resolve(recceCounts[ri++]));
    const installCounts = [5, 3, 1, 1]; // installed, audited, rejectedInstall, pending
    let ii = 0;
    fns.installation.count.mockImplementation(() => Promise.resolve(installCounts[ii++]));
    // avgTurnaround: one AUDIT_APPROVED row, 2-day turnaround.
    const received = new Date('2026-01-01T00:00:00Z');
    const audited = new Date('2026-01-03T00:00:00Z');
    fns.installation.findMany.mockResolvedValue([{ auditedAt: audited, recce: { receivedAt: received } }]);

    const svc = new AnalyticsService(prisma);
    const res = await svc.summary(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));

    // approved = ASM-approved (6); hoApproved = installable (4), a strict subset.
    expect(res.waterfall).toEqual({ totalSites: 10, recced: 8, approved: 6, hoApproved: 4, installed: 5, audited: 3 });
    expect(res.waterfall.hoApproved).toBeLessThanOrEqual(res.waterfall.approved);
    // App-vs-manual recce split: manual = 3 (last recce.count), app = recced − manual = 5. The
    // funnel total (recced=8) still COUNTS the manual recces — the split only breaks them out.
    expect(res.byRecceMode).toEqual({ app: 5, manual: 3 });
    expect(res.byRecceMode.app + res.byRecceMode.manual).toBe(res.waterfall.recced);
    // The manual-split count (LAST recce.count) pins recceMode MANUAL within the same scope.
    expect(fns.recce.count.mock.calls[7][0].where).toEqual({ clientId: 'c1', recceMode: 'MANUAL' });
    // The ASM-approved count (2nd recce.count) pins status APPROVED && approvedById NOT NULL — the
    // recce was actually stamped by an ASM, NOT a recceMode proxy (a manual / resubmitted-then-
    // HO-approved APP recce leaves approvedById null and is excluded).
    expect(fns.recce.count.mock.calls[1][0].where).toEqual({
      clientId: 'c1', status: 'APPROVED', approvedById: { not: null },
    });
    // The hoApproved count (3rd recce.count) pins status APPROVED && hoReviewStatus APPROVED.
    expect(fns.recce.count.mock.calls[2][0].where).toEqual({
      clientId: 'c1', status: 'APPROVED', hoReviewStatus: 'APPROVED',
    });
    // ASM-approval rate: approved 6 / decided (6 approved + 2 rejected = 8) = 75
    expect(res.kpis.recceApprovalRatePct).toBe(75);
    // audited 3 / (3 + 1 rejected = 4) = 75
    expect(res.kpis.installAuditApprovalRatePct).toBe(75);
    // geoTrue 9 / geoDecided 10 = 90
    expect(res.kpis.geoFencePassRatePct).toBe(90);
    expect(res.kpis.avgTurnaroundDays).toBe(2);
  });
});

describe('AnalyticsService.vendorScorecards — scoping', () => {
  it('VENDOR_HO: vendor universe pinned to their own id (only their row)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.vendorScorecards(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }));

    expect(fns.site.groupBy.mock.calls[0][0].where).toEqual({ clientId: 'c1', vendorId: 'v-7' });
    expect(fns.vendor.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', id: 'v-7' });
    // Counts now come from EXACT groupBy over the scoped recce set (no ROW_CAP findMany).
    expect(fns.recce.groupBy.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { vendorId: 'v-7' } });
  });

  it('ASM: vendor universe restricted to vendors in their territory (from site groupBy)', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.groupBy.mockResolvedValue([{ vendorId: 'v-1', _count: { _all: 3 } }, { vendorId: null, _count: { _all: 1 } }]);
    const svc = new AnalyticsService(prisma);
    await svc.vendorScorecards(user({ role: 'ASM', sub: 'asm-3', clientId: 'c1' }));

    expect(fns.site.groupBy.mock.calls[0][0].where).toEqual({ clientId: 'c1', asmUserId: 'asm-3' });
    expect(fns.vendor.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', id: { in: ['v-1'] } });
  });

  it('attributes EXACT groupBy aggregates to the site vendorId and nulls the rates on no data', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.groupBy.mockResolvedValue([{ vendorId: 'v-1', _count: { _all: 4 } }]);
    // siteId → vendorId map (three sites all under v-1).
    fns.site.findMany.mockResolvedValue([
      { id: 's1', vendorId: 'v-1' }, { id: 's2', vendorId: 'v-1' }, { id: 's3', vendorId: 'v-1' },
    ]);
    fns.vendor.findMany.mockResolvedValue([{ id: 'v-1', code: 'VC1', name: 'Vendor One' }]);
    // EXACT per-site groupBy results: 3 recces (1 APPROVED, 1 REJECTED, 1 SUBMITTED).
    // recce.groupBy call order: #1 by status (recced/rejected), #2 ASM-approved (approvedById set),
    // #3 by geoFenceOk, #4 the HO-approved (installable) count.
    fns.recce.groupBy
      .mockResolvedValueOnce([
        { siteId: 's1', status: 'APPROVED', _count: { _all: 1 } },
        { siteId: 's2', status: 'REJECTED', _count: { _all: 1 } },
        { siteId: 's3', status: 'SUBMITTED', _count: { _all: 1 } },
      ])
      // ASM-approved per site (status APPROVED && approvedById set): the one APPROVED recce on s1 was
      // actually ASM-signed-off, so it is counted here (NOT derived from status/recceMode).
      .mockResolvedValueOnce([{ siteId: 's1', _count: { _all: 1 } }])
      .mockResolvedValueOnce([
        { siteId: 's1', geoFenceOk: true, _count: { _all: 1 } },
        { siteId: 's2', geoFenceOk: false, _count: { _all: 1 } },
        { siteId: 's3', geoFenceOk: null, _count: { _all: 1 } },
      ])
      // HO-approved (installable): the one APPROVED recce on s1 has ALSO been HO-signed-off.
      .mockResolvedValueOnce([{ siteId: 's1', _count: { _all: 1 } }]);
    fns.installation.groupBy.mockResolvedValue([]);
    fns.installation.findMany.mockResolvedValue([]); // no AUDIT_APPROVED turnaround rows
    const svc = new AnalyticsService(prisma);
    const res = await svc.vendorScorecards(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));

    expect(res.items).toHaveLength(1);
    const row = res.items[0];
    expect(row).toMatchObject({ vendorId: 'v-1', vendorCode: 'VC1', vendorName: 'Vendor One', sites: 4, recced: 3, approved: 1, hoApproved: 1 });
    // hoApproved (installable) is a subset of ASM-approved.
    expect(row.hoApproved).toBeLessThanOrEqual(row.approved);
    // The ASM-approved groupBy (2nd recce.groupBy) pins status APPROVED && approvedById NOT NULL.
    expect(fns.recce.groupBy.mock.calls[1][0].where).toEqual({
      clientId: 'c1', status: 'APPROVED', approvedById: { not: null },
    });
    // The HO-approved groupBy (4th recce.groupBy) pins status APPROVED && hoReviewStatus APPROVED.
    expect(fns.recce.groupBy.mock.calls[3][0].where).toEqual({
      clientId: 'c1', status: 'APPROVED', hoReviewStatus: 'APPROVED',
    });
    // approved 1 / decided (1+1)=2 → 50
    expect(row.recceApprovalRatePct).toBe(50);
    // geoTrue 1 / geoDecided 2 → 50
    expect(row.geoFencePassPct).toBe(50);
    // no audited installs → null (not 0/NaN)
    expect(row.avgTurnaroundDays).toBeNull();
    expect(row.rejectedCount).toBe(1);
    // Counts must come from groupBy, never a bounded findMany over the recce/install rows.
    expect(fns.recce.findMany).not.toHaveBeenCalled();
  });

  it('EXACT counts do not depend on ROW_CAP: a groupBy summing past 20k rows is honored in full', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.groupBy.mockResolvedValue([{ vendorId: 'v-1', _count: { _all: 30_000 } }]);
    fns.site.findMany.mockResolvedValue([
      { id: 's1', vendorId: 'v-1' }, { id: 's2', vendorId: 'v-1' },
    ]);
    fns.vendor.findMany.mockResolvedValue([{ id: 'v-1', code: 'VC1', name: 'Vendor One' }]);
    // A single group whose exact count far exceeds ROW_CAP (20k) — the old bounded findMany
    // would have undercounted; the groupBy _count carries the true total.
    // groupBy order: #1 by status, #2 ASM-approved (approvedById), #3 by geoFenceOk, #4 HO-approved.
    fns.recce.groupBy
      .mockResolvedValueOnce([
        { siteId: 's1', status: 'APPROVED', _count: { _all: 25_000 } },
        { siteId: 's2', status: 'REJECTED', _count: { _all: 5_000 } },
      ])
      // ASM-approved per site (approvedById set): all 25k APPROVED recces on s1 were ASM-stamped.
      .mockResolvedValueOnce([
        { siteId: 's1', _count: { _all: 25_000 } },
      ])
      .mockResolvedValueOnce([
        { siteId: 's1', geoFenceOk: true, _count: { _all: 25_000 } },
      ]);
    fns.installation.groupBy.mockResolvedValue([
      { siteId: 's1', status: 'AUDIT_APPROVED', _count: { _all: 22_000 } },
    ]);
    fns.installation.findMany.mockResolvedValue([]);
    const svc = new AnalyticsService(prisma);
    const res = await svc.vendorScorecards(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));

    const row = res.items[0];
    expect(row.recced).toBe(30_000); // 25k + 5k — no ROW_CAP truncation
    expect(row.approved).toBe(25_000);
    expect(row.installed).toBe(22_000);
    expect(row.audited).toBe(22_000);
    expect(row.rejectedCount).toBe(5_000); // 5k rejected recces + 0 rejected installs
    expect(row.recceApprovalRatePct).toBe(83.3); // approved 25k / decided (25k+5k=30k) → 83.3
  });

  it('ASM-approved counts approvedById, NOT a recceMode proxy: a manual + a resubmitted-then-HO-approved APP recce are NOT ASM-approved', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.groupBy.mockResolvedValue([{ vendorId: 'v-1', _count: { _all: 2 } }]);
    fns.site.findMany.mockResolvedValue([
      { id: 's1', vendorId: 'v-1' }, { id: 's2', vendorId: 'v-1' },
    ]);
    fns.vendor.findMany.mockResolvedValue([{ id: 'v-1', code: 'VC1', name: 'Vendor One' }]);
    // s1 = a MANUAL recce HO-approved (status APPROVED, approvedById null — never ASM-stamped).
    // s2 = a RESUBMITTED APP recce HO-approved (status APPROVED, approvedById nulled on resubmit).
    // Both are APPROVED (so counted in `recced`) and HO-signed-off (so counted in `hoApproved`),
    // but NEITHER was ASM-signed-off → the ASM-approved aggregate (#2) returns them for NO site.
    fns.recce.groupBy
      .mockResolvedValueOnce([
        { siteId: 's1', status: 'APPROVED', _count: { _all: 1 } },
        { siteId: 's2', status: 'APPROVED', _count: { _all: 1 } },
      ])
      // ASM-approved (approvedById NOT NULL): EMPTY — the DB filter excluded both approvedById-null recces.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // geo
      // HO-approved: BOTH are HO-signed-off.
      .mockResolvedValueOnce([
        { siteId: 's1', _count: { _all: 1 } },
        { siteId: 's2', _count: { _all: 1 } },
      ]);
    fns.installation.groupBy.mockResolvedValue([]);
    fns.installation.findMany.mockResolvedValue([]);
    const svc = new AnalyticsService(prisma);
    const res = await svc.vendorScorecards(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }));

    const row = res.items[0];
    expect(row.recced).toBe(2); // both APPROVED recces are still recces
    expect(row.hoApproved).toBe(2); // both are HO-signed-off / installable
    expect(row.approved).toBe(0); // but NEITHER was ASM-signed-off (approvedById null)
    // And the ASM-approved aggregate filtered on approvedById, never status/recceMode.
    expect(fns.recce.groupBy.mock.calls[1][0].where).toEqual({
      clientId: 'c1', status: 'APPROVED', approvedById: { not: null },
    });
  });
});

describe('AnalyticsService.geo — scoping + truncation + furthestStage', () => {
  it('VENDOR_HO: site query pinned to fleet + non-null coords; install stage adds installs.some', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.geo(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }), { stage: 'install' });
    const where = fns.site.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ clientId: 'c1', vendorId: 'v-7', lat: { not: null }, lng: { not: null }, installs: { some: {} } });
  });

  it('derives furthestStage/latestStatus and flags truncation past the 5000 cap', async () => {
    const { prisma, fns } = makePrisma();
    const many = Array.from({ length: 5001 }, (_, i) => ({
      id: `s${i}`, code: `C${i}`, name: `N${i}`, town: 't', lat: 12.9, lng: 77.6, vendorId: 'v-1',
      recces: [{ status: 'APPROVED' }], installs: [{ status: 'AUDIT_APPROVED' }],
    }));
    fns.site.findMany.mockResolvedValue(many);
    const svc = new AnalyticsService(prisma);
    const res = await svc.geo(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), {});

    expect(res.truncated).toBe(true);
    expect(res.points).toHaveLength(5000);
    expect(res.points[0]).toMatchObject({ furthestStage: 'AUDITED', latestStatus: 'AUDIT_APPROVED', lat: 12.9, lng: 77.6 });
  });

  it('a site with no recce reads as furthestStage NONE (coverage gap)', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.findMany.mockResolvedValue([
      { id: 's1', code: 'C1', name: 'N1', town: 't', lat: 1, lng: 2, vendorId: null, recces: [], installs: [] },
    ]);
    const svc = new AnalyticsService(prisma);
    const res = await svc.geo(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { stage: 'recce' });
    expect(res.points[0]).toMatchObject({ furthestStage: 'NONE', latestStatus: 'NONE' });
    expect(res.truncated).toBe(false);
  });

  it('an APPROVED recce resolves to ASM_APPROVED (HO pending) vs HO_APPROVED (HO signed off)', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.findMany.mockResolvedValue([
      // ASM-approved but HO still pending → ASM_APPROVED (not yet installable).
      { id: 's1', code: 'C1', name: 'N1', town: 't', lat: 1, lng: 2, vendorId: null,
        recces: [{ status: 'APPROVED', hoReviewStatus: 'PENDING' }], installs: [] },
      // ASM-approved AND HO-approved → HO_APPROVED (installable).
      { id: 's2', code: 'C2', name: 'N2', town: 't', lat: 3, lng: 4, vendorId: null,
        recces: [{ status: 'APPROVED', hoReviewStatus: 'APPROVED' }], installs: [] },
    ]);
    const svc = new AnalyticsService(prisma);
    const res = await svc.geo(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { stage: 'recce' });
    expect(res.points[0].furthestStage).toBe('ASM_APPROVED');
    expect(res.points[1].furthestStage).toBe('HO_APPROVED');
  });
});

describe('AnalyticsService.records — scoping, any-status, media → view paths', () => {
  it('VENDOR_HO recce list: scoped to fleet via site relation; resolves photos to view paths', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'REJECTED', capturedAt: null, geoFenceOk: true,
        site: { code: 'C1', name: 'N1', vendor: { name: 'Vendor One' } },
        posms: [{ photo: 'key/abc 1' }, { photo: { key: 'key/def' } }],
      },
    ]);
    fns.recce.count.mockResolvedValue(1);
    const svc = new AnalyticsService(prisma);
    const res = await svc.records(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }), { stage: 'recce', status: 'REJECTED' });

    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { vendorId: 'v-7' }, status: 'REJECTED' });
    expect(res.items[0]).toMatchObject({ id: 'r1', siteCode: 'C1', vendorName: 'Vendor One', status: 'REJECTED', geoFenceOk: true });
    expect(res.items[0].photos).toEqual([
      '/v1/media/view?key=key%2Fabc%201',
      '/v1/media/view?key=key%2Fdef',
    ]);
    expect(res).toMatchObject({ total: 1, page: 1, limit: 50 });
  });

  it('ASM install list: scoped via site.asmUserId; folds per-posm geoFenceOk', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findMany.mockResolvedValue([
      {
        id: 'i1', status: 'AUDIT_APPROVED', capturedAt: null,
        site: { code: 'C1', name: 'N1', vendor: null },
        posms: [{ photo: 'k1', geoFenceOk: true }, { photo: 'k2', geoFenceOk: false }],
      },
    ]);
    fns.installation.count.mockResolvedValue(1);
    const svc = new AnalyticsService(prisma);
    const res = await svc.records(user({ role: 'ASM', sub: 'asm-3', clientId: 'c1' }), { stage: 'install' });

    expect(fns.installation.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-3' } });
    // one posm false → folded geoFenceOk false; null vendor → vendorName null
    expect(res.items[0]).toMatchObject({ id: 'i1', vendorName: null, geoFenceOk: false });
    expect(res.items[0].photos).toEqual(['/v1/media/view?key=k1', '/v1/media/view?key=k2']);
  });

  it('CLIENT_ADMIN drill-down: an explicit vendorId narrows the site relation server-side', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.records(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { stage: 'recce', vendorId: 'v-9' });
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { vendorId: 'v-9' } });
  });

  it('VENDOR_HO passing a FOREIGN vendorId still only gets their OWN fleet (drill-down ignored)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    // A VENDOR_HO for fleet v-7 tries to drill into v-OTHER — it must be ignored, staying v-7.
    await svc.records(
      user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }),
      { stage: 'recce', vendorId: 'v-OTHER' },
    );
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ clientId: 'c1', site: { vendorId: 'v-7' } });
    expect(JSON.stringify(where)).not.toContain('v-OTHER');
  });
});

describe('AnalyticsService.drilldown — scoped sheet-shaped per-tile lists', () => {
  it('total-outlets: lists scoped SITES (site fragment), recceId null, byElementType []', async () => {
    const { prisma, fns } = makePrisma();
    fns.site.findMany.mockResolvedValue([
      { id: 's1', code: 'C1', name: 'N1', town: 'Pune', status: 'ACTIVE' },
    ]);
    fns.site.count.mockResolvedValue(1);
    const svc = new AnalyticsService(prisma);
    const res = await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'total-outlets' } as any);

    expect(fns.site.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1' });
    expect(res.items[0]).toEqual({ id: 's1', outletCode: 'C1', outletName: 'N1', town: 'Pune', recceId: null, status: 'ACTIVE' });
    expect(res.byElementType).toEqual([]);
    expect(res).toMatchObject({ total: 1, page: 1, limit: 50 });
    // No recce/install query runs for a site metric.
    expect(fns.recce.findMany).not.toHaveBeenCalled();
    expect(fns.installation.findMany).not.toHaveBeenCalled();
  });

  it('recce: all scoped recces; APP recce links (recceId set), MANUAL listed un-linked', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([
      { id: 'r1', status: 'SUBMITTED', recceMode: 'APP', site: { code: 'C1', name: 'N1', town: 't' } },
      { id: 'r2', status: 'SUBMITTED', recceMode: 'MANUAL', site: { code: 'C2', name: 'N2', town: null } },
    ]);
    fns.recce.count.mockResolvedValue(2);
    const svc = new AnalyticsService(prisma);
    const res = await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'recce' } as any);

    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1' });
    expect(res.items[0]).toEqual({ id: 'r1', outletCode: 'C1', outletName: 'N1', town: 't', recceId: 'r1', status: 'SUBMITTED' });
    // MANUAL recce: listed (count matches tile) but recceId null (un-linkable).
    expect(res.items[1]).toMatchObject({ id: 'r2', recceId: null });
  });

  it('asm-approved: APPROVED && approvedById set (matches summary — manual + resubmitted-then-HO-approved APP excluded)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'asm-approved' } as any);
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', status: 'APPROVED', approvedById: { not: null } });
  });

  it('ho-approved: APPROVED && hoReviewStatus APPROVED', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'ho-approved' } as any);
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', status: 'APPROVED', hoReviewStatus: 'APPROVED' });
  });

  it('pending-asm-review: SUBMITTED app recces STILL in the ASM stage (hoReviewStatus NONE)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'pending-asm-review' } as any);
    // hoReviewStatus NONE excludes a resubmitted app recce (SUBMITTED + APP but HO-bound).
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', status: 'SUBMITTED', recceMode: 'APP', hoReviewStatus: 'NONE' });
  });

  it('pending-ho-review: ANY recce at hoReviewStatus PENDING (mirrors summary — app/manual/resubmit)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'pending-ho-review' } as any);
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', hoReviewStatus: 'PENDING' });
  });

  it('rejected-recce / recces-app / recces-manual pin the expected recce predicate', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'rejected-recce' } as any);
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', status: 'REJECTED' });
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'recces-app' } as any);
    expect(fns.recce.findMany.mock.calls[1][0].where).toEqual({ clientId: 'c1', recceMode: 'APP' });
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'recces-manual' } as any);
    expect(fns.recce.findMany.mock.calls[2][0].where).toEqual({ clientId: 'c1', recceMode: 'MANUAL' });
  });

  it('installed / audited / pending-install-audit / rejected-install pin the install status', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    const u = user({ role: 'CLIENT_ADMIN', clientId: 'c1' });
    await svc.drilldown(u, { metric: 'installed' } as any);
    // `installed` = all scoped installations (no status filter).
    expect(fns.installation.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1' });
    await svc.drilldown(u, { metric: 'audited' } as any);
    expect(fns.installation.findMany.mock.calls[1][0].where).toEqual({ clientId: 'c1', status: 'AUDIT_APPROVED' });
    await svc.drilldown(u, { metric: 'pending-install-audit' } as any);
    expect(fns.installation.findMany.mock.calls[2][0].where).toEqual({ clientId: 'c1', status: 'SUBMITTED' });
    await svc.drilldown(u, { metric: 'rejected-install' } as any);
    expect(fns.installation.findMany.mock.calls[3][0].where).toEqual({ clientId: 'c1', status: 'AUDIT_REJECTED' });
  });

  it('install-based metric: recceId null + element breakdown via the installPosm back-relation', async () => {
    const { prisma, fns } = makePrisma();
    fns.installation.findMany.mockResolvedValue([
      { id: 'i1', status: 'AUDIT_APPROVED', site: { code: 'C1', name: 'N1', town: 't' } },
    ]);
    fns.installation.count.mockResolvedValue(1);
    fns.reccePosm.groupBy.mockResolvedValue([{ posmTypeId: 'p1', _count: { _all: 2 } }]);
    fns.posmType.findMany.mockResolvedValue([{ id: 'p1', code: 'GSB', name: 'Glow Sign Board' }]);
    const svc = new AnalyticsService(prisma);
    const res = await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'audited' } as any);

    expect(res.items[0]).toEqual({ id: 'i1', outletCode: 'C1', outletName: 'N1', town: 't', recceId: null, status: 'AUDIT_APPROVED' });
    // Breakdown rides the install scope through the back-relation (no new query surface).
    expect(fns.reccePosm.groupBy.mock.calls[0][0].where).toEqual({
      installPosm: { installation: { clientId: 'c1', status: 'AUDIT_APPROVED' } },
    });
    expect(res.byElementType).toEqual([{ code: 'GSB', name: 'Glow Sign Board', count: 2 }]);
  });

  it('recce-based element breakdown is busiest-first and rides the recce scope', async () => {
    const { prisma, fns } = makePrisma();
    fns.recce.findMany.mockResolvedValue([]);
    fns.recce.count.mockResolvedValue(0);
    fns.reccePosm.groupBy.mockResolvedValue([
      { posmTypeId: 'p1', _count: { _all: 1 } },
      { posmTypeId: 'p2', _count: { _all: 5 } },
    ]);
    fns.posmType.findMany.mockResolvedValue([
      { id: 'p1', code: 'A', name: 'Alpha' },
      { id: 'p2', code: 'B', name: 'Beta' },
    ]);
    const svc = new AnalyticsService(prisma);
    const res = await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'recce' } as any);
    expect(fns.reccePosm.groupBy.mock.calls[0][0].where).toEqual({ recce: { clientId: 'c1' } });
    expect(res.byElementType).toEqual([
      { code: 'B', name: 'Beta', count: 5 },
      { code: 'A', name: 'Alpha', count: 1 },
    ]);
  });

  it('VENDOR_HO: recce metric confined to their fleet via the site relation', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }), { metric: 'recce' } as any);
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { vendorId: 'v-7' } });
  });

  it('CLIENT_ADMIN drill-down: an explicit vendorId narrows the site relation (recce + install + site)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    const u = user({ role: 'CLIENT_ADMIN', clientId: 'c1' });
    await svc.drilldown(u, { metric: 'recce', vendorId: 'v-9' } as any);
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { vendorId: 'v-9' } });
    await svc.drilldown(u, { metric: 'installed', vendorId: 'v-9' } as any);
    expect(fns.installation.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', site: { vendorId: 'v-9' } });
    await svc.drilldown(u, { metric: 'total-outlets', vendorId: 'v-9' } as any);
    expect(fns.site.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', vendorId: 'v-9' });
  });

  it('VENDOR_HO passing a FOREIGN vendorId still only gets their OWN fleet (drill-down ignored)', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(
      user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }),
      { metric: 'recce', vendorId: 'v-OTHER' } as any,
    );
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ clientId: 'c1', site: { vendorId: 'v-7' } });
    expect(JSON.stringify(where)).not.toContain('v-OTHER');
  });

  it('ASM: recce metric territory-pinned (site.asmUserId); admin vendorId ignored for ASM', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'ASM', sub: 'asm-3', clientId: 'c1' }), { metric: 'recce', vendorId: 'v-9' } as any);
    const where = fns.recce.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ clientId: 'c1', site: { asmUserId: 'asm-3' } });
    expect(JSON.stringify(where)).not.toContain('v-9');
  });

  it('un-assumed GIFSY_ADMIN: platform-wide (no clientId) on a recce metric', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'GIFSY_ADMIN', clientId: 'gifsy', assumed: false }), { metric: 'recce' } as any);
    expect(fns.recce.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('VENDOR_HO with NO vendorId: FAILS CLOSED (403), never runs a query', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await expect(
      svc.drilldown(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: undefined }), { metric: 'recce' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fns.recce.findMany).not.toHaveBeenCalled();
    expect(fns.installation.findMany).not.toHaveBeenCalled();
    expect(fns.site.findMany).not.toHaveBeenCalled();
  });

  it('limit is capped at 200', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.drilldown(user({ role: 'CLIENT_ADMIN', clientId: 'c1' }), { metric: 'recce', limit: 5000 } as any);
    expect(fns.recce.findMany.mock.calls[0][0].take).toBe(200);
  });
});

describe('AnalyticsService.export — scoped xlsx stream', () => {
  it('returns a StreamableFile; VENDOR_HO export runs the SAME fleet-scoped queries', async () => {
    const { prisma, fns } = makePrisma();
    const svc = new AnalyticsService(prisma);
    const file = await svc.export(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: 'v-7' }));
    expect(file).toBeInstanceOf(StreamableFile);
    // summary() + vendorScorecards() both ran under the fleet scope.
    expect(fns.site.count.mock.calls[0][0].where).toEqual({ clientId: 'c1', vendorId: 'v-7' });
    expect(fns.vendor.findMany.mock.calls[0][0].where).toEqual({ clientId: 'c1', id: 'v-7' });
  });

  it('VENDOR_HO with no vendorId: export FAILS CLOSED (403)', async () => {
    const { prisma } = makePrisma();
    const svc = new AnalyticsService(prisma);
    await expect(
      svc.export(user({ role: 'VENDOR_HO', clientId: 'c1', vendorId: undefined })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
