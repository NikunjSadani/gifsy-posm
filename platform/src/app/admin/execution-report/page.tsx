'use client';

/**
 * Outlet Execution Report (owner spec 2026-09-30) — one row per outlet across recce → ASM →
 * install → audit → HO, for up to 2 POSM elements. The 36-column table is horizontally
 * scrollable; the primary deliverable is the .xlsx download (all matching rows). Filters:
 * outlet code, town, region, state, vendor. Admin-only (inside the /admin shell).
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Download, ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/spinner';
import { pageCount } from '@/components/audit/pagination';
import { vendorsApi } from '@/lib/admin/api';
import type { Vendor } from '@/lib/admin/types';
import {
  fetchOutletReport,
  downloadOutletReportXlsx,
  type OutletReportResult,
  type OutletReportFilters,
} from '@/lib/reports/outlet-execution';

const PAGE_SIZE = 50;

export default function ExecutionReportPage() {
  const [siteCode, setSiteCode] = useState('');
  const [town, setTown] = useState('');
  const [region, setRegion] = useState('');
  const [stateF, setStateF] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [page, setPage] = useState(1);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [data, setData] = useState<OutletReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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

  const columns = data?.columns ?? [];
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = pageCount(total, PAGE_SIZE);

  return (
    <div className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Execution report</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            One row per outlet — recce, installation, approvals and audit across both POSM elements.
            {!loading && !error && <> {' · '}{total} outlet{total === 1 ? '' : 's'}</>}
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
          <p className="text-sm font-medium text-gray-700">No outlets match your filters</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="min-w-max text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/60">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {r[c] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
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
    </div>
  );
}
