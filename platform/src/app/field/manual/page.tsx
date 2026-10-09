'use client';

/**
 * Manual recce — a second field-entry path for outlets that may not be in the master. The field
 * exec types a few outlet fields (only Outlet Name is required), does the IDENTICAL element
 * capture as the app recce, and the recce goes STRAIGHT to HO (no ASM).
 *
 * D6 (attach-on-existing): typing an Outlet ID that already exists warns the exec, prefills
 * name/address/phone READ-ONLY from the master, and attaches this recce to that outlet (the
 * backend provisions-or-attaches at submit). A not-found Outlet ID leaves the fields editable.
 *
 * D3 (one screen, no scroll): the outlet form and each element card are accordion sections —
 * exactly one is expanded at a time (the others collapse to a one-line summary), so adding the
 * outlet form on top of the element capture does not introduce page scroll. This reuses the same
 * collapse-to-summary pattern `PosmCaptureCard` already implements for the element lines.
 *
 * Submit → POST /api/recce/manual. The backend is the sole authority on name-required (400),
 * attach/provision, and geo — this UI makes no verified/anti-spoof claims of its own.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plus, Loader2, AlertCircle, Store, ChevronRight, CheckCircle2, Info, Lock,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import {
  PosmCaptureCard,
  type PosmTypeOption,
  type PosmCaptureState,
} from '@/components/field/capture/PosmCaptureCard';
import { submitManualRecce } from '@/lib/field/recce-api';
import { lookupSiteByOutletId, type SiteLookupMatch } from '@/lib/field/sites';

interface PosmTypeApi {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const EMPTY_STATE: PosmCaptureState = { started: false, line: null };

/** Which accordion section is expanded: the outlet form, or element card 0 / 1. */
type Expanded = 'outlet' | 0 | 1;

const FIELD_CLASS =
  'w-full rounded-xl border-2 border-gray-200 px-3 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none';

