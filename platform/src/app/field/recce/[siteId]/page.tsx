'use client';

/**
 * Recce capture flow — capture 1–2 POSM lines for a site, then submit the whole recce.
 *
 * Two modes, resolved on load:
 *   - CREATE   → a site with no recce yet: POST /api/recce { siteId, posms }.
 *   - RESUBMIT → a REJECTED recce (reached via My Work "Re-capture", ?recceId=…, or detected
 *                for the site): POST /api/recce/:id/resubmit { posms } — a fresh POST would 409.
 *                The ASM's rejection reason is surfaced so the rep knows what to fix.
 *   - BLOCKED  → the site already has a SUBMITTED/APPROVED (immutable) recce: no re-capture.
 *
 * Each line (PosmCaptureCard): pick POSM type + dimensions, take a photo, auto-attach a GPS
 * fix, and upload to get a media key. Submit is disabled until at least one line is fully ready
 * with a geo fix. Success returns to /field/sites (Recce to do) — the just-submitted site drops
 * off that list — so the rep can pick the next outlet (not the Installation screen).
 *
 * The backend is the sole geo-fence authority: an out-of-fence or unverifiable fix comes back
 * as a 403 we surface honestly — this UI makes no "verified"/anti-spoof claims of its own.
 */

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api-client';
import {
  PosmCaptureCard,
  type PosmTypeOption,
  type PosmCaptureState,
} from '@/components/field/capture/PosmCaptureCard';
import {
  fetchMyRecces,
  fetchRecce,
  submitRecce,
  resubmitRecce,
  findSiteRecce,
  rejectionLabel,
  type RecceDetail,
} from '@/lib/field/recce-api';
import { fetchSite } from '@/lib/field/sites';
import { gatePosmTypesByGsb, isGsbHiddenForOutlet } from '@/lib/field/posm-gate';

interface PosmTypeApi {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const EMPTY_STATE: PosmCaptureState = { started: false, line: null };

type Mode = 'create' | 'resubmit' | 'blocked';

export default function ReccePage({ params }: { params: Promise<{ siteId: string }> }) {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ReccePageInner params={params} />
    </Suspense>
  );
}

function LoadingScreen() {
  return (
    <div className="mt-6 flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading…
    </div>
  );
}

