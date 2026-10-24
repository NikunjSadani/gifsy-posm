/* ─── ASM Review console — typed API client + pure helpers ────────────────────
   Thin wrappers over the backend approval endpoints, called through the same-origin
   `/api/*` proxy (which maps to the backend `/v1/*` and injects the bearer cookie).

   The ASM (Area Sales Manager) reviews field-vendor RECCE submissions and approves or
   rejects them. Every function returns the api-client `ApiResponse<T>` so callers branch
   on `.success`. Pure helpers (query-string building, media URLs, integrity flags, queue
   summarising) live here too and are unit-tested — no React, no fetch.

   Endpoints (backend `/v1/approval/*`, reached as `/api/approval/*`):
     GET  /api/approval/recces            — the SUBMITTED review queue (scoped to this ASM)
     GET  /api/approval/waterfall         — the stage-funnel counts
     POST /api/approval/recces/:id/approve
     POST /api/approval/recces/:id/reject       (body: { reasonCode, reason? })
     POST /api/approval/recces/bulk-approve     (body: { ids: string[] })
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';
import type { RecceMarkup } from '@/lib/markup';

// ─── Domain types (mirror ApprovalService response shapes) ─────────────────────

/** A render-ready media reference: raw object key + backend view-path + optional geo. */
export interface MediaRef {
  key: string;
  /** Backend-relative path (`/v1/media/view?key=…`). Use `mediaSrc(key)` for the browser URL. */
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

export interface RecceSite {
  id: string;
  code: string;
  name: string;
  town: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RecceIntegrity {
  geoFenceOk: boolean | null;
  distanceMeters: number | null;
  captureAccuracy: number | null;
  captureLat: number | null;
  captureLng: number | null;
  duplicatePhoto: boolean;
}

/**
 * Advisory per-POSM photo-quality signals the backend computes at recce submit (mirrors the
 * auditor's install flags). Purely informational for the ASM — they do NOT block approve/reject.
 * `null` when the recce predates the feature (older submissions have no stored flags).
 */
export interface ReccePosmQualityFlags {
  blur: boolean;
  blank: boolean;
  lowLight: boolean;
  overexposed: boolean;
  lowAccuracy: boolean;
}

export interface ReccePosm {
  id: string;
  slotNo: number;
  posmType: { id: string; code: string; name: string } | null;
  /**
   * Raw stored dimensions — the backend returns whatever was captured, which is a JSON
   * object `{ width, height, unit }` (not a string). Typed `unknown` so callers must go
   * through `dimensionsLabel()` and never render the object as a React child.
   */
  dimensions: unknown;
  photo: MediaRef | null;
  /**
   * Raw stored recce markup (WHERE the install is proposed) or null. Declared as the parsed
   * shape for documentation, but the value is UNVALIDATED off the wire — always render it via
   * `<MarkupOverlay>`, whose `parseMarkup` is the single validation point (a legacy/garbage
   * value degrades to no overlay rather than a crash). Never trust the fields without parsing.
   */
  markup: RecceMarkup | null;
  /** Advisory per-photo quality flags (blur/dark/too-bright/weak-GPS); `null` for legacy recces. */
  qualityFlags: ReccePosmQualityFlags | null;
}

export interface RecceQueueItem {
  id: string;
  status: string;
  version: number;
  site: RecceSite;
  submittedBy: { id: string; name: string } | null;
  capturedAt: string | null;
  receivedAt: string | null;
  integrity: RecceIntegrity;
  posms: ReccePosm[];
}

export interface QueueResult {
  items: RecceQueueItem[];
  total: number;
  page: number;
  limit: number;
}

export interface Waterfall {
  totalSites: number;
  recced: number;
  /** ASM-approved: status APPROVED, regardless of the HO review stage. */
  approved: number;
  /** HO-approved / installable: status APPROVED && hoReviewStatus APPROVED (subset of `approved`). */
  hoApproved: number;
  /** HO-approved but not yet installed — the "waiting for the installer" bucket. */
  pendingInstall: number;
  installed: number;
  audited: number;
  /** Distinct outlets with ≥1 recce / ≥1 installation — the base for the coverage % tiles
   *  (recced/installed count rows, which can exceed the outlet count, so they can't drive a %). */
  sitesRecced: number;
  sitesInstalled: number;
}

/**
 * One row of the per-stage records drill-down: an outlet that reached that stage. `recceId` is
 * the recce that carries the evidence (null when the stage isn't recce-backed — e.g. an outlet
 * with no recce yet), and is what the UI uses to deep-link into the recce detail view.
 */
export interface ApprovalRecord {
  id: string;
  outletCode: string;
  outletName: string;
  town: string | null;
  recceId: string | null;
  status: string | null;
  // ── Phase E enrichment (shared with the analytics drill-down) ──
  /** Recce / installation capture time (ISO); null for the outlet universe. */
  recceDate: string | null;
  /** Fleet vendor name; null when the outlet carries no vendor. */
  vendorName: string | null;
  /** Element type name(s) summary, e.g. "Glow Sign Board, Banner (+2)"; null when no elements. */
  elementSummary: string | null;
  /** Element W×H dimension(s) summary, e.g. "4 × 3 ft"; null when none. */
  dimensions: string | null;
  /** Human lifecycle label (Not started / Submitted / ASM approved / HO approved / Rejected / …). */
  statusLabel: string | null;
}

/**
 * Per-element-type rollup for a records drill-down (e.g. "GSB × 5"). Summarises WHICH elements
 * the stage's outlets carry, surfaced above the outlet list in the drill-down sheet.
 */
export interface ElementTypeBreakdown {
  code: string;
  name: string;
  count: number;
}

export interface RecordsResult {
  items: ApprovalRecord[];
  byElementType: ElementTypeBreakdown[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkApproveResult {
  approvedCount: number;
  approvedIds: string[];
  skipped: { id: string; reason: string }[];
}

export interface QueueFilters {
  siteCode?: string;
  town?: string;
  page?: number;
  limit?: number;
}

// ─── Reject reason vocabulary (mirrors the Prisma RejectReasonCode enum) ───────

export const REJECT_REASON_CODES = [
  'BLURRY',
  'WRONG_SITE',
  'POSM_NOT_VISIBLE',
  'GEO_MISMATCH',
  'DUPLICATE_PHOTO',
  'WRONG_POSM',
  'DIMENSIONS_MISMATCH',
  'OTHER',
] as const;

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

/** Human labels for the controlled reject-reason vocabulary. */
export const REJECT_REASON_LABELS: Record<RejectReasonCode, string> = {
  BLURRY: 'Blurry / unclear photo',
  WRONG_SITE: 'Wrong outlet',
  POSM_NOT_VISIBLE: 'Element not visible',
  GEO_MISMATCH: 'Location mismatch',
  DUPLICATE_PHOTO: 'Duplicate photo',
  WRONG_POSM: 'Wrong Element',
  DIMENSIONS_MISMATCH: 'Dimensions mismatch',
  OTHER: 'Other',
};

export interface RejectBody {
  reasonCode: RejectReasonCode;
  reason?: string;
}

// ─── Pure helpers (unit-tested; no fetch / no React) ───────────────────────────

/**
 * Browser `<img src>` for a stored media key. The backend view-path is `/v1/media/view`;
 * the same-origin proxy exposes it at `/api/media/view` (and injects the auth cookie), so
 * a raw object key becomes a directly-renderable, auth-gated URL.
 */
export function mediaSrc(key: string): string {
  return `/api/media/view?key=${encodeURIComponent(key)}`;
}

/**
 * Best-effort human label for a recce POSM's stored dimensions. The backend stores this as a
 * JSON object `{ width, height, unit }` (a string is also tolerated for legacy rows), so this
 * MUST be used before rendering — passing the raw object into JSX crashes React with
 * "Objects are not valid as a React child". Returns `null` when there's nothing renderable.
 */
export function dimensionsLabel(dimensions: unknown): string | null {
  if (!dimensions) return null;
  if (typeof dimensions === 'string') return dimensions.trim() || null;
  if (typeof dimensions === 'object') {
    const d = dimensions as Record<string, unknown>;
    const w = d.width ?? d.w;
    const h = d.height ?? d.h;
    if (w != null && h != null) {
      const unit = typeof d.unit === 'string' ? ` ${d.unit}` : '';
      return `${String(w)} × ${String(h)}${unit}`;
    }
  }
  return null;
}

/**
 * Honest header sub-label for the page-scoped flagged count. `summarizeQueue` only sees the
 * CURRENT page, so the label must say so — never imply it's the server-wide flagged total.
 * Returns `null` when nothing on the page is flagged.
 */
export function flaggedOnPageLabel(flagged: number): string | null {
  if (flagged <= 0) return null;
  return `${flagged} flagged on this page`;
}

/**
 * Serialise queue filters to a query string (leading `?` when non-empty). Blank/whitespace
 * strings are dropped so an empty filter box never narrows the query. Deterministic key
 * order keeps it testable.
 */
export function queueQueryString(filters: QueueFilters = {}): string {
  const params = new URLSearchParams();
  const siteCode = filters.siteCode?.trim();
  const town = filters.town?.trim();
  if (siteCode) params.set('siteCode', siteCode);
  if (town) params.set('town', town);
  if (filters.page != null) params.set('page', String(filters.page));
  if (filters.limit != null) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Human-readable integrity warnings for a recce, worst-first, for the reviewer to eyeball.
 * Empty array = no flags raised. Kept pure so the queue and detail views agree.
 */
export function recceFlags(item: RecceQueueItem): string[] {
  const flags: string[] = [];
  const ig = item.integrity;
  if (ig.geoFenceOk === false) {
    flags.push(
      ig.distanceMeters != null
        ? `Outside geo-fence (${Math.round(ig.distanceMeters)} m away)`
        : 'Outside geo-fence',
    );
  }
  if (ig.duplicatePhoto) flags.push('Duplicate photo detected');
  if (ig.captureAccuracy != null && ig.captureAccuracy > 100) {
    flags.push(`Low GPS accuracy (±${Math.round(ig.captureAccuracy)} m)`);
  }
  return flags;
}

/**
 * The named per-POSM quality-flag booleans, in display order, with the ASM's plain-language
 * labels (blur→"Blurry", lowLight→"Dark", overexposed→"Too bright", lowAccuracy→"Weak GPS").
 * Mirrors the auditor console's `activeQualityFlags` pattern (see `@/lib/audit/api`); the ASM
 * copy is intentionally plainer/field-friendly.
 */
const POSM_QUALITY_FLAG_LABELS: { key: keyof ReccePosmQualityFlags; label: string }[] = [
  { key: 'blank', label: 'Blank' },
  { key: 'blur', label: 'Blurry' },
  { key: 'lowLight', label: 'Dark' },
  { key: 'overexposed', label: 'Too bright' },
  { key: 'lowAccuracy', label: 'Weak GPS' },
];

/**
 * The raised advisory quality flags for one POSM photo, as display labels (only the booleans
 * strictly `true`). Empty array when nothing is flagged or the flags are `null` (legacy recce).
 * Pure — unit-tested.
 */
export function posmQualityFlags(flags: ReccePosmQualityFlags | null | undefined): string[] {
  if (!flags) return [];
  return POSM_QUALITY_FLAG_LABELS.filter((f) => flags[f.key] === true).map((f) => f.label);
}

/** How many POSM photos a recce carries (some slots may have no photo). */
export function photoCount(item: RecceQueueItem): number {
  return item.posms.filter((p) => p.photo != null).length;
}

export interface QueueSummary {
  total: number;
  flagged: number;
  towns: number;
}

/**
 * Roll a queue page into headline counts for the reviewer: how many recces, how many carry
 * at least one integrity flag, and how many distinct towns are represented.
 */
export function summarizeQueue(items: RecceQueueItem[]): QueueSummary {
  const towns = new Set<string>();
  let flagged = 0;
  for (const it of items) {
    if (recceFlags(it).length > 0) flagged += 1;
    if (it.site.town) towns.add(it.site.town.toLowerCase());
  }
  return { total: items.length, flagged, towns: towns.size };
}

// ─── Network calls ─────────────────────────────────────────────────────────────

/** GET the SUBMITTED review queue for this ASM (scoped server-side). */
export function fetchQueue(filters: QueueFilters = {}): Promise<ApiResponse<QueueResult>> {
  return api.get<QueueResult>(`/api/approval/recces${queueQueryString(filters)}`);
}

/** GET the stage-funnel counts scoped to the caller. */
export function fetchWaterfall(): Promise<ApiResponse<Waterfall>> {
  return api.get<Waterfall>('/api/approval/waterfall');
}

/**
 * The records-drill-down stages. `outlets` is the full outlet set; the rest mirror the funnel
 * tiles. Kept as a widened `string` on the public `fetchRecords` signature (the backend is the
 * authority on valid stages), but documented here for the dashboard call sites.
 */
export type RecordsStage =
  | 'outlets'
  | 'recce'
  | 'asm-approved'
  | 'ho-approved'
  | 'pending-install'
  | 'installed';

/** Serialise the records query (`stage` is always present; page/limit optional). */
function recordsQueryString(stage: string, opts: { limit?: number; page?: number } = {}): string {
  const params = new URLSearchParams();
  params.set('stage', stage);
  if (opts.page != null) params.set('page', String(opts.page));
  if (opts.limit != null) params.set('limit', String(opts.limit));
  return `?${params.toString()}`;
}

/**
 * Same-origin .xlsx export URL for one records stage's FULL (uncapped) enriched set. Rendered as an
 * `<a href download>` so the edge proxy injects auth and the browser streams the attachment — never
 * fetched with a manual bearer header. Mirrors the analytics `drilldownExportUrl`.
 */
export function recordsExportUrl(stage: string): string {
  return `/api/approval/records.xlsx?stage=${encodeURIComponent(stage)}`;
}

/**
 * GET the outlet records behind a funnel stage, scoped to the caller. Backs the metric
 * drill-down sheet; returns the paginated `items`, a `byElementType` rollup, and the server-wide
 * `total` (so pagination stays correct — never a client-side single-page narrowing).
 */
export function fetchRecords(
  stage: string,
  opts: { limit?: number; page?: number } = {},
): Promise<ApiResponse<RecordsResult>> {
  return api.get<RecordsResult>(`/api/approval/records${recordsQueryString(stage, opts)}`);
}

/**
 * GET one scoped recce by id for the detail view. Backed by `/v1/approval/recces/:id`, which
 * applies the same tenant + ASM-territory scoping as the queue and returns a recce in ANY
 * status — so the detail page opens a recce past the queue's page cap or already reviewed
 * (an out-of-scope / missing id resolves as `success:false` with status 404).
 */
export function fetchRecce(id: string): Promise<ApiResponse<RecceQueueItem>> {
  return api.get<RecceQueueItem>(`/api/approval/recces/${encodeURIComponent(id)}`);
}

/** POST approve a single recce (SUBMITTED → APPROVED). */
export function approveRecce(id: string): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/approval/recces/${encodeURIComponent(id)}/approve`, {});
}

/** POST reject a single recce with a required reason code (+ optional note). */
export function rejectRecce(id: string, body: RejectBody): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/approval/recces/${encodeURIComponent(id)}/reject`, body);
}

/** POST bulk-approve many recces by id (out-of-scope / non-SUBMITTED ids are skipped server-side). */
export function bulkApproveRecces(ids: string[]): Promise<ApiResponse<BulkApproveResult>> {
  return api.post<BulkApproveResult>('/api/approval/recces/bulk-approve', { ids });
}
