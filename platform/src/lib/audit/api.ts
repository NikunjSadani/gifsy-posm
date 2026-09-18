/* ─── Auditor console — typed API client ──────────────────────────────────────
   Wraps the backend REVIEW lane (`/v1/audit/*`, reached through the same-origin
   `/api/*` proxy) for the Auditor console. The Auditor is the final QA gate: it
   reviews SUBMITTED installations (the field vendor's "after" photos against the
   approved recce "before" photos) and APPROVES or REJECTS each one.

   Endpoints (all via the `/api` → `/v1` proxy, which injects the caller's bearer):
     - GET  /api/audit/installations                 → the SUBMITTED review queue
     - POST /api/audit/installations/:id/approve     → SUBMITTED → AUDIT_APPROVED
     - POST /api/audit/installations/:id/reject      → SUBMITTED → AUDIT_REJECTED

   NOTE (media): each photo is a MediaRef whose `viewPath` is the backend
   `/v1/media/view?key=…`. The browser renders it via the `/api/media/view?key=…`
   proxy path (see `toApiMediaUrl`). The bytes stream is auth-gated — see the
   console's MediaImage component for the honest load/failure handling.

   NOTE (detail source): the auditor DETAIL view reads one installation by id from
   `GET /api/audit/installations/:id` — the auditor/admin-scoped single-record endpoint
   that returns the same per-POSM compare payload for an installation in ANY status. (The
   `GET /v1/installation/:id` endpoint is `@Roles('VENDOR_FIELD')`-only and would 403 for an
   AUDITOR, so it is not used.) This works for a record past the queue's page cap or one
   already audited — the queue-scan approach could not.
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';

// ── Wire types (mirror the backend AuditReviewService payloads) ───────────────

/** A render-ready media reference as returned by the backend. */
export interface MediaRef {
  key: string;
  /** Backend view path, e.g. `/v1/media/view?key=…`. Render via `toApiMediaUrl`. */
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/** The controlled reject-reason vocabulary (mirrors the Prisma `RejectReasonCode` enum). */
export type RejectReasonCode =
  | 'BLURRY'
  | 'WRONG_SITE'
  | 'POSM_NOT_VISIBLE'
  | 'GEO_MISMATCH'
  | 'DUPLICATE_PHOTO'
  | 'WRONG_POSM'
  | 'DIMENSIONS_MISMATCH'
  | 'OTHER';

/**
 * The soft per-photo integrity signals the backend persists at capture and the auditor
 * reads. All fields are optional / best-effort — treat a missing field as "not flagged".
 */
export interface QualityFlags {
  blur?: boolean;
  blank?: boolean;
  lowLight?: boolean;
  overexposed?: boolean;
  duplicate?: boolean;
  lowAccuracy?: boolean;
  clockSkew?: boolean;
  geoCrossCheck?: boolean;
  siteToRecceMeters?: number | null;
  siteToInstallMeters?: number | null;
  recceToInstallMeters?: number | null;
  [key: string]: unknown;
}

/** One recce-vs-install comparison row — the per-image review unit. */
export interface CompareRow {
  installPosmId: string;
  reccePosmId: string;
  posmType: { id: string; code: string; name: string };
  dimensions: unknown;
  reccePhoto: MediaRef | null;
  installPhoto: MediaRef | null;
  recceMarkup: unknown;
  installGeo: { lat: number | null; lng: number | null };
  /** true = inside fence · false = outside fence · null = not verified. */
  geoFenceOk: boolean | null;
  distanceFromRecce: number | null;
  /** true = differs from recce (ok) · false = identical (blocked at submit) · null = not verifiable. */
  beforeAfterDiffOk: boolean | null;
  qualityFlags: QualityFlags | null;
}

/** One installation awaiting audit, with its full compare payload. */
export interface QueueItem {
  id: string;
  status: string;
  version: number;
  site: {
    id: string;
    code: string;
    name: string;
    town: string | null;
    lat: number | null;
    lng: number | null;
  };
  submittedBy: { id: string; name: string } | null;
  capturedAt: string | null;
  receivedAt: string;
  recceGeo: {
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    geoFenceOk: boolean | null;
  };
  compare: CompareRow[];
}

/** The paginated queue envelope (already unwrapped from `{ success, data }`). */
export interface QueueResult {
  items: QueueItem[];
  total: number;
  page: number;
  limit: number;
}

/** Filters accepted by the queue endpoint. */
export interface QueueFilters {
  siteCode?: string;
  town?: string;
  page?: number;
  limit?: number;
}

/** Body for the reject endpoint. `reasonCode` is required; `reason` is an optional note. */
export interface RejectBody {
  reasonCode: RejectReasonCode;
  reason?: string;
}

// ── Reject-reason presentation ────────────────────────────────────────────────

/** Ordered reason options with human labels for the reject dialog. */
export const REJECT_REASONS: { code: RejectReasonCode; label: string }[] = [
  { code: 'BLURRY', label: 'Blurry / poor-quality photo' },
  { code: 'WRONG_SITE', label: 'Wrong site' },
  { code: 'POSM_NOT_VISIBLE', label: 'POSM not visible' },
  { code: 'GEO_MISMATCH', label: 'Geo-location mismatch' },
  { code: 'DUPLICATE_PHOTO', label: 'Duplicate photo' },
  { code: 'WRONG_POSM', label: 'Wrong POSM' },
  { code: 'DIMENSIONS_MISMATCH', label: 'Dimensions mismatch' },
  { code: 'OTHER', label: 'Other (add a note)' },
];

/** Human label for a reason code (falls back to a title-cased code). */
export function reasonLabel(code: RejectReasonCode): string {
  const found = REJECT_REASONS.find((r) => r.code === code);
  if (found) return found.label;
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Pure presentation helpers (unit-tested) ───────────────────────────────────

export type GeoStatus = 'inside' | 'outside' | 'unverified';

/** Honest geo-fence verdict from the backend's `geoFenceOk` tri-state. */
export function geoStatus(geoFenceOk: boolean | null | undefined): GeoStatus {
  if (geoFenceOk === true) return 'inside';
  if (geoFenceOk === false) return 'outside';
  return 'unverified';
}

/** Truthful geo-status label — never claims "verified" when the backend didn't confirm it. */
export function geoStatusLabel(geoFenceOk: boolean | null | undefined): string {
  switch (geoStatus(geoFenceOk)) {
    case 'inside':
      return 'Inside geo-fence';
    case 'outside':
      return 'Outside geo-fence';
    default:
      return 'Geo not verified';
  }
}

/** Human distance label ("—" when unknown, "12 m", "1.4 km"). */
export function distanceLabel(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/** A coordinate pair rendered as fixed-precision text, or null when incomplete. */
export function formatLatLng(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * Translate a backend media view-path (`/v1/media/view?key=…`) into the browser-facing
 * proxy path (`/api/media/view?key=…`). Any already-`/api`-prefixed or absolute value is
 * returned unchanged.
 */
export function toApiMediaUrl(viewPath: string): string {
  if (!viewPath) return viewPath;
  if (viewPath.startsWith('/api/')) return viewPath;
  if (viewPath.startsWith('/v1/')) return `/api${viewPath.slice(3)}`;
  return viewPath;
}

/** Build the browser media URL for a stored object key. */
export function mediaUrlFromKey(key: string): string {
  return `/api/media/view?key=${encodeURIComponent(key)}`;
}

/** The named soft-flag booleans, in display order, with human labels. */
const FLAG_LABELS: { key: keyof QualityFlags; label: string }[] = [
  { key: 'blur', label: 'Blurry' },
  { key: 'blank', label: 'Blank' },
  { key: 'lowLight', label: 'Low light' },
  { key: 'overexposed', label: 'Overexposed' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'lowAccuracy', label: 'Low GPS accuracy' },
  { key: 'clockSkew', label: 'Clock skew' },
  { key: 'geoCrossCheck', label: 'Geo cross-check' },
];

/** The set of raised soft flags (only the booleans that are strictly `true`). */
export function activeQualityFlags(flags: QualityFlags | null | undefined): string[] {
  if (!flags) return [];
  return FLAG_LABELS.filter((f) => flags[f.key] === true).map((f) => f.label);
}

/** Whether a compare row carries any auditor-relevant warning (flags, outside/unverified geo, no-diff). */
export function hasIntegrityWarning(row: Pick<CompareRow, 'geoFenceOk' | 'beforeAfterDiffOk' | 'qualityFlags'>): boolean {
  if (geoStatus(row.geoFenceOk) !== 'inside') return true;
  if (row.beforeAfterDiffOk !== true) return true;
  return activeQualityFlags(row.qualityFlags).length > 0;
}

// ── Endpoint wrappers ─────────────────────────────────────────────────────────

/** Fetch one page of the SUBMITTED audit queue. */
export function fetchAuditQueue(filters: QueueFilters = {}): Promise<ApiResponse<QueueResult>> {
  const params = new URLSearchParams();
  if (filters.siteCode?.trim()) params.set('siteCode', filters.siteCode.trim());
  if (filters.town?.trim()) params.set('town', filters.town.trim());
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 50));
  return api.get<QueueResult>(`/api/audit/installations?${params.toString()}`);
}

/**
 * Fetch one installation by id for the detail view, via the auditor/admin-scoped
 * `GET /api/audit/installations/:id`. It applies the same tenant scoping as the queue and
 * returns an installation in ANY status, so the detail page works for a record past the
 * queue's page cap or one already audited. A `404` (`success:false`, `status:404`) means the
 * installation doesn't exist or is outside this auditor's tenant scope.
 */
export function fetchInstallation(id: string): Promise<ApiResponse<QueueItem>> {
  return api.get<QueueItem>(`/api/audit/installations/${encodeURIComponent(id)}`);
}

/** Approve an installation (SUBMITTED → AUDIT_APPROVED). */
export function approveInstallation(id: string): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/audit/installations/${encodeURIComponent(id)}/approve`, {});
}

/** Reject an installation (SUBMITTED → AUDIT_REJECTED) with a required reason code. */
export function rejectInstallation(id: string, body: RejectBody): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/audit/installations/${encodeURIComponent(id)}/reject`, body);
}
