'use client';

/**
 * Recce Report screen — the SHARED, role-agnostic report surface, rendered by BOTH the admin
 * (`/admin/execution-report`) and the vendor (`/vendor/execution-report`) routes. ALL scoping is
 * SERVER-SIDE (the backend tenant-scopes an admin and additionally fleet-confines a VENDOR_HO to
 * their own outlets on every endpoint), so this component is identical for both callers — the only
 * caller-specific knob is `showVendorFilter`, a presentational choice (a single-fleet vendor has no
 * vendor to pick, and the vendors-master list is admin-only), never a scoping one.
 *
 * A scannable per-recce report rendered from a SERVER-DRIVEN typed cell contract (not raw text
 * columns). Each row is one recce; the server hands the columns (key/label/group, which are pinned
 * sticky-left, which are excel-only) and per-cell typed values (text / colored status chip / inline
 * photo thumbnail with a GPS pin / empty). The on-screen table SKIPS excel-only columns (audit-trail
 * approver/date columns live only in the .xlsx). A grouped two-row header spans each group; the
 * outlet identity columns are pinned sticky-left and the rest scroll horizontally. Filters (outlet
 * code, town, region, state, and — admin only — vendor) and the "Download .xlsx" / "Export PPT"
 * exports (all columns, all matching rows, the caller's own scope) are role-agnostic.
 *
 * A `mode` toggle ('recce' | 'installed') switches the server-driven column set + the before/after
 * PPT variant.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Download, ChevronLeft, ChevronRight, FileSpreadsheet, Presentation } from 'lucide-react';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/spinner';
import { Lightbox } from '@/components/audit/media-image';
import { ReportCell } from '@/components/reports/report-cell';
import { pageCount } from '@/components/audit/pagination';
import { vendorsApi } from '@/lib/admin/api';
import type { Vendor } from '@/lib/admin/types';
import { cn } from '@/lib/utils';
import {
  fetchOutletReport,
  downloadOutletReportXlsx,
  downloadOutletReportPptx,
  PPTX_MAX_OUTLETS,
  type OutletReportResult,
  type OutletReportFilters,
  type ReportMode,
} from '@/lib/reports/outlet-execution';
import { groupOutletColumns, flatColumns } from '@/lib/reports/outlet-columns';

const PAGE_SIZE = 50;

/** Width (px) of the leading selection (checkbox) column; the pinned columns sit to its right. */
const SELECT_COL_W = 44;

/** Pixel widths for the sticky-left pinned columns, by pin index; a further pinned column (none
 *  today) falls back to the last width. The sticky `left` offset is the sum of earlier widths.
 *  Two sets: the desktop widths, and a NARROWER mobile set so the 2 pinned columns don't eat a
 *  ~375px PWA phone (336px pinned → 224px, leaving room for the scrollable groups). The sticky
 *  offsets are derived from whichever set is active, so they stay correct at either width. */
const PIN_WIDTHS_DESKTOP = [128, 208];
const PIN_WIDTHS_MOBILE = [96, 128];
const pinWidth = (widths: number[], i: number) => widths[i] ?? widths[widths.length - 1] ?? 160;
// Pinned columns sit to the RIGHT of the leading selection column, so every sticky `left` offset is
// measured from after the checkbox column.
const pinLeft = (widths: number[], i: number) => {
  let left = SELECT_COL_W;
  for (let j = 0; j < i; j++) left += pinWidth(widths, j);
  return left;
};

/** Tracks whether the viewport is below the `sm` breakpoint (640px) so the pinned columns can shrink
 *  on a phone. SSR-safe: starts `false` (desktop widths) on both server and first client render to
 *  avoid a hydration mismatch, then syncs to the real viewport after mount. */
function useIsSmallViewport(): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setSmall(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return small;
}

const MODE_TITLES: Record<ReportMode, string> = {
  recce: 'Recce Report',
  installed: 'Installation Report',
};
const MODE_SUBTITLES: Record<ReportMode, string> = {
  recce:
    'One row per recce (an outlet can have more than one) — recce evidence, element status and approvals at a glance.',
  installed:
    'One row per installation — recce vs installed evidence, element + install status, audit and before↔after geo at a glance.',
};

/**
 * @param showVendorFilter When true (admin default), render the vendor filter dropdown (backed by
 * the admin-only vendors-master list). A VENDOR_HO passes false: they are a single fleet, so there
 * is nothing to pick, and the vendors-master endpoint is admin-only — but this is purely cosmetic:
 * the server confines a vendor to their own fleet regardless of any filter.
 */
