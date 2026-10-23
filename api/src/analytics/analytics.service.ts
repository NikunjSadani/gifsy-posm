import { ForbiddenException, Injectable, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope } from '../common/tenant-scope';
import { readMediaValue } from '../capture/visibility-types';
import { buildXlsx } from '../common/xlsx';
import { GeoQueryDto } from './dto/geo-query.dto';
import { RecordsQueryDto } from './dto/records-query.dto';

/**
 * A resolved read-scope for the caller, applied UNIFORMLY to every analytics query. It is the
 * single security chokepoint of this module — build once (`resolveScope`), then AND the right
 * predicate into every count / findMany / groupBy so no endpoint can leak a fleet or a tenant.
 *
 *   CLIENT_ADMIN / assumed GIFSY_ADMIN → tenant-wide (`clientId` pinned).
 *   un-assumed GIFSY_ADMIN            → platform-wide (`clientId` undefined).
 *   VENDOR_HO / VENDOR_FIELD          → confined to their OWN fleet (`vendorId`), FAIL-CLOSED.
 *   ASM                               → confined to their territory (`site.asmUserId = sub`).
 *
 * Recce/Installation carry NO vendorId column, so vendor/ASM confinement rides the `site`
 * relation there; Site itself carries `vendorId`/`asmUserId` directly.
 */
interface Scope {
  /** Tenant filter, or undefined for a platform-wide (un-assumed OWNER) read. */
  clientId: string | undefined;
  /** Non-null only for a vendor role — the fleet the caller is confined to. */
  vendorId: string | null;
  /** True for an ASM (territory-confined via site.asmUserId). */
  isAsm: boolean;
  asmUserId: string;
  site: Prisma.SiteWhereInput;
  recce: Prisma.RecceWhereInput;
  install: Prisma.InstallationWhereInput;
  manualTask: Prisma.ManualTaskWhereInput;
  manualSub: Prisma.ManualTaskSubmissionWhereInput;
}

/**
 * AnalyticsService — read-only reporting over the existing pipeline (Site → Recce → ASM
 * approval → Installation → audit) plus the manual-task lane. Powers the admin analytics
 * dashboard AND the read-only Vendor-HO console over the SAME endpoints, role-scoped.
 *
 * No writes. Every query is scoped through {@link resolveScope} and bounded (see the Wave-4
 * note on JS-side turnaround averaging). A VENDOR_HO never sees another fleet's numbers; a
 * tenant-A admin never sees tenant-B; an un-assumed OWNER sees the platform.
 */
@Injectable()
export class AnalyticsService {
  /**
   * PERF (Wave-4): vendor-scorecard COUNTS are exact (Prisma groupBy, no cap) attributed to
   * vendors via a siteId→vendorId map. Only the turnaround AVERAGE keeps a BOUNDED JS fetch,
   * because it spans two tables (Installation ↔ Recce) with no column to GROUP BY. That fetch is
   * scoped AND capped (ROW_CAP) so it stays bounded today; at ~50k AUDIT_APPROVED rows it should
   * move into SQL (a view / raw aggregate).
   */
  private static readonly ROW_CAP = 20_000;
  /** Geo/heatmap hard cap (contract): report truncation past this many points. */
  private static readonly GEO_CAP = 5_000;

  constructor(private readonly prisma: PrismaService) {}

  // ── Scoping chokepoint ─────────────────────────────────────────────────────────

