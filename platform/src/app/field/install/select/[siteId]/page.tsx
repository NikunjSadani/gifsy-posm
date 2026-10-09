'use client';

/**
 * Install recce picker — for an outlet with MORE THAN ONE installable recce (only possible once
 * manual recces exist), the field exec chooses which approved recce to install against before the
 * capture screen. Feeds from `GET /api/installation/installable?siteId=…` (the authoritative list:
 * APPROVED + HO-APPROVED + not yet installed) so a stale "ready" row from My Work can't be picked.
 *
 * Single-recce flow preserved (D9): when the outlet has exactly one installable recce, this
 * forwards straight to its capture screen (no extra tap); zero is an honest empty state. Tapping a
 * recce routes to `/field/install/[recceId]`, which posts the `recceId` on submit.
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, AlertCircle, Hammer, ChevronRight, RefreshCw, PackageCheck } from 'lucide-react';
import {
  fetchInstallableRecces,
  installableElementSummary,
  type InstallableRecce,
} from '@/lib/field/installation-api';

export default function InstallSelectPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = use(params);
  const router = useRouter();

  const [recces, setRecces] = useState<InstallableRecce[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // True while we auto-forward a single installable recce, so we don't flash the picker first.
  const [forwarding, setForwarding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetchInstallableRecces(siteId);
      if (!alive) return;
      if (res.success) {
        const list = res.data.recces ?? [];
        // Single-recce flow: forward straight to capture (no extra pick). router.replace keeps the
        // picker out of the back stack.
        if (list.length === 1) {
          setForwarding(true);
          router.replace(`/field/install/${encodeURIComponent(list[0].id)}`);
          return;
        }
        setRecces(list);
      } else {
        setError(
          res.status === 404
            ? 'This outlet could not be found for your account.'
            : res.error || 'Could not load installable recces. Please try again.',
        );
        setRecces(null);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [siteId, router, reloadKey]);

  const outletName = recces?.[0]?.site.name ?? null;

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1 className="text-lg font-bold text-gray-900">Choose a recce to install</h1>
      <p className="mt-1 text-sm text-gray-500">
        {outletName
          ? <>This outlet has more than one approved recce. Pick the one you’re installing — <span className="font-semibold">{outletName}</span>.</>
          : 'Pick the approved recce you’re installing.'}
      </p>

      {(loading || forwarding) && (
        <div className="mt-6 flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {forwarding ? 'Opening installation…' : 'Loading installable recces…'}
        </div>
      )}

      {!loading && !forwarding && error && (
        <div className="mt-4 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4">
          <div className="flex items-start gap-2 text-sm text-gray-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white active:scale-95 transition-transform"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {!loading && !forwarding && !error && recces && recces.length === 0 && (
        <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
            <PackageCheck className="h-7 w-7 text-gray-400" />
          </div>
          <h2 className="text-base font-bold text-gray-900">Nothing to install here</h2>
          <p className="mt-1.5 text-sm text-gray-500">
            This outlet has no approved recce still awaiting installation.
          </p>
        </div>
      )}

      {!loading && !forwarding && !error && recces && recces.length > 0 && (
        <div className="mt-4 space-y-3">
          {recces.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => router.push(`/field/install/${encodeURIComponent(r.id)}`)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm active:scale-[0.99] transition-transform"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Hammer className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
                  <span className="text-sm font-bold text-gray-900">
                    {r.posms.length} Element{r.posms.length === 1 ? '' : 's'}
                  </span>
                  {r.recceMode === 'MANUAL' && (
                    <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                      Manual
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-gray-500">
                  {installableElementSummary(r.posms)}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
