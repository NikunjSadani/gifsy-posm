/* ─── POSM Analytics — typed API client + pure helpers ────────────────────────
   Thin wrappers over the backend `/v1/analytics/*` endpoints, reached through the
   same-origin `/api/*` proxy (which maps `/api`→`/v1` and injects the bearer cookie).
   All endpoints are role-scoped SERVER-SIDE: an admin (GIFSY_ADMIN / CLIENT_ADMIN)
   sees the whole tenant; a VENDOR_HO sees only their own fleet. The frontend sends
   the same requests for both — the backend narrows the data.

   Pure helpers (percentage formatting, funnel math, stage colours, geo-fence copy,
   URL builders) live here and are unit-tested — no React, no fetch.
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';
import type { ApprovalRecord, ElementTypeBreakdown } from '@/lib/review/api';

// Re-export the drill-down record shapes so analytics call sites (and the shared
// MetricDrilldownSheet) can import them from one place. The backend's
// `/v1/analytics/drilldown` rows are byte-identical to the approval records.
export type { ApprovalRecord, ElementTypeBreakdown };

// ─── Domain types (mirror the AnalyticsService response shapes) ────────────────

/** GET /api/analytics/summary */
export interface SummaryWaterfall {
  totalSites: number;
  recced: number;
  /** ASM-approved: status APPROVED, regardless of the HO review stage. */
  approved: number;
  /** HO-approved / installable: status APPROVED && hoReviewStatus APPROVED (subset of `approved`). */
  hoApproved: number;
  installed: number;
  audited: number;
}

export interface SummaryKpis {
  recceApprovalRatePct: number | null;
  installAuditApprovalRatePct: number | null;
  geoFencePassRatePct: number | null;
  avgTurnaroundDays: number | null;
  pendingRecceReview: number;
  /** Recces awaiting Head-Office sign-off (app ASM-approved-awaiting-HO + manual awaiting-HO). */
  pendingHoReview: number;
  pendingInstallAudit: number;
  rejectedRecce: number;
  rejectedInstall: number;
}

/** Recce-event split by entry path (app = recce total − manual). */
export interface SummaryByRecceMode {
  app: number;
  manual: number;
}

export interface SummaryManual {
  openTasks: number;
  pendingReview: number;
}

export interface AnalyticsSummary {
  waterfall: SummaryWaterfall;
  kpis: SummaryKpis;
  byRecceMode: SummaryByRecceMode;
  manual: SummaryManual;
}

/** GET /api/analytics/vendor-scorecards */
export interface VendorScorecard {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  sites: number;
  recced: number;
  /** ASM-approved: status APPROVED, regardless of HO. */
  approved: number;
  /** HO-approved / installable: status APPROVED && hoReviewStatus APPROVED (subset of `approved`). */
  hoApproved: number;
  installed: number;
  audited: number;
  /** ASM-approval rate (ASM-approved among decided) — NOT the HO/installable rate. */
  recceApprovalRatePct: number | null;
  geoFencePassPct: number | null;
  avgTurnaroundDays: number | null;
  rejectedCount: number;
}

export interface VendorScorecardsResult {
  items: VendorScorecard[];
}

/** GET /api/analytics/geo?stage=recce|install */
export type FurthestStage =
  | 'NONE'
  | 'RECCED'
  | 'ASM_APPROVED'
  | 'HO_APPROVED'
  | 'INSTALLED'
  | 'AUDITED';

export interface GeoPoint {
  siteId: string;
  code: string;
  name: string;
  town: string | null;
  lat: number | null;
  lng: number | null;
  vendorId: string | null;
  furthestStage: FurthestStage;
  latestStatus: string | null;
}

export interface GeoResult {
  points: GeoPoint[];
  /** True when the backend capped the point set (GEO_CAP) — surface a "refine filters" notice. */
  truncated: boolean;
}

/** GET /api/analytics/records?stage=recce|install&status=&page=&limit= */
export interface AnalyticsRecord {
  id: string;
  siteCode: string;
  siteName: string;
  vendorName: string;
  status: string;
  capturedAt: string | null;
  geoFenceOk: boolean | null;
  /** Backend-relative view paths (`/v1/media/view?...`); render via `toAnalyticsMediaUrl`. */
  photos: string[];
}

export interface RecordsResult {
  items: AnalyticsRecord[];
  total: number;
  page: number;
  limit: number;
}