export default function ManualReccePage() {
  const router = useRouter();

  const [posmTypes, setPosmTypes] = useState<PosmTypeOption[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);

  // Outlet form.
  const [outletName, setOutletName] = useState('');
  const [outletId, setOutletId] = useState('');
  const [outletAddress, setOutletAddress] = useState('');
  const [outletPhone, setOutletPhone] = useState('');

  // Outlet-ID lookup (D6): debounced; `attached` is the matched master outlet (fields read-only).
  const [lookupLoading, setLookupLoading] = useState(false);
  const [attached, setAttached] = useState<SiteLookupMatch | null>(null);

  // Element capture (identical to the app recce).
  const [count, setCount] = useState(1);
  const [states, setStates] = useState<PosmCaptureState[]>([EMPTY_STATE, EMPTY_STATE]);
  const [expanded, setExpanded] = useState<Expanded>('outlet');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Load the tenant's POSM types (mirrors the app recce screen).
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

  // Debounced Outlet-ID lookup: a hit attaches to the existing outlet (prefill read-only); a
  // miss / empty leaves the fields editable. An out-of-order response is dropped by sequence.
  const lookupSeq = useRef(0);
  useEffect(() => {
    const code = outletId.trim();
    const seq = ++lookupSeq.current;
    if (!code) {
      setAttached(null);
      setLookupLoading(false);
      return;
    }
    setLookupLoading(true);
    const t = setTimeout(async () => {
      const res = await lookupSiteByOutletId(code);
      if (seq !== lookupSeq.current) return; // superseded by a newer keystroke
      if (res.success && res.data.exists && res.data.site) {
        setAttached(res.data.site);
      } else {
        setAttached(null);
      }
      setLookupLoading(false);
    }, 400);
    return () => clearTimeout(t);
  }, [outletId]);

  // When attached, mirror the master's fields into the (read-only) inputs so the submitted body
  // and the on-screen values agree.
  useEffect(() => {
    if (attached) {
      setOutletName(attached.name ?? '');
      setOutletAddress(attached.address ?? '');
      setOutletPhone(attached.phone ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached?.id]);

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

  const nameOk = outletName.trim() !== '';
  const canSubmit =
    nameOk && readyLines.length >= 1 && !hasIncompleteStarted && !submitting && !typesError;

  const addSecond = () => {
    setCount(2);
    setExpanded(1);
  };
  const removeSecond = () => {
    setStateAt(1, EMPTY_STATE);
    setCount(1);
    if (expanded === 1) setExpanded(0);
  };

  const submit = async () => {
    if (inFlight.current || submitting) return;
    setSubmitError(null);
    if (!nameOk) {
      setExpanded('outlet');
      toast.error('Enter the outlet name.');
      return;
    }
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
      const res = await submitManualRecce({
        outletId: outletId.trim() || undefined,
        outletName: outletName.trim(),
        outletAddress: outletAddress.trim() || undefined,
        outletPhone: outletPhone.trim() || undefined,
        posms: readyLines,
      });
      if (!res.success) {
        // 400 (missing outlet name) and any other failure surface inline + as a toast.
        const msg = res.error || 'Could not submit the manual recce. Please try again.';
        setSubmitError(msg);
        if (res.status === 400) setExpanded('outlet');
        toast.error(msg);
        return;
      }
      toast.success(
        attached
          ? `Manual recce submitted — attached to ${attached.name}.`
          : 'Manual recce submitted for Head-Office approval.',
      );
      router.push('/field/work');
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  // Collapsed outlet summary (accordion) — mirrors PosmCaptureCard's collapsed render.
  const outletSummary = [
    outletName.trim() || 'Outlet name needed',
    outletId.trim() ? `ID ${outletId.trim()}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="px-4 pt-4">
      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1 className="text-lg font-bold text-gray-900">Manual recce</h1>
      <p className="mt-1 text-sm text-gray-500">
        For an outlet that isn’t in your list. Enter the outlet, capture the Element(s), and it goes
        to Head Office for approval.
      </p>

      {typesError && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4 text-sm text-gray-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <span>{typesError}</span>
        </div>
      )}

      {submitError && !typesError && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      {typesLoading ? (
        <div className="mt-6 flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : typesError ? null : (
        <div className="mt-4 space-y-4">
          {/* ── Outlet details (accordion section) ── */}
          {expanded === 'outlet' ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Store className="h-4 w-4 text-[var(--brand-primary)]" />
                <h3 className="text-sm font-bold text-gray-900">Outlet details</h3>
              </div>

              {/* Outlet ID (optional) — drives the attach-on-existing lookup. */}
              <label htmlFor="outlet-id" className="mb-1.5 block text-xs font-medium text-gray-600">
                Outlet ID <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                id="outlet-id"
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                placeholder="If you know it"
                autoComplete="off"
                className={`${FIELD_CLASS} mb-1.5`}
              />
              <div className="mb-3 min-h-[1rem] text-xs">
                {lookupLoading && (
                  <span className="inline-flex items-center gap-1.5 text-gray-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking…
                  </span>
                )}
                {!lookupLoading && attached && (
                  <span className="inline-flex items-start gap-1.5 text-amber-700">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Outlet ID already exists — Outlet:{' '}
                      <span className="font-semibold">{attached.name}</span>. This recce will attach
                      to it; its details are filled in below.
                    </span>
                  </span>
                )}
              </div>

              {/* Outlet Name (REQUIRED) — read-only when attached to an existing outlet. */}
              <label htmlFor="outlet-name" className="mb-1.5 block text-xs font-medium text-gray-600">
                Outlet name <span className="text-[var(--brand-primary)]">*</span>
                {attached && <ReadOnlyTag />}
              </label>
              <input
                id="outlet-name"
                value={outletName}
                onChange={(e) => setOutletName(e.target.value)}
                readOnly={!!attached}
                placeholder="Outlet / shop name"
                className={`${FIELD_CLASS} mb-4 ${attached ? 'bg-gray-50 text-gray-500' : ''}`}
              />

              {/* Outlet Address (optional) */}
              <label htmlFor="outlet-address" className="mb-1.5 block text-xs font-medium text-gray-600">
                Address <span className="font-normal text-gray-400">(optional)</span>
                {attached && <ReadOnlyTag />}
              </label>
              <input
                id="outlet-address"
                value={outletAddress}
                onChange={(e) => setOutletAddress(e.target.value)}
                readOnly={!!attached}
                placeholder="Outlet address"
                className={`${FIELD_CLASS} mb-4 ${attached ? 'bg-gray-50 text-gray-500' : ''}`}
              />

              {/* Outlet Phone (optional) */}
              <label htmlFor="outlet-phone" className="mb-1.5 block text-xs font-medium text-gray-600">
                Phone <span className="font-normal text-gray-400">(optional)</span>
                {attached && <ReadOnlyTag />}
              </label>
              <input
                id="outlet-phone"
                type="tel"
                inputMode="tel"
                value={outletPhone}
                onChange={(e) => setOutletPhone(e.target.value)}
                readOnly={!!attached}
                placeholder="Outlet phone"
                className={`${FIELD_CLASS} ${attached ? 'bg-gray-50 text-gray-500' : ''}`}
              />

              <button
                type="button"
                onClick={() => setExpanded(0)}
                disabled={!nameOk}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--brand-primary)] py-2.5 text-sm font-semibold text-[var(--brand-primary)] active:scale-[0.99] transition-transform disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next: capture Element
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <OutletSummaryCard
              summary={outletSummary}
              ready={nameOk}
              attached={!!attached}
              onExpand={() => setExpanded('outlet')}
            />
          )}

          {/* ── Element cards (accordion sections) ── */}
          {Array.from({ length: count }).map((_, i) => (
            <PosmCaptureCard
              key={i}
              slot={i + 1}
              posmTypes={posmTypes}
              onChange={(s) => setStateAt(i, s)}
              onRemove={i === 1 ? removeSecond : undefined}
              collapsed={expanded !== i}
              onExpand={() => setExpanded(i as Expanded)}
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

      {!typesError && !typesLoading && (
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
            ) : (
              `Submit manual recce${readyLines.length ? ` (${readyLines.length})` : ''}`
            )}
          </button>
          {!canSubmit && !submitting && (
            <p className="mt-2 text-center text-xs text-gray-400">
              {!nameOk
                ? 'Enter the outlet name, then capture an Element with a located, marked photo.'
                : 'Add an Element type, dimensions, a located photo, and mark where it goes to enable submit.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A small "from master" read-only tag shown on prefilled (attached) outlet fields. */
function ReadOnlyTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[10px] font-semibold text-gray-400">
      <Lock className="h-2.5 w-2.5" />
      from master
    </span>
  );
}

/** Collapsed one-line outlet summary (accordion) — matches the element card's collapsed render. */
function OutletSummaryCard({
  summary,
  ready,
  attached,
  onExpand,
}: {
  summary: string;
  ready: boolean;
  attached: boolean;
  onExpand: () => void;
}) {
  const status = ready
    ? { label: attached ? 'Attached' : 'Ready', cls: 'bg-emerald-50 text-emerald-700' }
    : { label: 'Needs name', cls: 'bg-amber-50 text-amber-700' };
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">Outlet details</h3>
          <p className="mt-0.5 truncate text-xs text-gray-500">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.cls}`}>
            {status.label}
          </span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </div>
      </div>
    </button>
  );
}
