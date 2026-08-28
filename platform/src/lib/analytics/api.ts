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

// ─── Domain types (mirror the AnalyticsService response shapes) ────────────────

/** GET /api/analytics/summary */
export interface SummaryWaterfall {
  totalSites: number;
  recced: number;
  approved: number;
  installed: number;
  audited: number;
}

export interface SummaryKpis {
  recceApprovalRatePct: number | null;
  installAuditApprovalRatePct: number | null;
  geoFencePassRatePct: number | null;
  avgTurnaroundDays: number | null;
  pendingRecceReview: number;
  pendingInstallAudit: number;
  rejectedRecce: number;
  rejectedInstall: number;
}

export interface SummaryManual {
  openTasks: number;
  pendingReview: number;
}

export interface AnalyticsSummary {
  waterfall: SummaryWaterfall;
  kpis: SummaryKpis;
  manual: SummaryManual;
}

/** GET /api/analytics/vendor-scorecards */
export interface VendorScorecard {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  sites: number;
  recced: number;
  approved: number;
  installed: number;
  audited: number;
  recceApprovalRatePct: number | null;
  geoFencePassPct: number | null;
  avgTurnaroundDays: number | null;
  rejectedCount: number;
}

export interface VendorScorecardsResult {
  items: VendorScorecard[];
}

/** GET /api/analytics/geo?stage=recce|install */
export type FurthestStage = 'NONE' | 'RECCED' | 'APPROVED' | 'INSTALLED' | 'AUDITED';

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

// ─── Stage presentation (colours + labels) ─────────────────────────────────────

/**
 * Marker / legend colour by the FURTHEST stage a site reached — a practical execution
 * heatmap: grey = untouched, warming through amber/blue/violet to green = fully audited.
 */
export const STAGE_COLORS: Record<FurthestStage, string> = {
  NONE: '#9ca3af', // grey-400
  RECCED: '#f59e0b', // amber-500
  APPROVED: '#3b82f6', // blue-500
  INSTALLED: '#8b5cf6', // violet-500
  AUDITED: '#22c55e', // green-500
};

/** Human labels for the furthest-stage vocabulary (legend + tooltips). */
export const STAGE_LABELS: Record<FurthestStage, string> = {
  NONE: 'Not started',
  RECCED: 'Recced',
  APPROVED: 'Recce approved',
  INSTALLED: 'Installed',
  AUDITED: 'Audited',
};

/** Ordered stages for a stable legend. */
export const STAGE_ORDER: FurthestStage[] = ['NONE', 'RECCED', 'APPROVED', 'INSTALLED', 'AUDITED'];

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
  return (numerator / denominator) * 100;
}

/** Format an average-turnaround value in days. Null / NaN → "—"; otherwise "N.N d". */
export function formatDays(days: number | null | undefined): string {
  if (days == null || Number.isNaN(days)) return '—';
  return `${days.toFixed(1)} d`;
}

// ─── Waterfall funnel math ─────────────────────────────────────────────────────

export type FunnelStageKey = 'totalSites' | 'recced' | 'approved' | 'installed' | 'audited';

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number;
  /** Bar width as a % of the funnel's top (totalSites); null when totalSites is 0. */
  pctOfTotal: number | null;
  /** Conversion % from the immediately-previous stage; null for the first stage / 0 prev. */
  conversionFromPrev: number | null;
  /** Which records to open when this stage is clicked (null = not drillable, e.g. total). */
  drill: { stage: AnalyticsStage; status?: string } | null;
}

/**
 * Turn the summary waterfall counts into an ordered 5-stage funnel with bar widths (share of
 * total sites) and step-to-step conversion percentages. Pure + deterministic so the admin and
 * vendor funnels render identically.
 */
export function buildFunnel(w: SummaryWaterfall): FunnelStage[] {
  const total = w.totalSites;
  const pctOfTotal = (n: number) => conversionPct(n, total);
  return [
    {
      key: 'totalSites',
      label: 'Total sites',
      count: w.totalSites,
      pctOfTotal: total > 0 ? 100 : null,
      conversionFromPrev: null,
      drill: null,
    },
    {
      key: 'recced',
      label: 'Recced',
      count: w.recced,
      pctOfTotal: pctOfTotal(w.recced),
      conversionFromPrev: conversionPct(w.recced, w.totalSites),
      drill: { stage: 'recce' },
    },
    {
      key: 'approved',
      label: 'Recce approved',
      count: w.approved,
      pctOfTotal: pctOfTotal(w.approved),
      conversionFromPrev: conversionPct(w.approved, w.recced),
      drill: { stage: 'recce', status: 'APPROVED' },
    },
    {
      key: 'installed',
      label: 'Installed',
      count: w.installed,
      pctOfTotal: pctOfTotal(w.installed),
      conversionFromPrev: conversionPct(w.installed, w.approved),
      drill: { stage: 'install' },
    },
    {
      key: 'audited',
      label: 'Audited',
      count: w.audited,
      pctOfTotal: pctOfTotal(w.audited),
      conversionFromPrev: conversionPct(w.audited, w.installed),
      drill: { stage: 'install', status: 'AUDITED' },
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
 * An optional stage narrows the export when the backend supports it.
 */
export function exportUrl(params: { stage?: AnalyticsStage } = {}): string {
  const qs = new URLSearchParams();
  if (params.stage) qs.set('stage', params.stage);
  const s = qs.toString();
  return s ? `/api/analytics/export?${s}` : '/api/analytics/export';
}

/**
 * Serialise records-drilldown filters to a query string (leading `?` when non-empty).
 * Blank status is dropped; page 0 is preserved (not treated as absent).
 */
export function recordsQueryString(filters: {
  stage: AnalyticsStage;
  status?: string;
  page?: number;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set('stage', filters.stage);
  const status = filters.status?.trim();
  if (status) params.set('status', status);
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

/** GET a paginated page of drill-down evidence records. */
export function fetchRecords(filters: {
  stage: AnalyticsStage;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<ApiResponse<RecordsResult>> {
  return api.get<RecordsResult>(`/api/analytics/records${recordsQueryString(filters)}`);
}
