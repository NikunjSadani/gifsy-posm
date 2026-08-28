'use client';

/**
 * Auditor dashboard — the count of installations awaiting audit + a quick link into the queue.
 * The Auditor is the final QA gate before an installation is considered done, so the headline
 * metric is simply "how many are waiting on me".
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ListChecks, ClipboardCheck, ArrowRight, RefreshCw, Clock } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { fetchAuditQueue, type QueueItem } from '@/lib/audit/api';
import { formatRelativeTime } from '@/lib/utils';

export default function AuditDashboard() {
  const [total, setTotal] = useState<number | null>(null);
  const [oldest, setOldest] = useState<QueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // FIFO order → the first item is the oldest-waiting one.
    fetchAuditQueue({ page: 1, limit: 1 }).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setTotal(res.data.total);
        setOldest(res.data.items[0] ?? null);
      } else {
        setError(res.error || 'Could not load the audit queue.');
        setTotal(null);
        setOldest(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Audit dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review installed POSM against the approved recce.</p>
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

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Awaiting-audit metric */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-2 text-gray-500">
              <ClipboardCheck className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Awaiting audit</span>
            </div>
            <p className="mt-3 text-5xl font-black text-gray-900">{total ?? 0}</p>
            {total && total > 0 && oldest ? (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                Oldest waiting {formatRelativeTime(oldest.receivedAt)}
              </p>
            ) : (
              <p className="mt-2 text-xs text-gray-500">You&apos;re all caught up.</p>
            )}
          </div>

          {/* Quick link */}
          <Link
            href="/audit/installations"
            className="group bg-[var(--brand-primary)] rounded-2xl shadow-sm p-6 flex flex-col justify-between text-white hover:bg-[var(--brand-primary-dark)] active:scale-[0.99] transition-all"
          >
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              <span className="text-sm font-bold">Review queue</span>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <span className="text-sm text-white/90">
                {total && total > 0 ? `Start reviewing ${total} installation${total === 1 ? '' : 's'}` : 'Open the queue'}
              </span>
              <ArrowRight className="h-5 w-5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
