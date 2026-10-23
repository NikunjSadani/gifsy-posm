'use client';

/**
 * Recce Report (curated cell contract, 2026-10-24) — a scannable per-recce report rendered from a
 * SERVER-DRIVEN typed cell contract (not raw text columns). Each row is one recce; the server hands
 * the columns (key/label/group, which are pinned sticky-left, which are excel-only) and per-cell
 * typed values (text / colored status chip / inline photo thumbnail with a GPS pin / empty). The
 * on-screen table SKIPS excel-only columns (audit-trail approver/date columns live only in the
 * .xlsx). A grouped two-row header spans each group; the outlet identity columns are pinned
 * sticky-left and the rest scroll horizontally. Filters (outlet code, town, region, state, vendor)
 * and the "Download .xlsx" export (all columns, all matching rows) are unchanged. Admin-only.
 *
 * A `mode` seam ('recce' | 'installed') is in place for a later recce|installed toggle; only the
 * 'recce' view is built today.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Download, ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';
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
  type OutletReportResult,
  type OutletReportFilters,
} from '@/lib/reports/outlet-execution';
import { groupOutletColumns, flatColumns } from '@/lib/reports/outlet-columns';

const PAGE_SIZE = 50;

/** Pixel widths for the sticky-left pinned columns, by pin index; a further pinned column (none
 *  today) falls back to the last width. The sticky `left` offset is the sum of earlier widths. */
const PIN_WIDTHS = [128, 208];
const pinWidth = (i: number) => PIN_WIDTHS[i] ?? PIN_WIDTHS[PIN_WIDTHS.length - 1] ?? 160;
const pinLeft = (i: number) => {
  let left = 0;
  for (let j = 0; j < i; j++) left += pinWidth(j);
  return left;
};

type ReportMode = 'recce' | 'installed';
const MODE_TITLES: Record<ReportMode, string> = {
  recce: 'Recce Report',
  installed: 'Installation Report',
};

export default function ExecutionReportPage() {
  const [siteCode, setSiteCode] = useState('');
  const [town, setTown] = useState('');
  const [region, setRegion] = useState('');
  const [stateF, setStateF] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [page, setPage] = useState(1);

  // Seam for a later recce|installed toggle — only 'recce' is built today.
  const [mode] = useState<ReportMode>('recce');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [data, setData] = useState<OutletReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const filters: OutletReportFilters = useMemo(
    () => ({ siteCode: siteCode.trim(), town: town.trim(), region: region.trim(), state: stateF.trim(), vendorId }),
    [siteCode, town, region, stateF, vendorId],
  );
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    vendorsApi.list().then((res) => { if (res.success) setVendors(res.data); });
  }, []);

  useEffect(() => { setPage(1); }, [filtersKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await fetchOutletReport({ ...filters, page, limit: PAGE_SIZE });
      if (cancelled) return;
      if (res.success) { setData(res.data); setError(null); }
      else { setError(res.error || 'Could not load the report.'); setData(null); }
      setLoading(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, reloadKey]);

  const onDownload = async () => {
    setDownloading(true);
    const err = await downloadOutletReportXlsx(filters);
    setDownloading(false);
    if (err) toast.error(err);
    else toast.success('Report downloaded');
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
            One row per recce — recce evidence, element status and approvals at a glance.
            {!loading && !error && <> {' · '}{total} recce{total === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white px-3.5 py-2 text-sm font-semibold disabled:opacity-50 active:scale-95 transition-all"
          >
            {downloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
            Download .xlsx
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 focus-within:border-[var(--brand-primary)] col-span-2 sm:col-span-1">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="Outlet code" className="w-full text-sm text-gray-900 focus:outline-none bg-transparent" />
        </div>
        <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="Town" className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]" />
        <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Region" className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]" />
        <input value={stateF} onChange={(e) => setStateF(e.target.value)} placeholder="State" className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]" />
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]">
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
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
          <p className="text-sm font-medium text-gray-700">No recces match your filters</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-auto max-h-[70vh]">
            <table className="border-separate border-spacing-0 text-sm">
              <thead>
                {/* Row 1 — group headers (each spans its columns). */}
                <tr>
                  {groups.map((g, gi) => (
                    <th
                      key={g.group}
                      colSpan={g.columns.length}
                      style={g.pinned ? { left: 0 } : undefined}
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
                            ? { left: pinLeft(c.pinIndex), width: pinWidth(c.pinIndex), minWidth: pinWidth(c.pinIndex), maxWidth: pinWidth(c.pinIndex) }
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
                {rows.map((r) => (
                  <tr key={r.id} className="group hover:bg-gray-50/60">
                    {flat.map((c) => {
                      const pinned = c.pinIndex >= 0;
                      const cell = r.cells[c.column.key] ?? { t: 'empty' as const };
                      return (
                        <td
                          key={c.column.key}
                          style={
                            pinned
                              ? { left: pinLeft(c.pinIndex), width: pinWidth(c.pinIndex), minWidth: pinWidth(c.pinIndex), maxWidth: pinWidth(c.pinIndex) }
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
                            onOpenPhoto={(src, alt) => setLightbox({ src, alt })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
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
