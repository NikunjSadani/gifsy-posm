/**
 * Field-app recce API client + pure workflow helpers.
 *
 * A "recce" is the vendor field user's pre-installation capture at a site (1–2 POSM lines,
 * each a marked photo + dimensions). The backend `GET /v1/recce` list is already vendor-scoped
 * AND submitter-scoped (a VENDOR_FIELD login only ever sees its OWN recces). The workflow is:
 *
 *   SUBMITTED → (ASM) APPROVED → installation   |   SUBMITTED → (ASM) REJECTED → re-capture
 *
 * A REJECTED recce is NOT re-created with a fresh `POST /v1/recce` (that returns 409 — one live
 * recce per site); it is re-captured via `POST /v1/recce/:id/resubmit` with the fresh POSM
 * lines only (site is fixed server-side). This module is the thin typed edge over those routes
 * plus PURE helpers (unit-tested) the My Work + capture screens lean on.
 */

import { api } from '@/lib/api-client';
import type { CapturedReccePosm } from '@/components/field/capture/PosmCaptureCard';
import type { RecceMarkup } from '@/lib/markup';

/** The recce lifecycle status (mirrors the backend `RecceStatus` enum). */
export type RecceStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** The controlled ASM reject-reason vocabulary (mirrors the backend `RejectReasonCode`). */
export type RejectReasonCode =
  | 'BLURRY'
  | 'WRONG_SITE'
  | 'POSM_NOT_VISIBLE'
  | 'GEO_MISMATCH'
  | 'DUPLICATE_PHOTO'
  | 'WRONG_POSM'
  | 'DIMENSIONS_MISMATCH'
  | 'OTHER';

/** The site fields carried on a recce list row. */
export interface RecceSiteLite {
  id: string;
  code: string;
  name: string;
  town: string | null;
}

/** One row of `GET /v1/recce` (the field user's own recces) — the `list()` shape. */
export interface RecceListRow {
  id: string;
  status: RecceStatus;
  version: number;
  site: RecceSiteLite;
  posmCount: number;
  geoFenceOk: boolean | null;
  distanceMeters: number | null;
  capturedAt: string | null;
  receivedAt: string;
  rejectionReasonCode: RejectReasonCode | null;
}

/** The `GET /v1/recce` envelope payload (already unwrapped by the api-client). */
export interface RecceListResult {
  recces: RecceListRow[];
  total: number;
  page: number;
  limit: number;
}

/** A media reference the UI can render (the `present()` MediaRef shape). */
export interface RecceMediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/** One POSM line on a recce detail (the `present()` shape). */
export interface RecceDetailPosm {
  id: string;
  slotNo: number;
  posmType: { id: string; code: string; name: string };
  dimensions: { width?: number; height?: number; unit?: string } | null;
  photo: RecceMediaRef | null;
  markup: unknown;
}

/** `GET /v1/recce/:id` — a single recce with POSM lines, integrity + the rejection reason. */
export interface RecceDetail {
  id: string;
  status: RecceStatus;
  version: number;
  site: { id: string; code: string; name: string; town: string | null; lat: number | null; lng: number | null };
  submittedBy: { id: string; name: string };
  capturedAt: string | null;
  receivedAt: string;
  rejectionReasonCode: RejectReasonCode | null;
  rejectionReason: string | null;
  posms: RecceDetailPosm[];
}

// ── API edge ────────────────────────────────────────────────────────────────

/** Fetch the field user's own recces (optionally filtered by status). */
export function fetchMyRecces(status?: RecceStatus) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return api.get<RecceListResult>(`/api/recce${qs}`);
}

/** Fetch one recce with its POSM lines + rejection reason. */
export function fetchRecce(id: string) {
  return api.get<RecceDetail>(`/api/recce/${encodeURIComponent(id)}`);
}

/**
 * One `posms[]` entry of the recce POST body (create + resubmit). Mirrors the backend
 * `CreateRecceDto`/`ResubmitRecceDto` POSM shape: the required capture fields plus the OPTIONAL
 * `markup` blob (present only when the field user annotated the photo).
 */
export interface ReccePosmBody {
  posmTypeId: string;
  dimensions: { width: number; height: number; unit: string };
  photo: { key: string; geo: CapturedReccePosm['photo']['geo'] };
  markup?: RecceMarkup;
}

/**
 * Map a captured line to its POST-body entry, passing `markup` through only when set (an
 * un-annotated line omits the key entirely rather than sending `undefined`/null).
 */
function toPosmBody(p: CapturedReccePosm): ReccePosmBody {
  return {
    posmTypeId: p.posmTypeId,
    dimensions: p.dimensions,
    photo: p.photo,
    ...(p.markup ? { markup: p.markup } : {}),
  };
}

/** Submit a fresh recce for a site (∅ → SUBMITTED). */
export function submitRecce(siteId: string, posms: CapturedReccePosm[]) {
  return api.post<{ id: string; status: RecceStatus }>('/api/recce', {
    siteId,
    posms: posms.map(toPosmBody),
  });
}

/**
 * Re-capture a REJECTED recce (REJECTED → SUBMITTED, version++). The body carries only the
 * fresh POSM lines — the site is fixed server-side, matching `ResubmitRecceDto`.
 */
export function resubmitRecce(recceId: string, posms: CapturedReccePosm[]) {
  return api.post<{ id: string; status: RecceStatus }>(
    `/api/recce/${encodeURIComponent(recceId)}/resubmit`,
    { posms: posms.map(toPosmBody) },
  );
}

// ── Pure workflow helpers (unit-tested) ───────────────────────────────────────

/**
 * Group order for the My Work list — action-priority first: REJECTED needs the rep to
 * re-capture, APPROVED is ready to install, SUBMITTED is just awaiting review.
 */
export const RECCE_STATUS_ORDER: RecceStatus[] = ['REJECTED', 'APPROVED', 'SUBMITTED'];

/** A non-empty group of recces sharing one status. */
export interface RecceGroup {
  status: RecceStatus;
  recces: RecceListRow[];
}

/**
 * Group recces by status into the action-priority order (REJECTED → APPROVED → SUBMITTED),
 * dropping empty groups and preserving each group's incoming order (the list is already
 * newest-first). Pure — unit-tested.
 */
export function groupRecces(recces: RecceListRow[]): RecceGroup[] {
  return RECCE_STATUS_ORDER
    .map((status) => ({ status, recces: recces.filter((r) => r.status === status) }))
    .filter((g) => g.recces.length > 0);
}

/**
 * The most relevant existing recce for a site (there is at most one live recce per site).
 * Pure — unit-tested. Returns undefined when the site has no recce yet.
 */
export function findSiteRecce(recces: RecceListRow[], siteId: string): RecceListRow | undefined {
  return recces.find((r) => r.site.id === siteId);
}

const REJECT_LABELS: Record<RejectReasonCode, string> = {
  BLURRY: 'Photo was blurry',
  WRONG_SITE: 'Wrong site',
  POSM_NOT_VISIBLE: 'Element not visible in the photo',
  GEO_MISMATCH: 'Location did not match the site',
  DUPLICATE_PHOTO: 'Duplicate photo',
  WRONG_POSM: 'Wrong Element',
  DIMENSIONS_MISMATCH: 'Dimensions did not match',
  OTHER: 'Other',
};

/** A human-friendly label for a reject-reason code (pure — unit-tested). */
export function rejectionLabel(code: RejectReasonCode | null | undefined): string | null {
  if (!code) return null;
  return REJECT_LABELS[code] ?? 'Other';
}