  /** Build the caller's uniform read-scope. FAIL-CLOSED for a vendor role with no vendorId. */
  private resolveScope(user: JwtPayload): Scope {
    const clientId = tenantScope(user); // undefined only for an un-assumed GIFSY_ADMIN
    const isVendor = user.role === 'VENDOR_HO' || user.role === 'VENDOR_FIELD';
    const vScope = vendorScope(user); // vendorId for a vendor role, else null
    // FAIL-CLOSED: a vendor login that (defensively) carries no vendorId must see NOTHING —
    // never fall through to an unscoped, tenant-wide read that would leak sibling fleets.
    if (isVendor && !vScope) {
      throw new ForbiddenException('Vendor login is not associated with a fleet');
    }
    const vendorId = isVendor ? vScope : null;
    const isAsm = user.role === 'ASM';
    const asmUserId = user.sub;

    // Site carries vendorId + asmUserId directly.
    const site: Prisma.SiteWhereInput = {};
    if (clientId !== undefined) site.clientId = clientId;
    if (vendorId) site.vendorId = vendorId;
    if (isAsm) site.asmUserId = asmUserId;

    // Recce/Installation carry clientId directly; vendor/ASM confinement rides the site relation.
    const siteRel: Prisma.SiteWhereInput = {};
    if (vendorId) siteRel.vendorId = vendorId;
    if (isAsm) siteRel.asmUserId = asmUserId;
    const hasSiteRel = Object.keys(siteRel).length > 0;

    const recce: Prisma.RecceWhereInput = {};
    if (clientId !== undefined) recce.clientId = clientId;
    if (hasSiteRel) recce.site = { ...siteRel };

    const install: Prisma.InstallationWhereInput = {};
    if (clientId !== undefined) install.clientId = clientId;
    if (hasSiteRel) install.site = { ...siteRel };

    // Manual tasks carry NO asmUserId/site (no territory dimension) — an ASM is tenant-scoped
    // there. A vendor sees tasks targeted at their fleet OR at all fleets (vendorId null).
    const manualTask: Prisma.ManualTaskWhereInput = {};
    if (clientId !== undefined) manualTask.clientId = clientId;
    if (vendorId) manualTask.OR = [{ vendorId }, { vendorId: null }];

    const manualSub: Prisma.ManualTaskSubmissionWhereInput = {};
    if (clientId !== undefined) manualSub.clientId = clientId;
    if (vendorId) manualSub.vendorId = vendorId;

    return { clientId, vendorId, isAsm, asmUserId, site, recce, install, manualTask, manualSub };
  }

  // ── Summary (waterfall + KPIs + manual) ─────────────────────────────────────────

