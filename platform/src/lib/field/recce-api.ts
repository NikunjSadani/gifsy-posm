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

/**
 * How a recce entered the system (mirrors the backend `RecceMode` enum). `APP` = the in-app
 * recce captured against a master outlet (ASM → HO); `MANUAL` = a field-typed outlet that goes
 * straight to HO. Every legacy row is backfilled to `APP`.
 */
export type RecceMode = 'APP' | 'MANUAL';

/**
 * The Head-Office review decision on an ASM-approved recce (mirrors the backend enum). A recce is
 * only installable once the ASM has approved it (`status==='APPROVED'`) AND HO has too
 * (`hoReviewStatus==='APPROVED'`). 'NONE' = not yet at the HO stage; 'PENDING' = ASM-approved,
 * awaiting HO; 'REJECTED' pairs with `status==='REJECTED'` to mean HO sent it back.
 */
export type HoReviewStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

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
  /** How this recce entered the system — an APP recce runs ASM→HO; a MANUAL recce goes straight to HO. */
  recceMode: RecceMode;
  /** The HO review decision — distinguishes 'ready to install' (APPROVED) from 'awaiting HO' (PENDING). */
  hoReviewStatus: HoReviewStatus;
  version: number;
  site: RecceSiteLite;
  posmCount: number;
  geoFenceOk: boolean | null;
  distanceMeters: number | null;
  capturedAt: string | null;
  receivedAt: string;
  rejectionReasonCode: RejectReasonCode | null;
  /** HO's rejection reason — set only when HO sent the recce back (hoReviewStatus === 'REJECTED'). */
  hoRejectionReasonCode: RejectReasonCode | null;
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
  /** The HO review decision on this recce (NONE | PENDING | APPROVED | REJECTED). */
  hoReviewStatus: HoReviewStatus;
  version: number;
  site: { id: string; code: string; name: string; town: string | null; lat: number | null; lng: number | null };
  submittedBy: { id: string; name: string };
  capturedAt: string | null;
  receivedAt: string;
  rejectionReasonCode: RejectReasonCode | null;
  rejectionReason: string | null;
  /** HO's rejection reason when HO sent the recce back (status REJECTED && hoReviewStatus REJECTED). */
  hoRejectionReasonCode: RejectReasonCode | null;
  hoRejectionReason: string | null;
  posms: RecceDetailPosm[];
}

// ── API edge ────────────────────────────────────────────────────────────────

/** Optional filters for the field user's own recce list. */
export interface MyReccesFilters {
  status?: RecceStatus;
  /** Filter-first field screen: EXACT RS code + Beat (there is no beatId). */
  rsCode?: string;
  beatName?: string;
  /**
   * Restrict to one entry mode. MANUAL recces carry a null RS/Beat (a provisional outlet), so the
   * exec fetches them with `recceMode: 'MANUAL'` INDEPENDENT of the RS/Beat gate — otherwise their
   * own manual submissions (including a rejected one they must re-capture) would never show.
   */
  recceMode?: RecceMode;
  limit?: number;
}

/** Fetch the field user's own recces (optionally filtered by status / RS code / beat / mode). */
export function fetchMyRecces(filters: MyReccesFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.rsCode) params.set('rsCode', filters.rsCode);
  if (filters.beatName) params.set('beatName', filters.beatName);
  if (filters.recceMode) params.set('recceMode', filters.recceMode);
  // Match the sites screen's page size (backend max is 200) so a rep's work in a beat isn't
  // silently truncated at the default of 50.
  params.set('limit', String(filters.limit ?? 200));
  const qs = params.toString();
  return api.get<RecceListResult>(`/api/recce${qs ? `?${qs}` : ''}`);
}

/** Fetch one recce with its POSM lines + rejection reason. */
export function fetchRecce(id: string) {
  return api.get<RecceDetail>(`/api/recce/${encodeURIComponent(id)}`);
}

