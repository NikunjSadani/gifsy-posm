'use client';

/**
 * Recce capture flow — capture 1–2 POSM lines for a site, then submit the whole recce.
 *
 * Two modes, resolved on load:
 *   - CREATE   → a site with no recce yet: POST /api/recce { siteId, posms }.
 *   - RESUBMIT → a REJECTED recce (reached from "Recce to do" — a rejected outlet appears there —
 *                via ?recceId=…, or detected for the site): POST /api/recce/:id/resubmit { posms }
 *                — a fresh POST would 409. The rejection reason is surfaced so the rep knows what to
 *                fix; the element TYPE + DIMENSIONS are PRE-FILLED from the original but EDITABLE
 *                (one card per original posm — the COUNT is fixed), re-validated server-side.
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
  fetchRejectedRecceForSite,
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
  /** Authoritative GSB flag (gated per-outlet). */
  isGsb: boolean;
  /** DIMENSION → capture W×H; UNIT → no dimensions + a square box. */
  measurement: 'DIMENSION' | 'UNIT';
  /** Footprint cap (sq ft) for a DIMENSION element; null = uncapped. */
  maxAreaSqFt: number | null;
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

  // The outlet's name + code, for the header (mirrors the Installation screen). Captured from the
  // same authoritative per-outlet fetch used for the GSB gate; falls back to the loaded recce's site.
  const [site, setSite] = useState<{ name: string; code: string } | null>(null);

  // Recce context (create vs resubmit vs blocked) resolved on load.
  const [ctxLoading, setCtxLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('create');
  const [existing, setExisting] = useState<RecceDetail | null>(null);

  // Editable "as observed" outlet name, pre-filled from the master (or a prior correction on
  // resubmit). Seeded once when the outlet/recce resolves; the rep may edit it before submitting.
  const [outletNameInput, setOutletNameInput] = useState('');
  const seededName = useRef(false);

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
        setPosmTypes(
          res.data
            .filter((t) => t.isActive)
            .map((t) => ({
              id: t.id,
              code: t.code,
              name: t.name,
              // Default transitional/absent fields so an older backend payload can't mis-gate or
              // mis-measure a line (the live backend returns all three).
              isGsb: t.isGsb ?? false,
              measurement: t.measurement ?? 'DIMENSION',
              maxAreaSqFt: t.maxAreaSqFt ?? null,
            })),
        );
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
      if (res.success) setSite({ name: res.data.name, code: res.data.code });
      setGsbLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [siteId]);

  // Resolve the recce context (create vs resubmit vs blocked). Precedence:
  //   1. ?recceId= present (from My Work "Re-capture") → load THAT recce by id and decide mode from
  //      its status: REJECTED → resubmit, anything else → blocked. The explicit id wins outright.
  //   2. else the `for-site` resolver → the single REJECTED recce this user may resubmit for the
  //      site. If it returns one → resubmit. This resolves the RIGHT recce even when the site also
  //      carries a newer non-rejected recce (a newest-wins lookup would resolve that and wrongly
  //      block), and it is single-result server-side so the list's 200-row cap can't hide it.
  //   3. else fall back to the newest recce for the site (`findSiteRecce`) → SUBMITTED/APPROVED
  //      blocks, none → create. The resolver already owns the rejected case, so this only ever
  //      lands on a non-rejected (blocking) recce or nothing.
  useEffect(() => {
    let alive = true;
    (async () => {
      setCtxLoading(true);
      let detail: RecceDetail | null = null;

      if (recceIdParam) {
        const res = await fetchRecce(recceIdParam);
        if (alive && res.success) detail = res.data;
      } else {
        // Path 2: the rejected recce the user may resubmit for this site (if any).
        const resolved = await fetchRejectedRecceForSite(siteId);
        if (alive && resolved.success && resolved.data.recce) {
          detail = resolved.data.recce;
        } else if (alive) {
          // Path 3: no rejected recce — fall back to the newest recce for the site to detect a
          // blocking (SUBMITTED/APPROVED) one. A failure here is non-fatal: fall through as CREATE —
          // the backend's one-live-recce constraint still guards (a duplicate comes back as a 409).
          const list = await fetchMyRecces();
          if (alive && list.success) {
            const row = findSiteRecce(list.data.recces, siteId);
            if (row) {
              const res = await fetchRecce(row.id);
              if (alive && res.success) detail = res.data;
            }
          }
        }
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

  // On resubmit the element COUNT is fixed to the original recce: render exactly one card per
  // original posm, each PRE-FILLED with (but not locked to) that posm's type + dimensions. In create
  // mode the rep builds the set freely (1–2 cards, add/remove allowed).
  const resubmitPosms = mode === 'resubmit' && existing ? existing.posms : null;
  const cardCount = resubmitPosms ? resubmitPosms.length : count;

  // When the resubmit context resolves, size the per-card state array to the original posm count
  // (one slot per original posm) so each card reports into its own slot.
  useEffect(() => {
    if (resubmitPosms) {
      setStates(resubmitPosms.map(() => EMPTY_STATE));
      setExpandedIndex(0);
    }
    // Keyed on the resolved recce id — runs once per loaded resubmit recce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existing?.id]);

  // Seed the editable outlet-name field once: a prior correction on resubmit, else the master name.
  useEffect(() => {
    if (seededName.current) return;
    const seed = existing?.observedOutletName ?? site?.name ?? existing?.site.name;
    if (seed) {
      setOutletNameInput(seed);
      seededName.current = true;
    }
  }, [existing, site]);

  const setStateAt = useCallback((i: number, s: PosmCaptureState) => {
    setStates((prev) => {
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }, []);

  const active = states.slice(0, cardCount);
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
      const outletName = outletNameInput.trim() || undefined;
      const res = isResubmit
        ? await resubmitRecce(existing.id, readyLines, outletName)
        : await submitRecce(siteId, readyLines, outletName);
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

  // Outlet identity for the header: the authoritative per-outlet fetch, falling back to the loaded
  // recce's site (resubmit/blocked) so the name + code show even if the site fetch briefly failed.
  const outlet = site ?? (existing ? { name: existing.site.name, code: existing.site.code } : null);

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
      {outlet && (
        <p className="mt-1 text-sm text-gray-500">
          {outlet.name} <span className="font-mono text-gray-400">· {outlet.code}</span>
        </p>
      )}
      <p className="mt-1 text-sm text-gray-500">
        {mode === 'resubmit'
          ? 'Fix what the reviewer flagged, then re-submit this outlet’s recce.'
          : 'Capture 1–2 Element lines for this outlet.'}
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
            This outlet already has a <span className="font-semibold">{existing.status.toLowerCase()}</span> recce, which
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
          {Array.from({ length: cardCount }).map((_, i) => {
            const original = resubmitPosms?.[i];
            return (
              <PosmCaptureCard
                key={original ? original.id : i}
                slot={i + 1}
                posmTypes={visiblePosmTypes}
                onChange={(s) => setStateAt(i, s)}
                // Resubmit: the element COUNT is fixed — one card per original element, no add/remove.
                // Create: card 2 removable.
                onRemove={!resubmitPosms && i === 1 ? removeSecond : undefined}
                collapsed={cardCount === 2 && i !== expandedIndex}
                onExpand={() => setExpandedIndex(i)}
                // Resubmit: PRE-FILL the element type + dimensions from the original posm, but leave
                // them EDITABLE so the rep can fix what the reviewer flagged (re-validated server-side).
                // Only seed the type when it's still selectable for this outlet — a type now gated out
                // (e.g. a GSB element on an outlet that revoked GSB) is left blank so the rep re-picks,
                // instead of a phantom value the picker can't show.
                initialPosmTypeId={
                  original && visiblePosmTypes.some((t) => t.id === original.posmType.id)
                    ? original.posmType.id
                    : undefined
                }
                initialWidth={original?.dimensions?.width}
                initialHeight={original?.dimensions?.height}
              />
            );
          })}

          {/* Add a second element only in create mode — on resubmit the set is fixed to the original. */}
          {!resubmitPosms && count < 2 && (
            <button
              type="button"
              onClick={addSecond}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-3.5 text-sm font-semibold text-gray-500 active:scale-[0.99] transition-transform"
            >
              <Plus className="h-4 w-4" />
              Add second Element
            </button>
          )}

          {/* Editable "as observed" outlet name — pre-filled from the master; the rep corrects it if
              the name on the shopfront differs. Stored with the recce (reviewers see it); it never
              changes the outlet master. */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <label htmlFor="outlet-name" className="mb-1.5 block text-xs font-medium text-gray-600">
              Outlet name
            </label>
            <input
              id="outlet-name"
              type="text"
              value={outletNameInput}
              onChange={(e) => setOutletNameInput(e.target.value)}
              placeholder="Enter outlet name"
              maxLength={200}
              className="w-full rounded-xl border-2 border-gray-200 px-3 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-gray-400">Pre-filled from records — edit if the outlet name differs on site.</p>
          </div>
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