  /**
   * The dashboard headline: stage funnel + rate/queue KPIs + manual-lane counts, all scoped.
   *
   * FUNNEL GRAIN = recce EVENTS, not outlets. Since an outlet can carry 1 app + N manual recces
   * (manual recces skip ASM → HO), every stage below counts recce/installation ROWS, and manual
   * recces are INCLUDED throughout (no recceMode filter anywhere): `recced` = all recces, `approved`
   * = recces at status APPROVED (a manual recce's HO-approve sets status APPROVED too), `hoApproved`
   * = those also HO-signed-off, `installed`/`audited` = installation rows. One consequence: `recced`
   * can EXCEED `totalSites` (which stays an outlet count) at outlets with multiple recces — that is
   * the intended "recce events" reading, not a bug. `byRecceMode` splits the recce total app vs
   * manual so the two paths are visible without changing the funnel. vendorScorecards counts the
   * same way (per-site groupBy summed over all recces → events), so the two views stay consistent.
   */
  async summary(user: JwtPayload) {
    const s = this.resolveScope(user);

    const [
      totalSites,
      recced,
      approved,
      hoApproved,
      rejectedRecce,
      pendingRecceReview,
      geoTrue,
      geoDecided,
      installed,
      audited,
      rejectedInstall,
      pendingInstallAudit,
      openTasks,
      manualPendingReview,
      recceManual,
      pendingHoReview,
    ] = await Promise.all([
      this.prisma.site.count({ where: s.site }),
      this.prisma.recce.count({ where: s.recce }),
      // ASM-approved: status APPROVED (regardless of HO). Includes HO-approved manual recces, whose
      // approve sets status APPROVED as well — so the funnel never undercounts manual progress.
      this.prisma.recce.count({ where: { ...s.recce, status: 'APPROVED' } }),
      // HO-approved / installable: status APPROVED AND hoReviewStatus APPROVED.
      this.prisma.recce.count({ where: { ...s.recce, status: 'APPROVED', hoReviewStatus: 'APPROVED' } }),
      this.prisma.recce.count({ where: { ...s.recce, status: 'REJECTED' } }),
      // Pending ASM review = SUBMITTED *app* recces only. A manual recce is also SUBMITTED but skips
      // ASM (it sits in the HO queue), so counting it here would mislabel it as an ASM backlog and
      // double-count it against the HO-pending lines (adversarial audit F4; matches the digest).
      this.prisma.recce.count({ where: { ...s.recce, status: 'SUBMITTED', recceMode: 'APP' } }),
      this.prisma.recce.count({ where: { ...s.recce, geoFenceOk: true } }),
      this.prisma.recce.count({ where: { ...s.recce, geoFenceOk: { not: null } } }),
      this.prisma.installation.count({ where: s.install }),
      this.prisma.installation.count({ where: { ...s.install, status: 'AUDIT_APPROVED' } }),
      this.prisma.installation.count({ where: { ...s.install, status: 'AUDIT_REJECTED' } }),
      this.prisma.installation.count({ where: { ...s.install, status: 'SUBMITTED' } }),
      this.prisma.manualTask.count({ where: { ...s.manualTask, status: 'OPEN' } }),
      this.prisma.manualTaskSubmission.count({ where: { ...s.manualSub, status: 'SUBMITTED' } }),
      // Manual recce events (cheap app-vs-manual split; app = recced − manual). Kept LAST so the
      // funnel's recce-count ordering above is unchanged. recceMode is NOT filtered anywhere else,
      // so the funnel stages already include manual recces — this only splits the recce total.
      this.prisma.recce.count({ where: { ...s.recce, recceMode: 'MANUAL' } }),
      // Recces awaiting Head-Office sign-off (the HO queue): APP (ASM-approved, hoReviewStatus
      // PENDING) OR MANUAL (skips ASM — status SUBMITTED, hoReviewStatus PENDING). Mirrors the
      // recce-ho-review queue + the digest; invisible to pendingRecceReview (SUBMITTED app-only).
      this.prisma.recce.count({
        where: {
          ...s.recce,
          hoReviewStatus: 'PENDING',
          OR: [{ status: 'APPROVED' }, { recceMode: 'MANUAL', status: 'SUBMITTED' }],
        },
      }),
    ]);

    const avgTurnaroundDays = await this.avgTurnaround(s.install);

    const kpis: Record<string, number | null> = {
      // ASM-approval rate = ASM-approved among DECIDED recces (approved + rejected); null when
      // none. This is the ASM stage rate — NOT the HO/installable rate (see hoApproved below).
      recceApprovalRatePct: this.pct(approved, approved + rejectedRecce),
      installAuditApprovalRatePct: this.pct(audited, audited + rejectedInstall),
      // Geo pass rate = among recces with a verifiable fix (geoFenceOk not null).
      geoFencePassRatePct: this.pct(geoTrue, geoDecided),
      pendingRecceReview,
      pendingHoReview,
      pendingInstallAudit,
      rejectedRecce,
      rejectedInstall,
    };
    // null → omit (no AUDIT_APPROVED install with both timestamps in scope).
    if (avgTurnaroundDays !== null) kpis.avgTurnaroundDays = avgTurnaroundDays;

    return {
      // `approved` = ASM-approved; `hoApproved` = HO-approved / installable (subset of approved).
      waterfall: { totalSites, recced, approved, hoApproved, installed, audited },
      // Recce-event split by entry path (app = total − manual). `manualTasks` below is the unrelated
      // generic manual-task lane; this is the APP-vs-MANUAL recce classification.
      byRecceMode: { app: recced - recceManual, manual: recceManual },
      kpis,
      manual: { openTasks, pendingReview: manualPendingReview },
    };
  }