export type AnalyticsStage = 'recce' | 'install';

/**
 * The drill-down metric vocabulary for the unified analytics drill-down sheet. Every drillable
 * tile on the admin/vendor analytics dashboard maps to exactly one of these, which the backend
 * `/v1/analytics/drilldown` endpoint resolves to the underlying outlet records (role-scoped).
 */
export type AnalyticsMetric =
  | 'total-outlets'
  | 'recce'
  | 'asm-approved'
  | 'ho-approved'
  | 'installed'
  | 'audited'
  | 'pending-asm-review'
  | 'pending-ho-review'
  | 'pending-install-audit'
  | 'rejected-recce'
  | 'rejected-install'
  | 'recces-app'
  | 'recces-manual';

/** GET /api/analytics/drilldown — one page of outlet records behind a metric (+ element rollup). */
export interface AnalyticsDrilldownResult {
  items: ApprovalRecord[];
  byElementType: ElementTypeBreakdown[];
  total: number;
  page: number;
  limit: number;
}

// ─── Stage presentation (colours + labels) ─────────────────────────────────────

/**
 * Marker / legend colour by the FURTHEST stage a site reached — a practical execution
 * heatmap: grey = untouched, warming through amber/blue/violet to green = fully audited.
 */
export const STAGE_COLORS: Record<FurthestStage, string> = {
  NONE: '#9ca3af', // grey-400
  RECCED: '#f59e0b', // amber-500
  ASM_APPROVED: '#3b82f6', // blue-500 — ASM approved (not yet installable)
  HO_APPROVED: '#6366f1', // indigo-500 — HO approved (installable)
  INSTALLED: '#8b5cf6', // violet-500
  AUDITED: '#22c55e', // green-500
};

/** Human labels for the furthest-stage vocabulary (legend + tooltips). */
export const STAGE_LABELS: Record<FurthestStage, string> = {
  NONE: 'Not started',
  RECCED: 'Recce',
  ASM_APPROVED: 'ASM approved',
  HO_APPROVED: 'HO approved',
  INSTALLED: 'Installed',
  AUDITED: 'Audited',
};

/** Ordered stages for a stable legend. */
export const STAGE_ORDER: FurthestStage[] = [
  'NONE',
  'RECCED',
  'ASM_APPROVED',
  'HO_APPROVED',
  'INSTALLED',
  'AUDITED',
];

/** Colour for a furthest-stage value; falls back to grey for an unknown value. */
export function stageColor(stage: FurthestStage | string | null | undefined): string {
  if (stage && stage in STAGE_COLORS) return STAGE_COLORS[stage as FurthestStage];
  return STAGE_COLORS.NONE;
}

// ─── Percentage / number formatting (honest copy) ──────────────────────────────

/**
 * Format a percentage for display. A missing / not-applicable rate (null / undefined /
 * NaN) renders as an em-dash "—" — NEVER a misleading "0%". A real 0 stays "0%".
 */
export function formatPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return '—';
  return `${Math.round(pct)}%`;
}

/**
 * Compute a conversion percentage numerator/denominator. Returns null (→ "—") when the
 * denominator is 0 or missing, so a "0 of 0" ratio is honestly blank rather than "0%".
 */
export function conversionPct(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  // Clamp at 100%: a funnel bar can't exceed full width, and a step conversion can't honestly
  // exceed the prior stage. The POSM recce funnel has two paths (APP: recce→ASM→HO; MANUAL:
  // recce→HO, skipping ASM), so e.g. HO-approved (all modes) can exceed ASM-approved (APP-only) —
  // showing ">100% of prev" would read as broken, so we cap the displayed conversion at 100%.
  return Math.min(100, (numerator / denominator) * 100);
}

/** Format an average-turnaround value in days. Null / NaN → "—"; otherwise "N.N d". */
export function formatDays(days: number | null | undefined): string {
  if (days == null || Number.isNaN(days)) return '—';
  return `${days.toFixed(1)} d`;
}

// ─── Waterfall funnel math ─────────────────────────────────────────────────────