/**
 * One `posms[]` entry of the recce POST body (create + resubmit). Mirrors the backend
 * `CreateRecceDto`/`ResubmitRecceDto` POSM shape: the required capture fields plus the REQUIRED
 * `markup` blob (marking the recce photo is compulsory — every line carries ≥1 shape).
 */
export interface ReccePosmBody {
  posmTypeId: string;
  dimensions: { width: number; height: number; unit: string };
  photo: { key: string; geo: CapturedReccePosm['photo']['geo'] };
  markup: RecceMarkup;
}

/** Map a captured line to its POST-body entry. Marking is compulsory, so every line carries markup. */
function toPosmBody(p: CapturedReccePosm): ReccePosmBody {
  return {
    posmTypeId: p.posmTypeId,
    dimensions: p.dimensions,
    photo: p.photo,
    markup: p.markup,
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

/**
 * The manual-recce submit body (mirrors the backend `POST /v1/recce/manual` contract). Only
 * `outletName` is required; `outletId`/address/phone are optional. When `outletId` matches an
 * existing outlet the backend ATTACHES this recce to it (no duplicate outlet); otherwise a
 * provisional outlet is created and the real Outlet ID is finalized by HO at approval.
 */
export interface ManualRecceInput {
  /** Optional Outlet ID — when it matches an existing outlet the recce attaches to it. */
  outletId?: string;
  /** REQUIRED outlet name (backend returns 400 if blank). */
  outletName: string;
  outletAddress?: string;
  outletPhone?: string;
  posms: CapturedReccePosm[];
}

/**
 * Submit a field-typed MANUAL recce. The outlet is provisioned-or-attached server-side; the
 * recce lands as `recceMode=MANUAL, status=SUBMITTED, hoReviewStatus=PENDING` and goes straight
 * to HO (no ASM). Optional fields are omitted from the body when blank so the backend sees a
 * clean payload. Returns the created recce id/status (+ `recceMode`).
 */
export function submitManualRecce(input: ManualRecceInput) {
  const body: Record<string, unknown> = {
    outletName: input.outletName.trim(),
    posms: input.posms.map(toPosmBody),
  };
  const outletId = input.outletId?.trim();
  const outletAddress = input.outletAddress?.trim();
  const outletPhone = input.outletPhone?.trim();
  if (outletId) body.outletId = outletId;
  if (outletAddress) body.outletAddress = outletAddress;
  if (outletPhone) body.outletPhone = outletPhone;
  return api.post<{ id: string; status: RecceStatus; recceMode?: RecceMode }>('/api/recce/manual', body);
}

// ── Pure workflow helpers (unit-tested) ───────────────────────────────────────

/**
 * The My Work group keys. A recce's lifecycle now has a Head-Office stage between ASM approval
 * and installation, so APPROVED splits in two: only an HO-approved recce is 'Ready to install';
 * an ASM-approved one still awaiting HO is read-only 'Awaiting HO approval'.
 *
 *   NEEDS_RECAPTURE   ← status REJECTED (ASM or HO sent it back)              — rep re-captures
 *   READY_TO_INSTALL  ← status APPROVED && hoReviewStatus APPROVED            — rep can start install
 *   AWAITING_HO       ← status APPROVED && hoReviewStatus !== APPROVED, OR    — read-only
 *                       a SUBMITTED MANUAL recce (no ASM stage — straight to HO)
 *   AWAITING_ASM      ← status SUBMITTED on an APP recce                      — read-only
 */
export type RecceGroupKey = 'NEEDS_RECAPTURE' | 'READY_TO_INSTALL' | 'AWAITING_HO' | 'AWAITING_ASM';

/**
 * Group order for the My Work list — action-priority first: re-capture needs the rep, then
 * ready-to-install is actionable, then the two read-only waiting states (HO before ASM, since an
 * awaiting-HO recce is further along).
 */
export const RECCE_GROUP_ORDER: RecceGroupKey[] = [
  'NEEDS_RECAPTURE',
  'READY_TO_INSTALL',
  'AWAITING_HO',
  'AWAITING_ASM',
];

/** Short labels for each group (the My Work section headings). */
export const RECCE_GROUP_LABELS: Record<RecceGroupKey, string> = {
  NEEDS_RECAPTURE: 'Needs re-capture',
  READY_TO_INSTALL: 'Ready to install',
  AWAITING_HO: 'Awaiting HO approval',
  AWAITING_ASM: 'Awaiting ASM approval',
};

/** A non-empty group of recces sharing one work-group key. */
export interface RecceGroup {
  key: RecceGroupKey;
  recces: RecceListRow[];
}

/**
 * Classify a single recce into its My Work group. A recce is 'Ready to install' ONLY when BOTH
 * the ASM (status APPROVED) and HO (hoReviewStatus APPROVED) have signed off; an ASM-approved
 * recce whose HO decision is anything else (PENDING / NONE) is still 'Awaiting HO approval' and
 * must NOT offer the install action. A SUBMITTED recce is still 'Awaiting ASM' on the APP path,
 * but a MANUAL recce skips ASM entirely (D4) and is 'Awaiting Head-Office' from submit. A REJECTED
 * recce (ASM or HO sent it back, APP or MANUAL alike) needs re-capture. Pure — unit-tested.
 */
export function classifyRecce(
  r: Pick<RecceListRow, 'status' | 'hoReviewStatus' | 'recceMode'>,
): RecceGroupKey {
  if (r.status === 'REJECTED') return 'NEEDS_RECAPTURE';
  if (r.status === 'APPROVED') {
    return r.hoReviewStatus === 'APPROVED' ? 'READY_TO_INSTALL' : 'AWAITING_HO';
  }
  // SUBMITTED: a manual recce has no ASM stage — it waits on Head-Office, not the ASM.
  return r.recceMode === 'MANUAL' ? 'AWAITING_HO' : 'AWAITING_ASM';
}

/**
 * Group recces into the action-priority order, dropping empty groups and preserving each group's
 * incoming order (the list is already newest-first). Pure — unit-tested.
 */
export function groupRecces(recces: RecceListRow[]): RecceGroup[] {
  return RECCE_GROUP_ORDER
    .map((key) => ({ key, recces: recces.filter((r) => classifyRecce(r) === key) }))
    .filter((g) => g.recces.length > 0);
}

/**
 * The most relevant existing recce for a site (there is at most one live recce per site).
 * Pure — unit-tested. Returns undefined when the site has no recce yet.
 *
 * NOTE: valid only for the APP path (one app recce per outlet). A manual outlet can carry several
 * recces, so install selection groups by outlet via `groupInstallableByOutlet` instead.
 */
export function findSiteRecce(recces: RecceListRow[], siteId: string): RecceListRow | undefined {
  return recces.find((r) => r.site.id === siteId);
}

/** An outlet and its ready-to-install recces, for the install picker entry on My Work. */
export interface InstallableOutlet {
  site: RecceSiteLite;
  recces: RecceListRow[];
}

/**
 * Collapse a flat list of ready-to-install recces into one entry PER OUTLET, preserving first-seen
 * order (the list is newest-first). An outlet with a single installable recce links straight to
 * that recce's install capture (unchanged app behaviour); an outlet with several (only possible
 * for manual recces) routes to the recce picker so the exec chooses which to install. Pure —
 * unit-tested.
 */
export function groupInstallableByOutlet(recces: RecceListRow[]): InstallableOutlet[] {
  const order: string[] = [];
  const bySite = new Map<string, InstallableOutlet>();
  for (const r of recces) {
    const existing = bySite.get(r.site.id);
    if (existing) {
      existing.recces.push(r);
    } else {
      order.push(r.site.id);
      bySite.set(r.site.id, { site: r.site, recces: [r] });
    }
  }
  return order.map((id) => bySite.get(id)!);
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