  /**
   * Mean(auditedAt − recce.receivedAt) in days over AUDIT_APPROVED installs in scope, computed
   * in JS over a BOUNDED, scoped fetch (see the ROW_CAP / Wave-4 note). Returns null when no
   * qualifying row carries both timestamps.
   */
  private async avgTurnaround(installWhere: Prisma.InstallationWhereInput): Promise<number | null> {
    const rows = await this.prisma.installation.findMany({
      where: { ...installWhere, status: 'AUDIT_APPROVED' },
      select: { auditedAt: true, recce: { select: { receivedAt: true } } },
      take: AnalyticsService.ROW_CAP,
    });
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const audited = r.auditedAt;
      const received = r.recce?.receivedAt;
      if (!audited || !received) continue;
      sum += (audited.getTime() - received.getTime()) / 86_400_000;
      n += 1;
    }
    if (n === 0) return null;
    return Math.round((sum / n) * 10) / 10;
  }

  // ── Vendor scorecards ───────────────────────────────────────────────────────────

  /**
   * Per-vendor scorecard rows. Admin → one row per vendor in the tenant (platform-wide for an
   * un-assumed OWNER); VENDOR_HO → ONLY their own row; ASM → vendors with a site in their
   * territory. Counts (recced/approved/rejected/installed/audited + geo pass) are EXACT — Prisma
   * groupBy over the whole scope with NO row cap — then attributed to each vendor via a
   * siteId→vendorId map. This makes the scorecards equal the funnel's exact count() at any tenant
   * size (the old bounded findMany silently undercounted past ROW_CAP). Only avgTurnaround (an
   * average, not a count) keeps a bounded fetch of the far-smaller AUDIT_APPROVED set.
   */
  async vendorScorecards(user: JwtPayload) {
    const s = this.resolveScope(user);

    // Sites per vendor — exact, via groupBy. Doubles as the ASM territory vendor set.
    const siteGroups = await this.prisma.site.groupBy({
      by: ['vendorId'],
      where: s.site,
      _count: { _all: true },
    });
    const sitesByVendor = new Map<string, number>();
    for (const g of siteGroups) {
      if (g.vendorId) sitesByVendor.set(g.vendorId, g._count._all);
    }
    const territoryVendorIds = [...sitesByVendor.keys()];

    // siteId → vendorId map (scoped, bounded by #sites) — the join key for the exact aggregates
    // below, since Recce/Installation carry no vendorId column to GROUP BY directly.
    const siteRows = await this.prisma.site.findMany({
      where: s.site,
      select: { id: true, vendorId: true },
    });
    const siteToVendor = new Map<string, string | null>();
    for (const sr of siteRows) siteToVendor.set(sr.id, sr.vendorId);

    // The vendor universe for the caller.
    const vendorWhere: Prisma.VendorWhereInput = {};
    if (s.clientId !== undefined) vendorWhere.clientId = s.clientId;
    if (s.vendorId) vendorWhere.id = s.vendorId; // VENDOR_HO → only their own row
    if (s.isAsm) vendorWhere.id = { in: territoryVendorIds }; // ASM → their territory's vendors
    const vendors = await this.prisma.vendor.findMany({
      where: vendorWhere,
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    // EXACT per-site aggregates via groupBy (NO row cap) — attributed to vendors via siteToVendor.
    const [recceByStatus, recceByGeo, recceHoApproved, installByStatus, turnaroundRows] = await Promise.all([
      this.prisma.recce.groupBy({
        by: ['siteId', 'status'],
        where: s.recce,
        _count: { _all: true },
      }),
      this.prisma.recce.groupBy({
        by: ['siteId', 'geoFenceOk'],
        where: s.recce,
        _count: { _all: true },
      }),
      // HO-approved / installable per site: ASM-approved AND HO-signed-off. Separate from
      // recceByStatus because that groups by status alone and can't see hoReviewStatus.
      this.prisma.recce.groupBy({
        by: ['siteId'],
        where: { ...s.recce, status: 'APPROVED', hoReviewStatus: 'APPROVED' },
        _count: { _all: true },
      }),
      this.prisma.installation.groupBy({
        by: ['siteId', 'status'],
        where: s.install,
        _count: { _all: true },
      }),
      // avgTurnaround only: bounded, DETERMINISTIC (orderBy) fetch of the far-smaller
      // AUDIT_APPROVED set (Wave-4 note: an average, not a count — no funnel contradiction).
      this.prisma.installation.findMany({
        where: { ...s.install, status: 'AUDIT_APPROVED' },
        select: {
          auditedAt: true,
          recce: { select: { receivedAt: true } },
          site: { select: { vendorId: true } },
        },
        orderBy: { id: 'asc' },
        take: AnalyticsService.ROW_CAP,
      }),
    ]);

    interface Bucket {
      recced: number; approved: number; hoApproved: number; rejectedRecce: number;
      geoTrue: number; geoDecided: number;
      installed: number; audited: number; rejectedInstall: number;
      turnaroundSum: number; turnaroundN: number;
    }
    const empty = (): Bucket => ({
      recced: 0, approved: 0, hoApproved: 0, rejectedRecce: 0, geoTrue: 0, geoDecided: 0,
      installed: 0, audited: 0, rejectedInstall: 0, turnaroundSum: 0, turnaroundN: 0,
    });
    const buckets = new Map<string, Bucket>();
    const bucket = (vid: string | null | undefined): Bucket | null => {
      if (!vid) return null;
      let b = buckets.get(vid);
      if (!b) buckets.set(vid, (b = empty()));
      return b;
    };

    // Recce counts by status (recced = all statuses; approved / rejected among them).
    for (const g of recceByStatus) {
      const b = bucket(siteToVendor.get(g.siteId));
      if (!b) continue;
      const n = g._count._all;
      b.recced += n;
      if (g.status === 'APPROVED') b.approved += n;
      else if (g.status === 'REJECTED') b.rejectedRecce += n;
    }
    // HO-approved / installable per site (status APPROVED && hoReviewStatus APPROVED).
    for (const g of recceHoApproved) {
      const b = bucket(siteToVendor.get(g.siteId));
      if (!b) continue;
      b.hoApproved += g._count._all;
    }
    // Geo-fence pass among recces with a verifiable fix (geoFenceOk not null).
    for (const g of recceByGeo) {
      if (g.geoFenceOk === null) continue;
      const b = bucket(siteToVendor.get(g.siteId));
      if (!b) continue;
      const n = g._count._all;
      b.geoDecided += n;
      if (g.geoFenceOk === true) b.geoTrue += n;
    }
    // Install counts by status.
    for (const g of installByStatus) {
      const b = bucket(siteToVendor.get(g.siteId));
      if (!b) continue;
      const n = g._count._all;
      b.installed += n;
      if (g.status === 'AUDIT_APPROVED') b.audited += n;
      else if (g.status === 'AUDIT_REJECTED') b.rejectedInstall += n;
    }
    // Turnaround average (bounded set, bucketed by the install's site vendorId).
    for (const i of turnaroundRows) {
      const b = bucket(i.site?.vendorId);
      if (!b) continue;
      const received = i.recce?.receivedAt;
      if (i.auditedAt && received) {
        b.turnaroundSum += (i.auditedAt.getTime() - received.getTime()) / 86_400_000;
        b.turnaroundN += 1;
      }
    }

    const items = vendors.map((v) => {
      const b = buckets.get(v.id) ?? empty();
      return {
        vendorId: v.id,
        vendorCode: v.code,
        vendorName: v.name,
        sites: sitesByVendor.get(v.id) ?? 0,
        recced: b.recced,
        // `approved` = ASM-approved; `hoApproved` = HO-approved / installable (subset).
        approved: b.approved,
        hoApproved: b.hoApproved,
        installed: b.installed,
        audited: b.audited,
        // ASM-approval rate (ASM-approved among decided) — NOT the HO/installable rate.
        recceApprovalRatePct: this.pct(b.approved, b.approved + b.rejectedRecce),
        geoFencePassPct: this.pct(b.geoTrue, b.geoDecided),
        avgTurnaroundDays:
          b.turnaroundN > 0 ? Math.round((b.turnaroundSum / b.turnaroundN) * 10) / 10 : null,
        // Total rejected submissions across both review stages for this fleet.
        rejectedCount: b.rejectedRecce + b.rejectedInstall,
      };
    });

    return { items };
  }

  // ── Geo / heatmap ───────────────────────────────────────────────────────────────

  /**
   * Map points for scoped sites with coordinates. `stage=recce` (default) → all scoped sites
   * with coords (coverage incl. un-recced gaps → furthestStage NONE); `stage=install` → only
   * scoped sites carrying an installation. Capped at GEO_CAP; `truncated` flags the cap.
   */
  async geo(user: JwtPayload, q: GeoQueryDto) {
    const s = this.resolveScope(user);
    const stage = q.stage ?? 'recce';

    const where: Prisma.SiteWhereInput = {
      ...s.site,
      lat: { not: null },
      lng: { not: null },
    };
    if (stage === 'install') where.installs = { some: {} };

    const sites = await this.prisma.site.findMany({
      where,
      select: {
        id: true, code: true, name: true, town: true, lat: true, lng: true, vendorId: true,
        // A site can now carry MANY recces (1 app + N manual), so this is N rows, not 0-or-1. The
        // furthest-stage reducer below folds across all of them (no [0] single-recce assumption).
        recces: { select: { status: true, hoReviewStatus: true } },
        // A site can now carry MANY installs too (one per installed recce — app and/or manual). The
        // furthest-stage reducer below folds across all of them (AUDITED if ANY is audit-approved).
        installs: { select: { status: true }, orderBy: { receivedAt: 'desc' } },
      },
      take: AnalyticsService.GEO_CAP + 1, // +1 to detect truncation
      orderBy: { code: 'asc' },
    });

    const truncated = sites.length > AnalyticsService.GEO_CAP;
    const page = truncated ? sites.slice(0, AnalyticsService.GEO_CAP) : sites;

    // Rank for folding many recces → the single furthest recce stage a site has reached. An
    // ASM-approved recce resolves to HO_APPROVED only once HO has signed off; otherwise ASM_APPROVED
    // (installable vs merely ASM-approved — never conflated). A SUBMITTED/REJECTED recce is RECCED.
    const recceStageOf = (r: { status: string; hoReviewStatus: string }) =>
      r.status === 'APPROVED'
        ? r.hoReviewStatus === 'APPROVED'
          ? 'HO_APPROVED'
          : 'ASM_APPROVED'
        : 'RECCED';
    const RECCE_RANK: Record<string, number> = { RECCED: 1, ASM_APPROVED: 2, HO_APPROVED: 3 };

    const points = page.map((site) => {
      // Fold across ALL of the site's installs (not installs[0]) → a site with multiple installed
      // recces (app and/or manual) is AUDITED if ANY install is audit-approved, else INSTALLED.
      const hasInstall = site.installs.length > 0;
      const hasAudited = site.installs.some((i) => i.status === 'AUDIT_APPROVED');
      // Fold across ALL of the site's recces (not recces[0]) → the single furthest-stage recce, so a
      // site with 1 app + N manual recces is classified by its best stage, deterministically.
      let furthestStage:
        | 'NONE' | 'RECCED' | 'ASM_APPROVED' | 'HO_APPROVED' | 'INSTALLED' | 'AUDITED' = 'NONE';
      let bestRecce: { status: string; hoReviewStatus: string } | null = null;
      for (const r of site.recces) {
        const stage = recceStageOf(r);
        if (!bestRecce || RECCE_RANK[stage] > RECCE_RANK[recceStageOf(bestRecce)]) {
          bestRecce = r;
          furthestStage = stage;
        }
      }
      if (hasInstall) furthestStage = hasAudited ? 'AUDITED' : 'INSTALLED';
      const latestStatus = (hasAudited ? 'AUDIT_APPROVED' : site.installs[0]?.status) ?? bestRecce?.status ?? 'NONE';
      return {
        siteId: site.id,
        code: site.code,
        name: site.name,
        town: site.town,
        lat: this.dec(site.lat),
        lng: this.dec(site.lng),
        vendorId: site.vendorId,
        furthestStage,
        latestStatus,
      };
    });

    return { points, truncated };
  }

  // ── Records (drill-down to evidence) ─────────────────────────────────────────────

  /**
   * The broad, ANY-status drill-down list behind the evidence viewer (the approval/audit queues
   * are SUBMITTED-only — this is not that). Media values resolve to auth-gated view paths.
   */
  async records(user: JwtPayload, q: RecordsQueryDto) {
    const s = this.resolveScope(user);
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;
    const status = q.status?.trim() || undefined;
    // Admin-only vendor drill-down (vendor-scorecard-row click). IGNORED for a VENDOR_HO/ASM —
    // that caller stays confined by resolveScope, so a VENDOR_HO can NEVER surface a foreign
    // fleet by passing its vendorId (fail-closed to their own).
    const isAdmin = user.role === 'CLIENT_ADMIN' || user.role === 'GIFSY_ADMIN';
    const drillVendorId = isAdmin ? q.vendorId?.trim() || undefined : undefined;

    if (q.stage === 'install') {
      const where: Prisma.InstallationWhereInput = { ...s.install };
      if (status) where.status = status as Prisma.InstallationWhereInput['status'];
      if (drillVendorId) {
        where.site = { ...(where.site as Prisma.SiteWhereInput | undefined), vendorId: drillVendorId };
      }
      const [rows, total] = await Promise.all([
        this.prisma.installation.findMany({
          where,
          orderBy: { receivedAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            status: true,
            capturedAt: true,
            site: { select: { code: true, name: true, vendor: { select: { name: true } } } },
            posms: { select: { photo: true, geoFenceOk: true } },
          },
        }),
        this.prisma.installation.count({ where }),
      ]);
      const items = rows.map((r) => ({
        id: r.id,
        siteCode: r.site.code,
        siteName: r.site.name,
        vendorName: r.site.vendor?.name ?? null,
        status: r.status,
        capturedAt: r.capturedAt,
        geoFenceOk: this.foldGeo(r.posms.map((p) => p.geoFenceOk)),
        photos: this.viewPaths(r.posms.map((p) => p.photo)),
      }));
      return { items, total, page, limit };
    }

    // stage === 'recce'
    const where: Prisma.RecceWhereInput = { ...s.recce };
    if (status) where.status = status as Prisma.RecceWhereInput['status'];
    if (drillVendorId) {
      where.site = { ...(where.site as Prisma.SiteWhereInput | undefined), vendorId: drillVendorId };
    }
    const [rows, total] = await Promise.all([
      this.prisma.recce.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          status: true,
          capturedAt: true,
          geoFenceOk: true,
          site: { select: { code: true, name: true, vendor: { select: { name: true } } } },
          posms: { select: { photo: true } },
        },
      }),
      this.prisma.recce.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      siteCode: r.site.code,
      siteName: r.site.name,
      vendorName: r.site.vendor?.name ?? null,
      status: r.status,
      capturedAt: r.capturedAt,
      geoFenceOk: r.geoFenceOk,
      photos: this.viewPaths(r.posms.map((p) => p.photo)),
    }));
    return { items, total, page, limit };
  }

  // ── Export (xlsx) ────────────────────────────────────────────────────────────────

  /**
   * Summary + Vendor-Scorecards workbook, SAME scoping as the JSON endpoints. Built via
   * buildXlsx (every cell cellSafe-escaped against formula injection) and streamed as an
   * attachment. Roles: CLIENT_ADMIN, GIFSY_ADMIN, VENDOR_HO (a VENDOR_HO export contains ONLY
   * their own fleet — the scoping holds here exactly as on summary/scorecards).
   */
  async export(user: JwtPayload): Promise<StreamableFile> {
    const [summary, scorecards] = await Promise.all([
      this.summary(user),
      this.vendorScorecards(user),
    ]);

    const summaryRows: Record<string, unknown>[] = [
      { Metric: 'Total outlets', Value: summary.waterfall.totalSites },
      { Metric: 'Recce', Value: summary.waterfall.recced },
      { Metric: 'ASM approved', Value: summary.waterfall.approved },
      { Metric: 'HO approved (installable)', Value: summary.waterfall.hoApproved },
      { Metric: 'Installed', Value: summary.waterfall.installed },
      { Metric: 'Audited', Value: summary.waterfall.audited },
      { Metric: 'ASM approval rate (%)', Value: summary.kpis.recceApprovalRatePct },
      { Metric: 'Install audit approval rate (%)', Value: summary.kpis.installAuditApprovalRatePct },
      { Metric: 'Geo-fence pass rate (%)', Value: summary.kpis.geoFencePassRatePct },
      {
        Metric: 'Avg turnaround (days)',
        Value: summary.kpis.avgTurnaroundDays ?? 'n/a',
      },
      { Metric: 'Pending recce review', Value: summary.kpis.pendingRecceReview },
      { Metric: 'Pending install audit', Value: summary.kpis.pendingInstallAudit },
      { Metric: 'Rejected recce', Value: summary.kpis.rejectedRecce },
      { Metric: 'Rejected install', Value: summary.kpis.rejectedInstall },
      { Metric: 'Open manual tasks', Value: summary.manual.openTasks },
      { Metric: 'Manual pending review', Value: summary.manual.pendingReview },
    ];

    const scorecardRows: Record<string, unknown>[] = scorecards.items.map((v) => ({
      'Vendor code': v.vendorCode,
      'Vendor name': v.vendorName,
      Outlets: v.sites,
      Recce: v.recced,
      'ASM approved': v.approved,
      'HO approved': v.hoApproved,
      Installed: v.installed,
      Audited: v.audited,
      'ASM approval %': v.recceApprovalRatePct,
      'Geo-fence pass %': v.geoFencePassPct,
      'Avg turnaround (days)': v.avgTurnaroundDays ?? 'n/a',
      Rejected: v.rejectedCount,
    }));

    const buffer = buildXlsx([
      { name: 'Summary', rows: summaryRows },
      { name: 'Vendor Scorecards', rows: scorecardRows },
    ]);

    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="posm-analytics.xlsx"',
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────────────

  /**
   * 0–100 rate to one decimal. Returns null (→ "—" in the UI) when there is NO data to rate
   * (den ≤ 0) rather than a misleading 0 — mirrors avgTurnaround's null-on-no-data contract.
   */
  private pct(num: number, den: number): number | null {
    if (den <= 0) return null;
    return Math.round((num / den) * 1000) / 10;
  }

  /** Prisma.Decimal | null → number | null for the JSON response. */
  private dec(v: Prisma.Decimal | null): number | null {
    return v != null ? Number(v) : null;
  }

  /**
   * Fold a set of per-photo geo-fence results into one: all true → true; any false → false;
   * otherwise (no photos / all unverifiable) → null. (Installation has no top-level geoFenceOk;
   * it lives per InstallPosm.)
   */
  private foldGeo(vals: (boolean | null)[]): boolean | null {
    if (vals.length > 0 && vals.every((v) => v === true)) return true;
    if (vals.some((v) => v === false)) return false;
    return null;
  }

  /** Stored MediaValue[] → auth-gated view paths, dropping empties. */
  private viewPaths(photos: unknown[]): string[] {
    const out: string[] = [];
    for (const p of photos) {
      const { key } = readMediaValue(p);
      if (key) out.push(`/v1/media/view?key=${encodeURIComponent(key)}`);
    }
    return out;
  }
}
