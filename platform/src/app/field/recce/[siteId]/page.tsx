'use client';

/**
 * Recce capture flow — capture 1–2 POSM lines for a site, then submit the whole recce.
 *
 * Each line (PosmCaptureCard): pick POSM type + dimensions, take a photo, auto-attach a GPS
 * fix, and upload to get a media key. On submit we POST the assembled recce to `/api/recce`:
 *
 *   { siteId, posms: [ { posmTypeId, dimensions:{width,height,unit}, photo:{ key, geo } } ] }
 *
 * (1–2 lines; dimensions + photo are required per line.) Submit is disabled until at least one
 * line is fully ready with a geo fix. Success routes to /field/work.
 *
 * The backend is the sole geo-fence authority: an out-of-fence or unverifiable fix comes back
 * as a 403 we surface honestly — this UI makes no "verified"/anti-spoof claims of its own.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api-client';
import {
  PosmCaptureCard,
  type PosmTypeOption,
  type PosmCaptureState,
} from '@/components/field/capture/PosmCaptureCard';

interface PosmTypeApi {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const EMPTY_STATE: PosmCaptureState = { started: false, line: null };

export default function ReccePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = use(params);
  const router = useRouter();

  const [posmTypes, setPosmTypes] = useState<PosmTypeOption[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);

  const [count, setCount] = useState(1); // number of POSM cards (1 or 2)
  const [states, setStates] = useState<PosmCaptureState[]>([EMPTY_STATE, EMPTY_STATE]);
  const [submitting, setSubmitting] = useState(false);

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
            ? 'POSM types are not available for your account. Please ask your admin to grant access.'
            : res.error || 'Could not load POSM types. Pull to retry.',
        );
      }
      setTypesLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setStateAt = useCallback((i: number, s: PosmCaptureState) => {
    setStates((prev) => {
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }, []);

  const active = states.slice(0, count);
  const readyLines = useMemo(() => active.map((s) => s.line).filter((l): l is NonNullable<typeof l> => l !== null), [active]);
  const hasIncompleteStarted = active.some((s) => s.started && s.line === null);
  const canSubmit = readyLines.length >= 1 && !submitting && !typesError;

  const submit = async () => {
    if (readyLines.length < 1) {
      toast.error('Capture at least one POSM (type, dimensions, and a photo with location).');
      return;
    }
    if (hasIncompleteStarted) {
      toast.error('Finish or remove the incomplete POSM line before submitting.');
      return;
    }
    setSubmitting(true);
    const res = await api.post<{ id: string; status: string }>('/api/recce', {
      siteId,
      posms: readyLines,
    });
    setSubmitting(false);
    if (!res.success) {
      toast.error(res.error || 'Could not submit the recce. Please try again.');
      return;
    }
    toast.success('Recce submitted for approval.');
    router.push('/field/work');
  };

  const addSecond = () => setCount(2);
  const removeSecond = () => {
    setStateAt(1, EMPTY_STATE);
    setCount(1);
  };

  return (
    <div className="px-4 pt-4">

      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1 className="text-lg font-bold text-gray-900">New recce</h1>
      <p className="mt-1 text-sm text-gray-500">Capture 1–2 POSM lines for this site.</p>

      {typesError && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4 text-sm text-gray-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <span>{typesError}</span>
        </div>
      )}

      {typesLoading ? (
        <div className="mt-6 flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading POSM types…
        </div>
      ) : typesError ? null : (
        <div className="mt-4 space-y-4">
          {Array.from({ length: count }).map((_, i) => (
            <PosmCaptureCard
              key={i}
              slot={i + 1}
              posmTypes={posmTypes}
              onChange={(s) => setStateAt(i, s)}
              onRemove={i === 1 ? removeSecond : undefined}
            />
          ))}

          {count < 2 && (
            <button
              type="button"
              onClick={addSecond}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 py-3.5 text-sm font-semibold text-gray-500 active:scale-[0.99] transition-transform"
            >
              <Plus className="h-4 w-4" />
              Add second POSM
            </button>
          )}
        </div>
      )}

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
            `Submit recce${readyLines.length ? ` (${readyLines.length})` : ''}`
          )}
        </button>
        {!canSubmit && !submitting && !typesError && (
          <p className="mt-2 text-center text-xs text-gray-400">
            Add a POSM type, dimensions, and a located photo to enable submit.
          </p>
        )}
      </div>
    </div>
  );
}
