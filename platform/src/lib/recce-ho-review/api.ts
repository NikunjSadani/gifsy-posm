/* ─── HO recce-review console — typed API client ──────────────────────────────
   Wraps the backend HO recce lane (`/v1/recce-ho-review/*`, via the same-origin `/api/*`
   proxy). This console is the Head-Office stage AFTER the ASM approves a recce and BEFORE
   installation unlocks — a recce is installable only once BOTH the ASM (status APPROVED)
   and HO (hoReviewStatus APPROVED) have signed off.

     - GET  /api/recce-ho-review/recces            → the queue (ASM-approved, HO PENDING)
     - GET  /api/recce-ho-review/recces/:id        → one scoped recce (any ho status)
     - POST /api/recce-ho-review/recces/:id/approve → PENDING → APPROVED (unlocks install)
     - POST /api/recce-ho-review/recces/:id/reject  → PENDING → REJECTED (sent back to recce)

   Roles CLIENT_ADMIN / GIFSY_ADMIN. NO bulk. Reuses the ASM review console's photo payload
   (`RecceQueueItem.posms` → `PhotoViewer`) and reject-reason vocabulary so the two stages agree.
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';
import {
  REJECT_REASON_LABELS,
  type RecceQueueItem,
  type RejectBody,
  type RejectReasonCode,
} from '@/lib/review/api';

/** The HO decision state on a recce (mirrors the backend enum / the field `hoReviewStatus`). */
export type HoReviewStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

/** How the recce entered the system (mirrors the backend `RecceMode`). */
export type RecceMode = 'APP' | 'MANUAL';

/**
 * One recce in the HO console. It is the ASM review payload (same `posms`/`integrity`/`site`
 * shape the ASM detail renders via `PhotoViewer`) plus the HO decision fields. Used for both the
 * queue rows (which read only the header fields) and the detail view (which renders the photos).
 *
 * Manual recces (`recceMode === 'MANUAL'`) skip ASM and arrive here directly; `outletId` is the
 * finalized Outlet ID (= `site.code`) or `null` while the outlet is still provisional and the HO
 * must assign a real Outlet ID at approval.
 */
export interface HoRecceItem extends RecceQueueItem {
  hoReviewStatus: HoReviewStatus;
  hoRejectionReasonCode: RejectReasonCode | null;
  hoRejectionReason: string | null;
  recceMode: RecceMode;
  outletId: string | null;
}

export interface HoRecceQueueResult {
  items: HoRecceItem[];
  total: number;
  page: number;
  limit: number;
}

export interface HoRecceQueueFilters {
  siteCode?: string;
  town?: string;
  page?: number;
  limit?: number;
}

/** Fetch one page of the HO recce queue (ASM-approved recces awaiting HO review). */
export function fetchHoRecceQueue(
  filters: HoRecceQueueFilters = {},
): Promise<ApiResponse<HoRecceQueueResult>> {
  const params = new URLSearchParams();
  if (filters.siteCode?.trim()) params.set('siteCode', filters.siteCode.trim());
  if (filters.town?.trim()) params.set('town', filters.town.trim());
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 50));
  return api.get<HoRecceQueueResult>(`/api/recce-ho-review/recces?${params.toString()}`);
}

/** Fetch one recce by id for the HO detail view (any ho status; cross-tenant / missing → 404). */
export function fetchHoRecce(id: string): Promise<ApiResponse<HoRecceItem>> {
  return api.get<HoRecceItem>(`/api/recce-ho-review/recces/${encodeURIComponent(id)}`);
}

/** Body for the HO approve — `outletId` finalizes a manual recce's Outlet ID (mandatory there). */
export interface ApproveHoRecceBody {
  /** The Outlet ID to write onto the outlet. Required for a manual recce without a real code. */
  outletId?: string;
}

/**
 * HO approve — the recce clears HO and installation unlocks (PENDING → APPROVED). For a manual
 * recce the body MUST carry a real `outletId` (the backend returns 400 otherwise, and 409 when the
 * Outlet ID collides with a DIFFERENT existing outlet — the message names that outlet). For an app
 * recce the body is empty (unchanged behaviour).
 */
export function approveHoRecce(
  id: string,
  body: ApproveHoRecceBody = {},
): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/recce-ho-review/recces/${encodeURIComponent(id)}/approve`, body);
}

/**
 * HO reject — upheld back to the field for re-capture (PENDING → REJECTED). A controlled reason
 * code is REQUIRED (same vocabulary as the ASM reject); an optional free-text note rides along.
 */
export function rejectHoRecce(id: string, body: RejectBody): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/recce-ho-review/recces/${encodeURIComponent(id)}/reject`, body);
}

/** Human label for the HO decision state. */
export function hoReviewStatusLabel(s: HoReviewStatus): string {
  switch (s) {
    case 'PENDING': return 'Awaiting HO review';
    case 'APPROVED': return 'HO approved';
    case 'REJECTED': return 'HO rejected';
    default: return 'Not in HO review';
  }
}

/** Re-export the shared reject-reason labels so the HO reject dialog uses one vocabulary. */
export { REJECT_REASON_LABELS };
