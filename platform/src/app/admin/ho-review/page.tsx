'use client';

/**
 * HO/Admin escalation queue — installations the Auditor REJECTED that await HO review
 * (owner decision 2026-09-30). Each row shows the outlet, who submitted/audited it, and the
 * auditor's rejection reason (WHY it escalated), with a link to the decision page. FIFO by
 * audit time, with site/town filters + pagination. Lives inside the /admin shell.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, SlidersHorizontal, ShieldCheck, RefreshCw, ChevronLeft, ChevronRight,
  MapPin, User, AlertTriangle, ChevronRight as Arrow,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { pageCount } from '@/components/audit/pagination';
import { fetchHoQueue, type HoQueueItem } from '@/lib/ho-review/api';
import { reasonLabel } from '@/lib/audit/api';
import { formatDateTime } from '@/lib/utils';

const PAGE_SIZE = 50;

export default function HoReviewQueuePage() {
  const [siteCode, setSiteCode] = useState('');
  const [town, setTown] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<HoQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const filters = useMemo(() => ({ siteCode: siteCode.trim(), town: town.trim() }), [siteCode, town]);
  const filtersKey = JSON.stringify(filters);

  useEffect(() => { setPage(1); }, [filtersKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await fetchHoQueue({ ...filters, page, limit: PAGE_SIZE });
      if (cancelled) return;
      if (res.success) {
        setItems(res.data.items);
        setTotal(res.data.total);
        setError(null);
      } else {
        setError(res.error || 'Could not load the HO review queue.');
        setItems([]);
        setTotal(0);
      }
      setLoading(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, reloadKey]);

  const activeFilterCount = [siteCode, town].filter((v) => v.trim()).length;
  const totalPages = pageCount(total, PAGE_SIZE);

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">HO review</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Audit-rejected installations escalated for Head-Office review.
            {!loading && !error && (
              <> {' · '}{total} pending{totalPages > 1 && ` · page ${page} of ${totalPages}`}</>
            )}
          </p>
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
      </div>

      {/* Search + filter toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-2xl border border-gray-200 px-3 py-2.5 focus-within:border-[var(--brand-primary)] transition-colors">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            value={siteCode}
            onChange={(e) => setSiteCode(e.target.value)}
            placeholder="Search by outlet code…"
            className="flex-1 text-sm text-gray-900 focus:outline-none bg-transparent"
          />
        </div>
        <button
          onClick={() => setShowFilters((s) => !s)}
          aria-label="Filters"
          className={`relative h-11 w-11 rounded-2xl border flex items-center justify-center active:scale-95 transition-transform ${
            showFilters || activeFilterCount
              ? 'bg-[var(--brand-primary-light)] border-[var(--brand-primary)] text-[var(--brand-primary)]'
              : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-[var(--brand-primary)] text-white text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 gap-2 mb-4 fade-in">
          <input
            value={siteCode}
            onChange={(e) => setSiteCode(e.target.value)}
            placeholder="Outlet code"
            className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]"
          />
          <input
            value={town}
            onChange={(e) => setTown(e.target.value)}
            placeholder="Town"
            className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]"
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-green-50 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-[var(--brand-confirm)]" />
          </div>
          <p className="text-sm font-medium text-gray-700">Nothing awaiting HO review</p>
          <p className="text-xs text-gray-500 mt-1">
            {activeFilterCount ? 'No escalations match your filters.' : 'No audit rejections are pending — you’re all caught up.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/admin/ho-review/${item.id}`}
                className="block bg-white rounded-2xl border border-gray-100 shadow-sm hover:border-[var(--brand-primary)]/40 active:scale-[0.995] transition-all p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {item.site.name} <span className="font-mono text-xs text-gray-400">{item.site.code}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                      {item.site.town && (
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{item.site.town}</span>
                      )}
                      {item.submittedBy && (
                        <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />By {item.submittedBy.name}</span>
                      )}
                      {item.auditedAt && <span>Rejected {formatDateTime(item.auditedAt)}</span>}
                    </div>
                    {item.auditRejection.reasonCode && (
                      <div className="mt-2 inline-flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                        <span>
                          Auditor: {reasonLabel(item.auditRejection.reasonCode)}
                          {item.auditRejection.reason && (
                            <span className="font-normal text-amber-700"> — {item.auditRejection.reason}</span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                  <Arrow className="h-5 w-5 text-gray-300 shrink-0 mt-0.5" />
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