export type FunnelStageKey =
  | 'totalSites'
  | 'recced'
  | 'approved'
  | 'hoApproved'
  | 'installed'
  | 'audited';

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number;
  /** Bar width as a % of the funnel's top (totalSites); null when totalSites is 0. */
  pctOfTotal: number | null;
  /** Conversion % from the immediately-previous stage; null for the first stage / 0 prev. */
  conversionFromPrev: number | null;
  /** The drill-down metric this stage opens — every funnel stage is now drillable via the sheet. */
  metric: AnalyticsMetric;
}

/**
 * Turn the summary waterfall counts into an ordered 6-stage funnel with bar widths (share of
 * total sites) and step-to-step conversion percentages. The funnel order is
 * Total sites → Recced → ASM approved → HO approved → Installed → Audited, so an ASM-approved
 * recce is never conflated with an installable (HO-approved) one. Pure + deterministic so the
 * admin and vendor funnels render identically. Every stage carries the drill-down `metric` the
 * unified sheet opens — including HO approved, which the dedicated `/drilldown` endpoint now
 * resolves correctly (the old records endpoint had no hoReviewStatus lens, so it was dead before).
 */
export function buildFunnel(w: SummaryWaterfall): FunnelStage[] {
  const total = w.totalSites;
  const pctOfTotal = (n: number) => conversionPct(n, total);
  return [
    {
      key: 'totalSites',
      label: 'Total outlets',
      count: w.totalSites,
      pctOfTotal: total > 0 ? 100 : null,
      conversionFromPrev: null,
      metric: 'total-outlets',
    },
    {
      key: 'recced',
      label: 'Recce',
      count: w.recced,
      pctOfTotal: pctOfTotal(w.recced),
      conversionFromPrev: conversionPct(w.recced, w.totalSites),
      metric: 'recce',
    },
    {
      key: 'approved',
      label: 'ASM approved',
      count: w.approved,
      pctOfTotal: pctOfTotal(w.approved),
      conversionFromPrev: conversionPct(w.approved, w.recced),
      metric: 'asm-approved',
    },
    {
      key: 'hoApproved',
      label: 'HO approved',
      count: w.hoApproved,
      pctOfTotal: pctOfTotal(w.hoApproved),
      conversionFromPrev: conversionPct(w.hoApproved, w.approved),
      metric: 'ho-approved',
    },
    {
      key: 'installed',
      label: 'Installed',
      count: w.installed,
      pctOfTotal: pctOfTotal(w.installed),
      // Conversion is measured from HO approved (the installable set), not ASM approved.
      conversionFromPrev: conversionPct(w.installed, w.hoApproved),
      metric: 'installed',
    },
    {
      key: 'audited',
      label: 'Audited',
      count: w.audited,
      pctOfTotal: pctOfTotal(w.audited),
      conversionFromPrev: conversionPct(w.audited, w.installed),
      metric: 'audited',
    },
  ];
}

// ─── Geo-fence honest rendering ────────────────────────────────────────────────

export type GeoFenceTone = 'ok' | 'bad' | 'unknown';

export interface GeoFenceLabel {
  label: string;
  tone: GeoFenceTone;
}

/**
 * Honest geo-fence status for a captured record. We NEVER claim GPS is "verified":
 *   true  → "Inside geo-fence"      (ok)
 *   false → "Outside geo-fence"     (bad)
 *   null  → "Location not verified" (unknown)
 */
export function geoFenceLabel(ok: boolean | null | undefined): GeoFenceLabel {
  if (ok === true) return { label: 'Inside geo-fence', tone: 'ok' };
  if (ok === false) return { label: 'Outside geo-fence', tone: 'bad' };
  return { label: 'Location not verified', tone: 'unknown' };
}

// ─── URL builders ──────────────────────────────────────────────────────────────

/**
 * Same-origin xlsx export URL. Rendered as an `<a href>` so the browser downloads the
 * attachment and the edge proxy injects auth — never fetched with a manual bearer header.
 * The backend export is always Summary + Vendor-Scorecards (no stage scoping), so the URL
 * carries no query params — the signature no longer implies a stage-scoped export.
 */
export function exportUrl(): string {
  return '/api/analytics/export';
}

/**
 * Same-origin .xlsx export URL for ONE drilled metric's FULL (uncapped) enriched set, carrying the
 * same `metric` (+ optional admin `vendorId`) as the open drill-down sheet. Rendered as an
 * `<a href download>` so the edge proxy injects auth and the browser streams the attachment; a
 * VENDOR_HO / ASM download is fleet- / territory-scoped SERVER-SIDE (an injected vendorId is ignored).
 */
