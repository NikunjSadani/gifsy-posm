'use client';

/**
 * The ASM approval QUEUE — SUBMITTED recces for this ASM's territory, oldest-first (FIFO).
 * Filter by site code / town, multi-select rows, and bulk-approve. Rows link through to the
 * detail view for a full-photo review + reject. Loading / empty / error states throughout;
 * after a bulk approve the queue refetches and the selection clears.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, X, CheckCheck, RefreshCw, AlertTriangle, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  fetchQueue,
  bulkApproveRecces,
  summarizeQueue,
  type RecceQueueItem,
} from '@/lib/review/api';
import { RecceRow } from '@/components/review/recce-row';
import { ConfirmDialog } from '@/components/review/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';

const PAGE_SIZE = 50;

export default function ReviewQueuePage() {
  // Input boxes vs the applied filter (applied on submit, so typing doesn't refetch per keystroke).
  const [siteCodeInput, setSiteCodeInput] = useState('');
  const [townInput, setTownInput] = useState('');
  const [applied, setApplied] = useState<{ siteCode: string; town: string }>({ siteCode: '', town: '' });
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<RecceQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchQueue({
      siteCode: applied.siteCode || undefined,
      town: applied.town || undefined,
      page,
      limit: PAGE_SIZE,
    });
    if (res.success) {
      setItems(res.data.items);
      setTotal(res.data.total);
      // Drop any selections no longer present on the page.
      setSelected((prev) => {
        const present = new Set(res.data.items.map((i) => i.id));
        const next = new Set<string>();
        prev.forEach((id) => present.has(id) && next.add(id));
        return next;
      });
    } else {
      setError(res.error || 'Could not load the review queue.');
      setItems([]);
      setTotal(0);
    }
    setLoading(false);
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeQueue(items), [items]);
  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = () => {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  };

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    setPage(1);
    setApplied({ siteCode: siteCodeInput.trim(), town: townInput.trim() });
  };

  const clearFilters = () => {
    setSiteCodeInput('');
    setTownInput('');
    setPage(1);
    setApplied({ siteCode: '', town: '' });
  };

  const doBulkApprove = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    const ids = [...selected];
    const res = await bulkApproveRecces(ids);
    setBulkLoading(false);
    setConfirmOpen(false);
    if (!res.success) {
      toast.error(res.error || 'Bulk approval failed. Please try again.');
      return;
    }
    const { approvedCount, skipped } = res.data;
    if (approvedCount > 0) {
      toast.success(`Approved ${approvedCount} recce${approvedCount === 1 ? '' : 's'}.`);
    }
    if (skipped.length > 0) {
      toast(
        `${skipped.length} skipped (already reviewed or out of scope).`,
        { icon: '⚠️' },
      );
    }
    if (approvedCount === 0 && skipped.length === 0) {
      toast('No recces were approved.', { icon: 'ℹ️' });
    }
    setSelected(new Set());
    await load();
  };

  const hasFilters = applied.siteCode !== '' || applied.town !== '';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Approval queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} recce{total === 1 ? '' : 's'} awaiting review
            {summary.flagged > 0 && <> · {summary.flagged} flagged</>}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh"
          className="shrink-0 flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 active:scale-95 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-100 bg-white p-3">
        <div className="flex-1 min-w-[8rem]">
          <label htmlFor="f-site" className="block text-xs font-medium text-gray-600 mb-1">Site code</label>
          <input
            id="f-site"
            value={siteCodeInput}
            onChange={(e) => setSiteCodeInput(e.target.value)}
            placeholder="e.g. KW-1023"
            className="w-full rounded-xl border-2 border-gray-200 focus:border-[var(--brand-primary)] focus:outline-none px-3 py-2 text-sm text-gray-900"
          />
        </div>
        <div className="flex-1 min-w-[8rem]">
          <label htmlFor="f-town" className="block text-xs font-medium text-gray-600 mb-1">Town</label>
          <input
            id="f-town"
            value={townInput}
            onChange={(e) => setTownInput(e.target.value)}
            placeholder="e.g. Pune"
            className="w-full rounded-xl border-2 border-gray-200 focus:border-[var(--brand-primary)] focus:outline-none px-3 py-2 text-sm text-gray-900"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] rounded-xl px-4 py-2 active:scale-95 transition-all"
        >
          <Search className="h-4 w-4" /> Filter
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl px-3 py-2 active:scale-95 transition-all"
          >
            <X className="h-4 w-4" /> Clear
          </button>
        )}
      </form>

      {/* Bulk action bar */}
      {items.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-2.5">
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={toggleAll}
              aria-label="Select all recces on this page"
              className="w-4 h-4 accent-[var(--brand-primary)] cursor-pointer"
            />
            {someSelected ? `${selected.size} selected` : 'Select all'}
          </label>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!someSelected}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[var(--brand-confirm)] hover:brightness-95 rounded-xl px-4 py-2 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCheck className="h-4 w-4" />
            Approve selected
          </button>
        </div>
      )}

      {/* List */}
      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-red-800">Couldn&apos;t load the queue</p>
          <p className="text-sm text-red-600 mt-1">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] rounded-xl px-4 py-2 active:scale-95 transition-all"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-16 px-4 text-center">
          <div className="inline-flex p-4 bg-gray-100 rounded-full text-gray-400 mb-3">
            <Inbox className="h-8 w-8" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">
            {hasFilters ? 'No recces match these filters' : 'Nothing to review'}
          </h3>
          <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
            {hasFilters
              ? 'Try a different site code or town, or clear the filters.'
              : 'New field submissions for your territory will appear here for approval.'}
          </p>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl px-4 py-2 active:scale-95 transition-all"
            >
              <X className="h-4 w-4" /> Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {items.map((item) => (
              <RecceRow key={item.id} item={item} selected={selected.has(item.id)} onToggle={toggleOne} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1">
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

      <ConfirmDialog
        open={confirmOpen}
        title="Approve selected recces?"
        message={
          <>
            You&apos;re about to approve <span className="font-semibold">{selected.size}</span> recce
            {selected.size === 1 ? '' : 's'}. This unlocks installation for those sites. Any recce that
            was already reviewed or is outside your territory will be skipped.
          </>
        }
        confirmLabel="Approve"
        confirmVariant="primary"
        loading={bulkLoading}
        onConfirm={() => void doBulkApprove()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
