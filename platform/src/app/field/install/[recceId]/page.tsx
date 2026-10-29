'use client';

/**
 * Installation capture flow — for an APPROVED recce, capture the "after / installed" photo for
 * every recce POSM, shown side by side with its recce "before" reference.
 *
 * Loads the recce via `/api/recce/:id`. Installation is allowed ONLY when the recce is APPROVED
 * (the backend enforces this too); any other status shows an honest notice and no capture.
 *
 * For each recce POSM we show a two-pane card: the recce before photo (with its element box, when
 * one was drawn) on the left as a static reference, and a clean live-camera capture on the right.
 * The rep studies the reference, shoots, and compares the two halves (retaking if off). Every recce
 * POSM must be captured (the backend requires a 1:1 complete set). On submit we POST to
 * `/api/installation`:
 *
 *   { siteId, posms: [ { reccePosmId, photo:{ key, geo } } ] }
 *
 * The backend computes the geo-fence + before≠after integrity signals and may reject
 * (403 out-of-fence, or 409 "identical to recce photo"); we surface those honestly. Success
 * routes to /field/work.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  MapPin,
  CheckCircle2,
  X,
  Maximize2,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { CameraCapture } from '@/components/field/capture/CameraCapture';
import { MarkupOverlay } from '@/components/ui/markup-overlay';
import { useFocusTrap } from '@/components/audit/use-focus-trap';
import { useGeo, formatFix, type GeoFix } from '@/lib/field/geo';
import { uploadMedia, mediaViewUrl } from '@/lib/field/media-upload';

// ── Minimal FE views of the recce GET response (present() shape) ──────────────
interface RecceMediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}
interface RecceGetPosm {
  id: string;
  slotNo: number;
  posmType: { id: string; code: string; name: string };
  dimensions: { width?: number; height?: number; unit?: string } | null;
  photo: RecceMediaRef | null;
  /** The recce's on-photo element-box annotation, drawn over the reference photo during install. */
  markup: unknown;
}
interface RecceGet {
  id: string;
  status: string;
  // The Head-Office review decision — installation needs BOTH status APPROVED and this APPROVED.
  hoReviewStatus?: string;
  site: { id: string; code: string; name: string };
  posms: RecceGetPosm[];
}

/** One captured install photo, keyed by the recce POSM it fulfils. */
interface CapturedInstall {
  key: string;
  geo: GeoFix;
}

