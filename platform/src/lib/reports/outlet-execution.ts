/* ─── Outlet Execution Report — typed API client ──────────────────────────────
   The admin per-outlet execution report (owner spec 2026-09-30). One row per outlet
   with recce/install/HO/audit status across up to 2 POSM elements.
     - GET /api/reports/outlet-execution        → { columns, rows, total, page, limit }
     - GET /api/reports/outlet-execution.xlsx    → downloadable .xlsx (all matching rows)
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';

export interface OutletReportResult {
  columns: string[];
  rows: Record<string, string>[];
  total: number;
  page: number;
  limit: number;
}

export interface OutletReportFilters {
  siteCode?: string;
  town?: string;
  region?: string;
  state?: string;
  vendorId?: string;
  page?: number;
  limit?: number;
}

function toParams(f: OutletReportFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.siteCode?.trim()) p.set('siteCode', f.siteCode.trim());
  if (f.town?.trim()) p.set('town', f.town.trim());
  if (f.region?.trim()) p.set('region', f.region.trim());
  if (f.state?.trim()) p.set('state', f.state.trim());
  if (f.vendorId) p.set('vendorId', f.vendorId);
  return p;
}

/** Fetch one on-screen page of the report. */
export function fetchOutletReport(f: OutletReportFilters = {}): Promise<ApiResponse<OutletReportResult>> {
  const p = toParams(f);
  p.set('page', String(f.page ?? 1));
  p.set('limit', String(f.limit ?? 50));
  return api.get<OutletReportResult>(`/api/reports/outlet-execution?${p.toString()}`);
}

/**
 * Download the full report as .xlsx. Fetches the auth-gated stream (cookie injected by the /api
 * proxy) into a blob and triggers a browser save. Returns an error string on failure, else null.
 */
export async function downloadOutletReportXlsx(f: OutletReportFilters = {}): Promise<string | null> {
  const p = toParams(f);
  try {
    const res = await fetch(`/api/reports/outlet-execution.xlsx?${p.toString()}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      return res.status === 403
        ? 'You are not allowed to download this report.'
        : `Download failed (${res.status}).`;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `outlet-execution-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has consumed the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return null;
  } catch {
    return 'Could not download the report. Please try again.';
  }
}
