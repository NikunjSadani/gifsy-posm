/* ─── Outlet Execution ("Recce") Report — typed API client ────────────────────
   The admin per-recce execution report. The backend now returns a CURATED, typed cell
   contract (not raw text columns) so the on-screen table can render inline photo thumbnails,
   colored status chips and GPS pins:
     - GET /api/reports/outlet-execution        → { columns, rows, total, page, limit }
     - GET /api/reports/outlet-execution.xlsx    → downloadable .xlsx (all matching rows, incl.
                                                    excel-only audit-trail columns)
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';

/** The visual tone of a status chip (drives its color). */
export type CellTone = 'approved' | 'pending' | 'rejected' | 'neutral';

/** The column groups, in their canonical left→right display order. `audit` columns are
 *  export-only (see `Column.excelOnly`) — the on-screen table skips them. */
export type ColumnGroup =
  | 'outlet'
  | 'location'
  | 'profile'
  | 'element1'
  | 'element2'
  | 'overall'
  | 'audit';

/** A server-described column. The server owns the full column set, order, grouping, which are
 *  pinned sticky-left, and which are excel-only — the UI never hardcodes columns. */
export interface Column {
  key: string;
  label: string;
  group: ColumnGroup;
  /** Rendered sticky to the left edge so it stays visible while the rest scrolls. */
  pinned?: boolean;
  /** Present only in the .xlsx export (audit-trail approver/date columns) — the on-screen
   *  table omits it to stay uncongested. */
  excelOnly?: boolean;
}

/** A single curated cell. The `t` discriminant picks the renderer. */
export type Cell =
  | { t: 'text'; v: string }
  | { t: 'status'; v: string; tone: CellTone }
  | { t: 'photo'; key: string; viewPath: string; lat?: number; lng?: number }
  | { t: 'empty' };

/** One report row (one recce). `cells` is keyed by `Column.key`. */
export interface Row {
  id: string;
  outletCode: string;
  outletName: string;
  cells: Record<string, Cell>;
}

export interface OutletReportResult {
  columns: Column[];
  rows: Row[];
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
 * Browser `<img src>` for a photo cell's backend view-path. The report streams photos through
 * the auth-gated `/api/media/view` proxy (the session cookie is injected same-origin). The
 * contract hands a proxy-relative path (e.g. `/media/view?key=…`), so the browser URL is
 * `"/api" + viewPath`. Defensive: an already `/api`-prefixed value passes through, a legacy
 * `/v1/…` backend surface is remapped onto `/api/…`, and a bare path still gets an `/api` prefix.
 */
export function reportMediaSrc(viewPath: string): string {
  const p = (viewPath ?? '').trim();
  if (!p) return '';
  if (p.startsWith('/api/')) return p;
  if (p.startsWith('/v1/')) return `/api/${p.slice('/v1/'.length)}`;
  if (p.startsWith('/')) return `/api${p}`;
  return `/api/${p}`;
}

/** Google Maps link for a photo cell's capture location. */
export function gpsMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * An IST (Asia/Kolkata) `YYYY-MM-DD` stamp for the download filename, so it matches the IST dates
 * shown everywhere in the report (NOT UTC `toISOString()`, which rolls a day early for late-evening
 * IST). `en-CA` formats as `YYYY-MM-DD`.
 */
export function istDateStamp(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Download the full report as .xlsx. Fetches the auth-gated stream (cookie injected by the /api
 * proxy) into a blob and triggers a browser save. The export includes every column — pinned,
 * scrollable AND excel-only audit columns. Returns an error string on failure, else null.
 */
export async function downloadOutletReportXlsx(f: OutletReportFilters = {}): Promise<string | null> {
  const p = toParams(f);
  // Pass our own origin so the backend (behind the Next proxy, blind to the public origin) can make
  // the in-sheet photo links ABSOLUTE on this app's `/api` surface — clickable from the opened Excel
  // file in this same logged-in browser. The backend validates it and falls back to a relative link.
  if (typeof window !== 'undefined' && window.location?.origin) {
    p.set('origin', window.location.origin);
  }
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
    a.download = `recce-report-${istDateStamp()}.xlsx`;
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