export function drilldownExportUrl(metric: string, opts: { vendorId?: string } = {}): string {
  const params = new URLSearchParams();
  params.set('metric', metric);
  const vendorId = opts.vendorId?.trim();
  if (vendorId) params.set('vendorId', vendorId);
  return `/api/analytics/drilldown.xlsx?${params.toString()}`;
}

/**
 * Serialise records-drilldown filters to a query string (leading `?` when non-empty).
 * Blank status is dropped; page 0 is preserved (not treated as absent). An optional `vendorId`
 * narrows the list SERVER-SIDE (admin vendor drill-down) so `total`/pagination stay correct.
 */
export function recordsQueryString(filters: {
  stage: AnalyticsStage;
  status?: string;
  vendorId?: string;
  page?: number;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set('stage', filters.stage);
  const status = filters.status?.trim();
  if (status) params.set('status', status);
  const vendorId = filters.vendorId?.trim();
  if (vendorId) params.set('vendorId', vendorId);
  if (filters.page != null) params.set('page', String(filters.page));
  if (filters.limit != null) params.set('limit', String(filters.limit));
  return `?${params.toString()}`;
}

/**
 * Translate a backend media view-path (`/v1/media/view?key=…`) into the browser proxy path
 * (`/api/media/view?key=…`). An already-`/api`-prefixed or absolute value is returned as-is.
 */
export function toAnalyticsMediaUrl(viewPath: string): string {
  if (!viewPath) return viewPath;
  if (viewPath.startsWith('/api/')) return viewPath;
  if (viewPath.startsWith('/v1/')) return `/api${viewPath.slice(3)}`;
  return viewPath;
}

// ─── Network calls ─────────────────────────────────────────────────────────────

/** GET the headline funnel + KPI + manual summary (role-scoped server-side). */
export function fetchSummary(): Promise<ApiResponse<AnalyticsSummary>> {
  return api.get<AnalyticsSummary>('/api/analytics/summary');
}

/** GET vendor scorecards (admin = all vendors; VENDOR_HO = only their own row). */
export function fetchVendorScorecards(): Promise<ApiResponse<VendorScorecardsResult>> {
  return api.get<VendorScorecardsResult>('/api/analytics/vendor-scorecards');
}

/** GET geo points for the map, coloured by furthest stage, for the given stage lens. */
export function fetchGeo(stage: AnalyticsStage): Promise<ApiResponse<GeoResult>> {
  return api.get<GeoResult>(`/api/analytics/geo?stage=${encodeURIComponent(stage)}`);
}

/**
 * Serialise a drill-down query to a query string (leading `?`). `metric` is always present; an
 * optional `vendorId` narrows the list SERVER-SIDE to one vendor (admin scorecard-row drill-down)
 * so `total`/pagination stay correct. Blank vendorId is dropped; page 0 is preserved (not absent).
 */
export function drilldownQueryString(
  metric: string,
  opts: { vendorId?: string; page?: number; limit?: number } = {},
): string {
  const params = new URLSearchParams();
  params.set('metric', metric);
  const vendorId = opts.vendorId?.trim();
  if (vendorId) params.set('vendorId', vendorId);
  if (opts.page != null) params.set('page', String(opts.page));
  if (opts.limit != null) params.set('limit', String(opts.limit));
  return `?${params.toString()}`;
}

/**
 * GET one page of the unified metric drill-down (role-scoped server-side). Backs the shared
 * MetricDrilldownSheet across every drillable tile on the analytics dashboards; returns the
 * paginated `items`, a `byElementType` rollup, and the server-wide `total`.
 */
export function fetchAnalyticsDrilldown(
  metric: string,
  opts: { vendorId?: string; page?: number; limit?: number } = {},
): Promise<ApiResponse<AnalyticsDrilldownResult>> {
  return api.get<AnalyticsDrilldownResult>(`/api/analytics/drilldown${drilldownQueryString(metric, opts)}`);
}

/** GET a paginated page of drill-down evidence records. */
export function fetchRecords(filters: {
  stage: AnalyticsStage;
  status?: string;
  vendorId?: string;
  page?: number;
  limit?: number;
}): Promise<ApiResponse<RecordsResult>> {
  return api.get<RecordsResult>(`/api/analytics/records${recordsQueryString(filters)}`);
}
