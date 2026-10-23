'use client';

/**
 * ASM dashboard: how many recces await review, the site-execution funnel (waterfall), and a
 * quick link into the approval queue. Every panel has its own loading / error state; the funnel
 * degrades gracefully if only one of the two calls fails.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ClipboardCheck,
  MapPin,
  CheckCircle2,
  Hammer,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { fetchWaterfall, fetchQueue, type Waterfall } from '@/lib/review/api';
import { Spinner } from '@/components/ui/spinner';

interface DashboardState {
  loading: boolean;
  error: string | null;
  waterfall: Waterfall | null;
  pending: number | null;
}

export default function ReviewDashboardPage() {
  const [state, setState] = useState<DashboardState>({
    loading: true,
    error: null,
    waterfall: null,
    pending: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const [wf, queue] = await Promise.all([fetchWaterfall(), fetchQueue({ limit: 1 })]);
    setState({
      loading: false,
      // Surface an error only if BOTH failed; otherwise show what we have.
      error: !wf.success && !queue.success ? wf.error || 'Could not load the dashboard.' : null,
      waterfall: wf.success ? wf.data : null,
      pending: queue.success ? queue.data.total : null,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Approval dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Review field recces for your territory and keep installations moving.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={state.loading}
          aria-label="Refresh"
          className="shrink-0 flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 active:scale-95 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {state.loading && state.waterfall == null && state.pending == null ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : state.error ? (
        <ErrorPanel message={state.error} onRetry={() => void load()} />
      ) : (
        <>
          {/* Pending review — the ASM's primary call to action */}
          <Link
            href="/review/recces"
            className="block rounded-2xl bg-[var(--brand-primary)] text-white p-5 shadow-sm hover:bg-[var(--brand-primary-dark)] active:scale-[0.99] transition-all"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-white/15 rounded-xl p-3">
                  <ClipboardCheck className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-3xl font-black leading-none">
                    {state.pending ?? '—'}
                  </p>
                  <p className="text-sm text-white/90 mt-1">
                    recce{state.pending === 1 ? '' : 's'} awaiting your review
                  </p>
                </div>
              </div>
              <span className="hidden sm:flex items-center gap-1.5 text-sm font-semibold bg-white/15 rounded-xl px-3 py-2">
                Open queue <ArrowRight className="h-4 w-4" />
              </span>
            </div>
          </Link>

          {/* Execution funnel */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Execution funnel</h2>
            {state.waterfall ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <FunnelCard icon={<MapPin className="h-5 w-5" />} label="Outlets" value={state.waterfall.totalSites} tone="gray" />
                <FunnelCard icon={<ClipboardCheck className="h-5 w-5" />} label="Recce" value={state.waterfall.recced} tone="blue" />
                <FunnelCard icon={<CheckCircle2 className="h-5 w-5" />} label="ASM approved" value={state.waterfall.approved} tone="indigo" />
                <FunnelCard icon={<ShieldCheck className="h-5 w-5" />} label="HO approved" value={state.waterfall.hoApproved} tone="green" />
                <FunnelCard icon={<Hammer className="h-5 w-5" />} label="Installed" value={state.waterfall.installed} tone="amber" />
                <FunnelCard icon={<ShieldCheck className="h-5 w-5" />} label="Audited" value={state.waterfall.audited} tone="purple" />
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-500">
                The funnel could not be loaded right now.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const toneStyles: Record<string, string> = {
  gray: 'text-gray-600 bg-gray-100',
  blue: 'text-blue-600 bg-blue-50',
  indigo: 'text-indigo-600 bg-indigo-50',
  green: 'text-emerald-600 bg-emerald-50',
  amber: 'text-amber-600 bg-amber-50',
  purple: 'text-purple-600 bg-purple-50',
};

function FunnelCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof toneStyles;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className={`inline-flex rounded-lg p-2 ${toneStyles[tone]}`}>{icon}</div>
      <p className="text-2xl font-black text-gray-900 mt-2 leading-none">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
      <p className="text-sm font-semibold text-red-800">Couldn&apos;t load the dashboard</p>
      <p className="text-sm text-red-600 mt-1">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] rounded-xl px-4 py-2 active:scale-95 transition-all"
      >
        <RefreshCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
