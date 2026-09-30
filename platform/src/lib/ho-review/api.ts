/* ─── HO/Admin escalation console — typed API client ──────────────────────────
   Wraps the backend HO lane (`/v1/ho-review/*`, via the same-origin `/api/*` proxy).
   HO/Admin reviews installations the Auditor REJECTED (owner decision 2026-09-30):
     - GET  /api/ho-review/installations         → the escalation queue (AUDIT_REJECTED + PENDING)
     - GET  /api/ho-review/installations/:id      → one scoped installation (any ho status)
     - POST /api/ho-review/installations/:id/approve → PENDING → APPROVED (overrides the reject)
     - POST /api/ho-review/installations/:id/reject  → PENDING → REJECTED (terminal, upholds it)

   Reuses the auditor console's CompareRow + presentation helpers (same before/after payload).
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';
import type { CompareRow, RejectReasonCode } from '@/lib/audit/api';

export type HoReviewStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

/** One installation in the HO console — the auditor compare payload + escalation context. */
export interface HoQueueItem {
  id: string;
  status: string; // installation status — stays AUDIT_REJECTED through the HO stage
  hoReviewStatus: HoReviewStatus;
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
  auditedBy: { id: string; name: string } | null;
  hoReviewedBy: { id: string; name: string } | null;
  capturedAt: string | null;
  receivedAt: string;
  auditedAt: string | null;
  hoReviewedAt: string | null;
  /** WHY it escalated — the auditor's controlled reason + optional note. */
  auditRejection: { reasonCode: RejectReasonCode | null; reason: string | null };
  hoRejectionReason: string | null;
  recceGeo: {
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    geoFenceOk: boolean | null;
  };
  compare: CompareRow[];
}

export interface HoQueueResult {
  items: HoQueueItem[];
  total: number;
  page: number;
  limit: number;
}

export interface HoQueueFilters {
  siteCode?: string;
  town?: string;
  page?: number;
  limit?: number;
}

/** Body for the HO reject endpoint — an optional free-text note (HO upholds the audit reason). */
export interface HoRejectBody {
  reason?: string;
}

/** Fetch one page of the HO escalation queue. */
export function fetchHoQueue(filters: HoQueueFilters = {}): Promise<ApiResponse<HoQueueResult>> {
  const params = new URLSearchParams();
  if (filters.siteCode?.trim()) params.set('siteCode', filters.siteCode.trim());
  if (filters.town?.trim()) params.set('town', filters.town.trim());
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 50));
  return api.get<HoQueueResult>(`/api/ho-review/installations?${params.toString()}`);
}

/** Fetch one installation by id for the HO detail view (any ho status; cross-tenant → 404). */
export function fetchHoInstallation(id: string): Promise<ApiResponse<HoQueueItem>> {
  return api.get<HoQueueItem>(`/api/ho-review/installations/${encodeURIComponent(id)}`);
}

/** HO approve — override the audit reject (PENDING → APPROVED). */
export function approveHoInstallation(id: string): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/ho-review/installations/${encodeURIComponent(id)}/approve`, {});
}

/** HO reject — uphold the audit reject (PENDING → REJECTED, terminal). */
export function rejectHoInstallation(id: string, body: HoRejectBody): Promise<ApiResponse<unknown>> {
  return api.post<unknown>(`/api/ho-review/installations/${encodeURIComponent(id)}/reject`, body);
}

/** Human label for the HO decision state. */
export function hoStatusLabel(s: HoReviewStatus): string {
  switch (s) {
    case 'PENDING': return 'Awaiting HO review';
    case 'APPROVED': return 'HO approved (override)';
    case 'REJECTED': return 'HO rejected';
    default: return 'Not escalated';
  }
}