export default function InstallPage({ params }: { params: Promise<{ recceId: string }> }) {
  const { recceId } = use(params);
  const router = useRouter();

  const [recce, setRecce] = useState<RecceGet | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Per-recce-POSM captured install photo (by reccePosmId).
  const [captured, setCaptured] = useState<Record<string, CapturedInstall>>({});
  const [submitting, setSubmitting] = useState(false);
  // Synchronous in-flight guard: a fast double-tap re-enters submit() before `submitting`
  // (state) has re-rendered the disabled button, so guard on a ref set at entry.
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const res = await api.get<RecceGet>(`/api/recce/${recceId}`);
      if (!alive) return;
      if (res.success) {
        setRecce(res.data);
        setLoadError(null);
      } else {
        setLoadError(
          res.status === 404
            ? 'This recce could not be found for your account.'
            : res.error || 'Could not load the recce. Please try again.',
        );
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [recceId]);

  const setCapturedAt = useCallback((reccePosmId: string, val: CapturedInstall | null) => {
    setCaptured((prev) => {
      const next = { ...prev };
      if (val) next[reccePosmId] = val;
      else delete next[reccePosmId];
      return next;
    });
  }, []);

  const posms = recce?.posms ?? [];
  // Installation unlocks ONLY when the recce is approved by BOTH the ASM (status) and Head Office
  // (hoReviewStatus); an ASM-approved recce still awaiting HO is not yet installable.
  const isApproved = recce?.status === 'APPROVED' && recce?.hoReviewStatus === 'APPROVED';
  const allCaptured = posms.length > 0 && posms.every((p) => captured[p.id]);
  const canSubmit = isApproved && allCaptured && !submitting;

  const submit = async () => {
    if (inFlight.current || submitting) return; // synchronous double-tap guard
    if (!recce) return;
    if (!allCaptured) {
      toast.error('Capture an installed photo for every Element before submitting.');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const res = await api.post<{ id: string; status: string }>('/api/installation', {
        // Recce-keyed install (R1): an outlet can have many approved recces (1 app + N manual), so
        // the install must name WHICH recce it fulfils. `siteId` is kept for back-compat.
        recceId: recce.id,
        siteId: recce.site.id,
        posms: posms.map((p) => ({
          reccePosmId: p.id,
          photo: { key: captured[p.id].key, geo: captured[p.id].geo },
        })),
      });
      if (!res.success) {
        toast.error(res.error || 'Could not submit the installation. Please try again.');
        return;
      }
      toast.success('Installation submitted.');
      router.push('/field/work');
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
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

      <h1 className="text-lg font-bold text-gray-900">Installation</h1>
      {recce && (
        <p className="mt-1 text-sm text-gray-500">
          {recce.site.name} <span className="font-mono text-gray-400">· {recce.site.code}</span>
        </p>
      )}

      {loading && (
        <div className="mt-6 flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading recce…
        </div>
      )}

      {!loading && loadError && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4 text-sm text-gray-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <span>{loadError}</span>
        </div>
      )}

      {!loading && recce && !isApproved && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {recce.status === 'APPROVED' && recce.hoReviewStatus !== 'APPROVED' ? (
            <span>
              This recce is <span className="font-semibold">approved by the ASM</span> but still
              awaiting <span className="font-semibold">Head-Office approval</span>. Installation opens
              once Head Office approves it.
            </span>
          ) : (
            <span>
              This recce is <span className="font-semibold">{recce.status}</span>. Installation opens
              once the recce is approved by the ASM and Head Office.
            </span>
          )}
        </div>
      )}

      {!loading && recce && isApproved && (
        <>
          <p className="mt-4 text-sm text-gray-600">
            For each Element, its recce reference photo is shown beside the capture — match it, then
            take the installed photo. Location is attached automatically.
          </p>
          <div className="mt-4 space-y-4">
            {posms.map((p) => (
              <InstallPosmCapture
                key={p.id}
                posm={p}
                onChange={(val) => setCapturedAt(p.id, val)}
              />
            ))}
          </div>

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
                'Submit installation'
              )}
            </button>
            {!allCaptured && !submitting && (
              <p className="mt-2 text-center text-xs text-gray-400">
                Capture an installed photo for every Element to enable submit.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── One recce POSM's install capture (ghost overlay + geo + upload) ───────────
function InstallPosmCapture({
  posm,
  onChange,
}: {
  posm: RecceGetPosm;
  onChange: (val: CapturedInstall | null) => void;
}) {
  const geo = useGeo();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<CapturedInstall | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onChangeRef.current(uploaded);
  }, [uploaded]);

  // Full-screen lightbox of the recce reference photo (detail inspection).
  const [refViewerOpen, setRefViewerOpen] = useState(false);
  const refViewerRef = useRef<HTMLDivElement>(null);
  // Trap focus inside the open lightbox + restore on close — matches the CameraCapture lightboxes.
  useFocusTrap(refViewerOpen, refViewerRef);

  const beforeUrl = useMemo(
    () => (posm.photo?.key ? mediaViewUrl(posm.photo.key) : null),
    [posm.photo?.key],
  );

  const captureAndUpload = async (picked: File) => {
    setError(null);
    setUploaded(null);
    setUploading(true);
    try {
      const fix = await geo.capture();
      const { key } = await uploadMedia(picked, fix);
      setUploaded({ key, geo: fix });
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not attach location or upload the photo.');
      setUploaded(null);
    } finally {
      setUploading(false);
    }
  };

  const onPhoto = (picked: File | null) => {
    setFile(picked);
    setUploaded(null);
    if (picked) void captureAndUpload(picked);
    else setError(null);
  };

  // Close the reference lightbox on Escape.
  useEffect(() => {
    if (!refViewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRefViewerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [refViewerOpen]);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">
          Element {posm.slotNo}: {posm.posmType.name}
        </h3>
        <span className="font-mono text-[11px] text-gray-400">{posm.posmType.code}</span>
      </div>

      {/* Two-pane compare: the recce reference (with its element box, when one was drawn) beside
          the installed-photo capture. The live camera no longer carries a ghost overlay — the rep
          studies the reference here, shoots clean, and compares the two halves side by side,
          retaking if off. `items-start` keeps a shorter pane from stretching to the taller one. */}
      <div className="grid grid-cols-2 items-start gap-3">
        {/* Recce reference */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-600">Recce reference</p>
          {beforeUrl ? (
            <button
              type="button"
              onClick={() => setRefViewerOpen(true)}
              aria-label="View the recce reference full screen"
              title="Tap to enlarge"
              className="relative block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 active:scale-[0.98] transition-transform"
            >
              {/* Natural-aspect image (block/h-auto/w-full) so MarkupOverlay's 0..1 box maps to the
                  photo's content box — the same contract the recce capture card uses. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={beforeUrl} alt="Recce reference photo" className="block h-auto w-full" />
              <MarkupOverlay markup={posm.markup} />
              {/* Visible tap-to-enlarge affordance — on touch there's no hover/cursor cue, and the
                  pane is small (~150px), so signal it explicitly. */}
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-lg bg-black/60 px-1.5 py-1 text-[10px] font-semibold text-white">
                <Maximize2 className="h-3 w-3" />
                Tap
              </span>
            </button>
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-3 text-center text-xs text-gray-400">
              No recce photo on file
            </div>
          )}
        </div>

        {/* Installed photo — clean live camera (no ghost). */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-600">Installed photo</p>
          <CameraCapture
            value={file}
            onChange={onPhoto}
            disabled={uploading}
            label="Take installed photo"
          />
        </div>
      </div>

      <div className="mt-3 min-h-[1.25rem] text-xs">
        {uploading && (
          <span className="inline-flex items-center gap-1.5 text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Getting location &amp; uploading…
          </span>
        )}
        {!uploading && error && (
          <div className="flex items-start gap-1.5 text-[var(--brand-primary)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              {error}{' '}
              {file && (
                <button
                  type="button"
                  onClick={() => file && captureAndUpload(file)}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              )}
            </span>
          </div>
        )}
        {!uploading && !error && uploaded && (
          <span className="inline-flex items-center gap-1.5 text-[var(--brand-confirm)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Uploaded
            <span className="inline-flex items-center gap-1 text-gray-400">
              <MapPin className="h-3 w-3" />
              {formatFix(uploaded.geo)}
            </span>
          </span>
        )}
      </div>

      {/* Full-screen lightbox of the recce reference (with its box) for detail inspection. */}
      {refViewerOpen && beforeUrl && (
        <div
          ref={refViewerRef}
          tabIndex={-1}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="Recce reference, full screen"
          onClick={() => setRefViewerOpen(false)}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={beforeUrl}
              alt="Recce reference photo, full screen"
              className="block max-h-[100svh] w-auto max-w-full object-contain"
            />
            {/* The box overlay tracks the image's own box; wrapping tightly around the <img>
                keeps the 0..1 coords aligned even when letterboxed by the viewport. */}
            <MarkupOverlay markup={posm.markup} />
          </div>
          <button
            type="button"
            onClick={() => setRefViewerOpen(false)}
            aria-label="Close full screen reference"
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white active:scale-95 transition-transform"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
