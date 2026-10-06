'use client';

/**
 * Installation — the vendor field user's own recce/install jobs, grouped by status with the right
 * action per recce:
 *
 *   REJECTED  → the ASM's reason + a "Re-capture" action → /field/recce/[siteId]?recceId=…
 *               (the recce page resubmits, not a fresh POST).
 *   APPROVED  → "Start installation" → /field/install/[recceId] (the ONLY nav path to install).
 *   SUBMITTED → read-only "Awaiting ASM approval".
 *
 * Data is `GET /api/recce` (vendor + submitter scoped server-side). Note: that list carries no
 * installation linkage, so an APPROVED recce always offers "Start installation"; a recce that
 * was already installed is caught honestly by the install screen (backend 409).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  MapPin,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  Camera,
  Hammer,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import {
  fetchMyRecces,
  groupRecces,
  rejectionLabel,
  type RecceListRow,
  type RecceGroup,
  type RecceStatus,
} from '@/lib/field/recce-api';
import { getOutletFilter, type OutletFilter } from '@/lib/field/outlet-filter';

const STATUS_META: Record<
  RecceStatus,
  { label: string; icon: typeof Clock; tint: string; dot: string }
> = {
  REJECTED: { label: 'Needs re-capture', icon: XCircle, tint: 'text-[var(--brand-primary)]', dot: '#dc2626' },
  APPROVED: { label: 'Ready to install', icon: CheckCircle2, tint: 'text-emerald-600', dot: '#16a34a' },
  SUBMITTED: { label: 'Awaiting approval', icon: Clock, tint: 'text-amber-600', dot: '#d97706' },
};

export default function MyWorkPage() {
  const router = useRouter();

  // `undefined` = not yet read; `null` = read, none set (redirecting away); object = active.
  const [outlet, setOutlet] = useState<OutletFilter | null | undefined>(undefined);
  const [recces, setRecces] = useState<RecceListRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gate: a device with no outlet filter is sent to the filter screen before any work loads.
  useEffect(() => {
    const f = getOutletFilter();
    if (!f) {
      setOutlet(null);
      router.replace('/field/filter');
      return;
    }
    setOutlet(f);
  }, [router]);

  const load = useCallback(async (f: OutletFilter) => {
    setLoading(true);
    setError(null);
    const res = await fetchMyRecces({ rsCode: f.rsCode, beatName: f.beatName });
    if (res.success) {
      setRecces(res.data.recces ?? []);
    } else {
      setError(
        res.status === 403
          ? 'Installation is not available for your account. Please ask your admin to grant access.'
          : res.error || 'Could not load your work. Please try again.',
      );
      setRecces(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (outlet) void load(outlet);
  }, [outlet, load]);

  const groups: RecceGroup[] = recces ? groupRecces(recces) : [];

  // Until the device filter has been read (and while redirecting when none is set), show a
  // spinner rather than flashing empty work.
  if (outlet === undefined || outlet === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <h1 className="mb-3 text-lg font-bold text-gray-900">Installation</h1>

      {/* Active outlet filter — RS code · Beat, with a Change control. */}
      <button
        type="button"
        onClick={() => router.push('/field/filter')}
        data-testid="work-filter-chip"
        className="mb-4 flex w-full items-center justify-between gap-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] px-3 py-2.5 text-left active:scale-[0.99] transition-transform"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <span className="truncate">
            RS <span className="font-semibold">{outlet.rsCode}</span> · Beat{' '}
            <span className="font-semibold">{outlet.beatName}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold text-[var(--brand-primary)]">Change</span>
      </button>

      {loading && (
        <div className="mt-6 flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your work…
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4">
          <div className="flex items-start gap-2 text-sm text-gray-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void load(outlet)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white active:scale-95 transition-transform"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-primary-light)]">
            <ClipboardList className="h-7 w-7 text-[var(--brand-primary)]" />
          </div>
          <h2 className="text-base font-bold text-gray-900">No work yet</h2>
          <p className="mt-1.5 text-sm text-gray-500">
            Start a recce at one of your sites and it will show up here with its status.
          </p>
          <Link
            href="/field/sites"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 py-3 font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
          >
            <MapPin className="h-4 w-4" />
            Browse my sites
          </Link>
        </div>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className="space-y-6 pb-4">
          {groups.map((group) => {
            const meta = STATUS_META[group.status];
            const Icon = meta.icon;
            return (
              <section key={group.status}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${meta.tint}`} />
                  <h2 className="text-sm font-bold text-gray-700">{meta.label}</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                    {group.recces.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {group.recces.map((recce) => (
                    <RecceCard key={recce.id} recce={recce} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── One recce row with its status-specific action ─────────────────────────────
function RecceCard({ recce }: { recce: RecceListRow }) {
  const meta = STATUS_META[recce.status];
  const posmLabel = `${recce.posmCount} Element${recce.posmCount === 1 ? '' : 's'}`;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-gray-900">{recce.site.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            <span className="font-mono text-gray-400">{recce.site.code}</span>
            {recce.site.town && <span> · {recce.site.town}</span>}
            <span> · {posmLabel}</span>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
          {meta.label}
        </span>
      </div>

      {recce.status === 'SUBMITTED' && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
          <Clock className="h-3.5 w-3.5" />
          Awaiting ASM approval.
        </p>
      )}

      {recce.status === 'REJECTED' && (
        <div className="mt-3">
          <div className="flex items-start gap-1.5 rounded-xl bg-red-50 p-2.5 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-semibold">Sent back:</span>{' '}
              {rejectionLabel(recce.rejectionReasonCode) ?? 'Please re-capture and submit again.'}
            </span>
          </div>
          <Link
            href={`/field/recce/${recce.site.id}?recceId=${encodeURIComponent(recce.id)}`}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-3 text-sm font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
          >
            <Camera className="h-4 w-4" />
            Re-capture
          </Link>
        </div>
      )}

      {recce.status === 'APPROVED' && (
        <Link
          href={`/field/install/${encodeURIComponent(recce.id)}`}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-3 text-sm font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
        >
          <Hammer className="h-4 w-4" />
          Start installation
        </Link>
      )}
    </div>
  );
}