export function RecceReportScreen({ showVendorFilter = true }: { showVendorFilter?: boolean }) {
  const [siteCode, setSiteCode] = useState('');
  const [town, setTown] = useState('');
  const [region, setRegion] = useState('');
  const [stateF, setStateF] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [page, setPage] = useState(1);

  // Recce | Installed report variant. Switching refetches with `mode` and re-renders the server-driven
  // columns (the installed variant adds the install group + the before/after PPT).
  const [mode, setMode] = useState<ReportMode>('recce');

  // Pinned-column widths shrink below the `sm` breakpoint so the two frozen identity columns stay
  // usable on a ~375px PWA phone.
  const isSmall = useIsSmallViewport();
  const pinWidths = isSmall ? PIN_WIDTHS_MOBILE : PIN_WIDTHS_DESKTOP;

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [data, setData] = useState<OutletReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // PPT export selection — BY OUTLET CODE (a multi-recce outlet has >1 row but counts once), capped at
  // PPTX_MAX_OUTLETS. Persisted across pages/filters so a user can gather up to 3 before exporting.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const atSelectionCap = selected.size >= PPTX_MAX_OUTLETS;
  const toggleOutlet = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else if (next.size < PPTX_MAX_OUTLETS) next.add(code);
      return next;
    });

  const filters: OutletReportFilters = useMemo(
    () => ({ siteCode: siteCode.trim(), town: town.trim(), region: region.trim(), state: stateF.trim(), vendorId }),
    [siteCode, town, region, stateF, vendorId],
  );
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    // The vendors-master list backs the admin vendor filter only; a VENDOR_HO never fetches it
    // (the endpoint is admin-only and a single fleet has nothing to pick).
    if (!showVendorFilter) return;
    vendorsApi.list().then((res) => { if (res.success) setVendors(res.data); });
  }, [showVendorFilter]);

  useEffect(() => { setPage(1); }, [filtersKey, mode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await fetchOutletReport({ ...filters, mode, page, limit: PAGE_SIZE });
      if (cancelled) return;
      if (res.success) { setData(res.data); setError(null); }
      else { setError(res.error || 'Could not load the report.'); setData(null); }
      setLoading(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, mode, page, reloadKey]);

  const onDownload = async () => {
    setDownloading(true);
    const err = await downloadOutletReportXlsx({ ...filters, mode });
    setDownloading(false);
    if (err) toast.error(err);
    else toast.success('Report downloaded');
  };

  const onExportPptx = async () => {
    const codes = Array.from(selected);
    if (codes.length === 0) return;
    setExportingPptx(true);
    const err = await downloadOutletReportPptx(codes, mode);
    setExportingPptx(false);
    if (err) toast.error(err);
    else toast.success('PPT downloaded');
  };

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = pageCount(total, PAGE_SIZE);

  // Grouped display model, driven entirely from the server columns (excel-only columns dropped).
  // `flat` is the left→right render order tagged with the pin index and group-boundary flag so the
  // header and body iterate identically.
  const groups = useMemo(() => groupOutletColumns(columns), [columns]);
  const flat = useMemo(() => flatColumns(groups), [groups]);
  const lastPinnedKey = useMemo(() => {
    const pinned = flat.filter((c) => c.pinIndex >= 0);
    return pinned.length ? pinned[pinned.length - 1].column.key : null;
  }, [flat]);

  return (
    <div className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{MODE_TITLES[mode]}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {MODE_SUBTITLES[mode]}
            {!loading && !error && <> {' · '}{total} outlet{total === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Recce | Installed segmented control. */}
          <div
            role="tablist"
            aria-label="Report variant"
            className="inline-flex items-center rounded-xl border border-gray-200 bg-gray-50 p-0.5"
          >
            {(['recce', 'installed'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                disabled={loading}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-semibold transition-all disabled:opacity-50',
                  mode === m
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {m === 'recce' ? 'Recce' : 'Installed'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            aria-label="Refresh"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:border-gray-300 disabled:opacity-50 active:scale-95 transition-all"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={onExportPptx}
            disabled={selected.size === 0 || exportingPptx}
            title={selected.size === 0 ? 'Select 1–3 outlets to export a PPT' : undefined}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            {exportingPptx ? <Spinner size="sm" /> : <Presentation className="h-4 w-4" />}
            Export PPT{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
          <button
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white px-3.5 py-2 text-sm font-semibold disabled:opacity-50 active:scale-95 transition-all"
          >
            {downloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
            Download .xlsx
          </button>
        </div>
      </div>

      {atSelectionCap && (
        <p className="mb-3 -mt-1 text-xs font-medium text-amber-600">
          PPT export is limited to 3 outlets — deselect one to choose a different outlet.
        </p>
      )}

      {/* Filters */}
      <div className={cn('grid grid-cols-2 gap-2 mb-4', showVendorFilter ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 focus-within:border-[var(--brand-primary)] col-span-2 sm:col-span-1">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="Outlet code" className="w-full text-sm text-gray-900 focus:outline-none bg-transparent" />
        </div>
        <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="Town" className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]" />
        <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Region" className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]" />
        <input value={stateF} onChange={(e) => setStateF(e.target.value)} placeholder="State" className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]" />
        {showVendorFilter && (
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
          <button onClick={() => setReloadKey((k) => k + 1)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <FileSpreadsheet className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">
            {mode === 'installed' ? 'No installations match your filters' : 'No recces match your filters'}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-auto max-h-[70vh]">
            <table className="border-separate border-spacing-0 text-sm">
              <thead>
                {/* Row 1 — group headers (each spans its columns). */}
                <tr>
                  {/* Leading selection column (spans both header rows). */}
                  <th
                    rowSpan={2}
                    style={{ left: 0, width: SELECT_COL_W, minWidth: SELECT_COL_W, maxWidth: SELECT_COL_W }}
                    className="sticky top-0 z-40 h-9 bg-gray-100 border-b border-gray-200"
                    aria-label="Select for PPT export"
                  />
                  {groups.map((g, gi) => (
                    <th
                      key={g.group}
                      colSpan={g.columns.length}
                      style={g.pinned ? { left: SELECT_COL_W } : undefined}
                      className={cn(
                        'sticky top-0 h-9 px-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 bg-gray-100 border-b border-gray-200 whitespace-nowrap',
                        g.pinned ? 'z-30 border-r-2 border-r-gray-200' : 'z-20',
                        gi > 0 && 'border-l border-l-gray-200',
                      )}
                    >
                      {g.label}
                    </th>
                  ))}
                </tr>
                {/* Row 2 — column headers (sticky below the group row). */}
                <tr>
                  {flat.map((c) => {
                    const pinned = c.pinIndex >= 0;
                    return (
                      <th
                        key={c.column.key}
                        style={
                          pinned
                            ? { left: pinLeft(pinWidths, c.pinIndex), width: pinWidth(pinWidths, c.pinIndex), minWidth: pinWidth(pinWidths, c.pinIndex), maxWidth: pinWidth(pinWidths, c.pinIndex) }
                            : undefined
                        }
                        className={cn(
                          'sticky top-9 h-9 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200 whitespace-nowrap',
                          pinned ? 'z-30' : 'z-20',
                          c.column.key === lastPinnedKey && 'border-r-2 border-r-gray-200',
                          c.groupStart && 'border-l border-l-gray-200',
                        )}
                      >
                        {c.column.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSelected = selected.has(r.outletCode);
                  const disableSelect = !isSelected && atSelectionCap;
                  return (
                  <tr key={r.id} className="group hover:bg-gray-50/60">
                    {/* Leading selection checkbox (by outlet; capped at 3). */}
                    <td
                      style={{ left: 0, width: SELECT_COL_W, minWidth: SELECT_COL_W, maxWidth: SELECT_COL_W }}
                      className="sticky z-10 h-12 bg-white group-hover:bg-gray-50 border-b border-gray-50 text-center align-middle"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disableSelect}
                        onChange={() => toggleOutlet(r.outletCode)}
                        title={disableSelect ? 'PPT export is limited to 3 outlets' : `Select ${r.outletCode} for PPT export`}
                        aria-label={`Select outlet ${r.outletCode} for PPT export`}
                        className="h-4 w-4 cursor-pointer accent-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                    {flat.map((c) => {
                      const pinned = c.pinIndex >= 0;
                      const cell = r.cells[c.column.key] ?? { t: 'empty' as const };
                      return (
                        <td
                          key={c.column.key}
                          style={
                            pinned
                              ? { left: pinLeft(pinWidths, c.pinIndex), width: pinWidth(pinWidths, c.pinIndex), minWidth: pinWidth(pinWidths, c.pinIndex), maxWidth: pinWidth(pinWidths, c.pinIndex) }
                              : undefined
                          }
                          className={cn(
                            'h-12 px-3 align-middle text-gray-700 whitespace-nowrap border-b border-gray-50',
                            pinned ? 'sticky z-10 bg-white group-hover:bg-gray-50 truncate font-medium text-gray-900' : '',
                            c.column.key === lastPinnedKey && 'border-r-2 border-r-gray-200',
                            c.groupStart && 'border-l border-l-gray-100',
                          )}
                          title={pinned && cell.t === 'text' ? cell.v : undefined}
                        >
                          <ReportCell
                            cell={cell}
                            label={c.column.label}
                            outlet={r.outletName || r.outletCode}
                            onOpenPhoto={(src, alt) => setLightbox({ src, alt })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-3">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      <Lightbox
        src={lightbox?.src ?? null}
        alt={lightbox?.alt ?? 'Photo'}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}

export default RecceReportScreen;