function ReccePageInner({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const recceIdParam = searchParams.get('recceId');

  const [posmTypes, setPosmTypes] = useState<PosmTypeOption[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);

  // Per-outlet GSB gate: whether this outlet permits the GSB element type. `null` = not yet
  // resolved. Resolved by an AUTHORITATIVE per-outlet fetch (`GET /v1/sites/:id`, vendor-scoped)
  // for this exact siteId — so a large-fleet vendor can't be mis-gated by an outlet falling outside
  // a capped list window. The backend hard-rejects a GSB submission on a disallowed outlet
  // regardless — this only hides the option in the picker.
  const [gsbAllowed, setGsbAllowed] = useState<boolean | null>(null);
  const [gsbLoading, setGsbLoading] = useState(true);

  // Recce context (create vs resubmit vs blocked) resolved on load.
  const [ctxLoading, setCtxLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('create');
  const [existing, setExisting] = useState<RecceDetail | null>(null);

  const [count, setCount] = useState(1); // number of Element cards (1 or 2)
  const [expandedIndex, setExpandedIndex] = useState(0); // accordion: only one card expanded at a time
  const [states, setStates] = useState<PosmCaptureState[]>([EMPTY_STATE, EMPTY_STATE]);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous in-flight guard: a fast double-tap re-enters submit() before `submitting`
  // (state) has re-rendered the disabled button, so guard on a ref set at entry.
  const inFlight = useRef(false);

  // Load the tenant's POSM types.
  useEffect(() => {
    let alive = true;
    (async () => {
      setTypesLoading(true);
      const res = await api.get<PosmTypeApi[]>('/api/posm-types');
      if (!alive) return;
      if (res.success) {
        setPosmTypes(res.data.filter((t) => t.isActive).map((t) => ({ id: t.id, code: t.code, name: t.name })));
        setTypesError(null);
      } else {
        setTypesError(
          res.status === 403
            ? 'Element types are not available for your account. Please ask your admin to grant access.'
            : res.error || 'Could not load Element types. Pull to retry.',
        );
      }
      setTypesLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Resolve the outlet's GSB permission for the picker gate via an authoritative per-outlet fetch
  // (vendor-scoped `GET /v1/sites/:id`). Fail OPEN only on a transient fetch failure: the backend
  // still hard-blocks a GSB submission on a disallowed outlet, so the worst case is a 400 we
  // already surface honestly — never a wrongly-hidden GSB for a legitimately-allowed outlet.
  useEffect(() => {
    let alive = true;
    (async () => {
      setGsbLoading(true);
      const res = await fetchSite(siteId);
      if (!alive) return;
      setGsbAllowed(res.success ? res.data.gsbAllowed : true);
      setGsbLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [siteId]);

  // Resolve the recce context: an explicit ?recceId (from My Work "Re-capture"), or detect an
  // existing recce for this site. A REJECTED recce → resubmit; SUBMITTED/APPROVED → blocked.
  useEffect(() => {
    let alive = true;
    (async () => {
      setCtxLoading(true);
      let detail: RecceDetail | null = null;

      if (recceIdParam) {
        const res = await fetchRecce(recceIdParam);
        if (alive && res.success) detail = res.data;
      } else {
        const list = await fetchMyRecces();
        if (alive && list.success) {
          const row = findSiteRecce(list.data.recces, siteId);
          if (row) {
            const res = await fetchRecce(row.id);
            if (alive && res.success) detail = res.data;
          }
        }
        // A list failure is non-fatal: fall through as CREATE — the backend's one-live-recce
        // constraint still guards (a genuine duplicate comes back as a 409 we surface).
      }

      if (!alive) return;
      if (detail && detail.site.id === siteId) {
        setExisting(detail);
        setMode(detail.status === 'REJECTED' ? 'resubmit' : 'blocked');
      } else {
        setExisting(null);
        setMode('create');
      }
      setCtxLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [recceIdParam, siteId]);

  const setStateAt = useCallback((i: number, s: PosmCaptureState) => {
    setStates((prev) => {
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }, []);

  const active = states.slice(0, count);
  const readyLines = useMemo(
    () => active.map((s) => s.line).filter((l): l is NonNullable<typeof l> => l !== null),
    [active],
  );
  const hasIncompleteStarted = active.some((s) => s.started && s.line === null);
  const canSubmit = readyLines.length >= 1 && !submitting && !typesError && mode !== 'blocked';

  // GSB gate: hide the GSB element type from the picker when this outlet disallows it. Until the
  // permission resolves we treat it as allowed, but the render gate waits on `gsbLoading` so the
  // GSB option never flashes before being removed.
  const effectiveGsbAllowed = gsbAllowed ?? true;
  const visiblePosmTypes = useMemo(
    () => gatePosmTypesByGsb(posmTypes, effectiveGsbAllowed),
    [posmTypes, effectiveGsbAllowed],
  );
  const gsbHidden = isGsbHiddenForOutlet(posmTypes, effectiveGsbAllowed);

  const submit = async () => {
    if (inFlight.current || submitting) return; // synchronous double-tap guard
    if (mode === 'blocked') return;
    if (readyLines.length < 1) {
      toast.error('Capture at least one Element (type, dimensions, and a photo with location).');
      return;
    }
    if (hasIncompleteStarted) {
      toast.error('Finish or remove the incomplete Element line before submitting.');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const isResubmit = mode === 'resubmit' && existing;
      const res = isResubmit
        ? await resubmitRecce(existing.id, readyLines)
        : await submitRecce(siteId, readyLines);
      if (!res.success) {
        toast.error(res.error || 'Could not submit the recce. Please try again.');
        return;
      }
      toast.success(isResubmit ? 'Recce re-submitted for approval.' : 'Recce submitted for approval.');
      // Return to "Recce to do" (the just-submitted site drops off the list) so the rep can pick
      // the next outlet — NOT the Installation screen.
      router.push('/field/sites');
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  const addSecond = () => {
    setCount(2);
    setExpandedIndex(1); // collapse Element 1, expand the newly added Element 2
  };
  const removeSecond = () => {
    setStateAt(1, EMPTY_STATE);
    setCount(1);
    setExpandedIndex(0);
  };

  // A REJECTED recce can be sent back by either the ASM or Head Office. When HO rejected it
  // (hoReviewStatus REJECTED), surface the HO remark; otherwise fall back to the ASM remark.
  const rejectionText = (() => {
    if (mode !== 'resubmit' || !existing) return null;
    if (existing.hoReviewStatus === 'REJECTED') {
      return existing.hoRejectionReason?.trim() || rejectionLabel(existing.hoRejectionReasonCode);
    }
    return existing.rejectionReason?.trim() || rejectionLabel(existing.rejectionReasonCode);
  })();

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1 className="text-lg font-bold text-gray-900">{mode === 'resubmit' ? 'Re-capture recce' : 'New recce'}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {mode === 'resubmit'
          ? 'Fix what the reviewer flagged, then re-submit this site’s recce.'
          : 'Capture 1–2 Element lines for this site.'}
      </p>

      {typesError && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4 text-sm text-gray-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <span>{typesError}</span>
        </div>
      )}

      {/* Resubmit: surface the ASM's rejection reason so the rep knows what to fix. */}
      {rejectionText && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Sent back:</span> {rejectionText}
            <span className="mt-1 block text-xs text-red-600/80">Re-capture the Element(s) and submit again.</span>
          </span>
        </div>
      )}

      {/* Blocked: the site already has an immutable (submitted/approved) recce. */}
      {mode === 'blocked' && existing && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This site already has a <span className="font-semibold">{existing.status.toLowerCase()}</span> recce, which
            can’t be re-captured.{' '}
            <button onClick={() => router.push('/field/sites')} className="font-semibold underline">
              Back to Recce to do
            </button>
          </span>
        </div>
      )}

      {typesLoading || ctxLoading || gsbLoading ? (
        <LoadingScreen />
      ) : typesError || mode === 'blocked' ? null : (
        <div className="mt-4 space-y-4">
          {gsbHidden && (
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
              GSB is not approved for this outlet.
            </p>
          )}
          {Array.from({ length: count }).map((_, i) => (
            <PosmCaptureCard
              key={i}
              slot={i + 1}
              posmTypes={visiblePosmTypes}
              onChange={(s) => setStateAt(i, s)}
              onRemove={i === 1 ? removeSecond : undefined}
              collapsed={count === 2 && i !== expandedIndex}
              onExpand={() => setExpandedIndex(i)}
            />
          ))}

          {count < 2 && (
            <button
              type="button"
              onClick={addSecond}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-3.5 text-sm font-semibold text-gray-500 active:scale-[0.99] transition-transform"
            >
              <Plus className="h-4 w-4" />
              Add second Element
            </button>
          )}
        </div>
      )}

      {mode !== 'blocked' && !typesError && (
        <div className="sticky bottom-0 -mx-4 mt-6 border-t border-gray-100 bg-gray-50/95 px-4 py-3 backdrop-blur">
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-4 text-lg font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Submitting…
              </>
            ) : mode === 'resubmit' ? (
              `Re-submit recce${readyLines.length ? ` (${readyLines.length})` : ''}`
            ) : (
              `Submit recce${readyLines.length ? ` (${readyLines.length})` : ''}`
            )}
          </button>
          {!canSubmit && !submitting && (
            <p className="mt-2 text-center text-xs text-gray-400">
              Add an Element type, dimensions, a located photo, and mark where it goes to enable submit.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
