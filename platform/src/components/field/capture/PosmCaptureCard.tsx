'use client';

/**
 * PosmCaptureCard — captures ONE recce POSM line: pick a POSM type, enter physical dimensions,
 * take a photo (native camera), auto-attach a GPS fix, and upload the photo to get its media
 * key. It manages the geo + upload lifecycle and reports its state upward via `onChange`.
 *
 * The assembled `line` is non-null ONLY when the line is fully ready: a POSM type is chosen,
 * width/height are positive numbers, and a photo has been uploaded WITH a geo fix attached —
 * exactly the shape one `posms[]` entry of the recce POST body needs
 * (`{ posmTypeId, dimensions:{width,height,unit}, photo:{key, geo} }`).
 */

import { useEffect, useRef, useState } from 'react';
import { Trash2, MapPin, Loader2, AlertCircle, CheckCircle2, TriangleAlert, RefreshCw, PenSquare, X, ChevronRight, Lock } from 'lucide-react';
import { CameraCapture } from './CameraCapture';
import { ElementBoxPlacer } from './ElementBoxPlacer';
import { MarkupOverlay } from '@/components/ui/markup-overlay';
import { useGeo, formatFix, type GeoFix } from '@/lib/field/geo';
import { uploadMedia, type MediaQuality } from '@/lib/field/media-upload';
import type { RecceMarkup } from '@/lib/markup';

export interface PosmTypeOption {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
}

/** One fully-captured recce POSM line — matches a `posms[]` entry of the recce POST body. */
export interface CapturedReccePosm {
  posmTypeId: string;
  dimensions: { width: number; height: number; unit: string };
  photo: { key: string; geo: GeoFix };
  /** On-photo annotation marking WHERE the Element goes — REQUIRED (marking is compulsory). */
  markup: RecceMarkup;
}

/** The card's reported state — the parent uses this to gate the submit button. */
export interface PosmCaptureState {
  /** True once the user has touched any field (used to warn about incomplete lines). */
  started: boolean;
  /** Non-null only when the line is fully ready to submit. */
  line: CapturedReccePosm | null;
  /** A current blocking issue (geo/upload), for the parent to reflect if needed. */
  error?: string;
}

// Recce dimensions are captured in feet (the only unit the field uses); no in-form unit picker.
const DIMENSION_UNIT = 'ft';

/**
 * Compose a plain-language advisory sentence from the set quality flags, or `null` when the
 * photo looks fine. Advisory only — this never blocks submit.
 */
function qualityWarning(quality: MediaQuality | null): string | null {
  if (!quality) return null;
  const parts: string[] = [];
  if (quality.blank) parts.push('This photo looks blank — no Element is visible');
  if (quality.blur) parts.push('This photo looks blurry');
  if (quality.lowLight) parts.push('This photo looks too dark');
  if (quality.overexposed) parts.push('This photo looks too bright');
  if (parts.length === 0) return null;
  return `${parts.join(', ')} — retake for a clearer shot.`;
}

interface PosmCaptureCardProps {
  /** 1-based slot number, for the card heading. */
  slot: number;
  posmTypes: PosmTypeOption[];
  onChange: (state: PosmCaptureState) => void;
  onRemove?: () => void;
  /** Accordion: render a compact one-line summary instead of the full form (state is kept). */
  collapsed?: boolean;
  /** Tapping a collapsed card asks the parent to expand it. */
  onExpand?: () => void;
  /** Pre-fill the Element type (used on resubmit — the original recce's POSM type). */
  initialPosmTypeId?: string;
  /** Pre-fill the width (feet), from the original recce on resubmit. */
  initialWidth?: number;
  /** Pre-fill the height (feet), from the original recce on resubmit. */
  initialHeight?: number;
  /**
   * Lock the Element type + dimensions to their pre-filled values (resubmit of a REJECTED recce):
   * the rep re-captures only the photo + element-box; the element + dims stay fixed to the
   * original submission and render as read-only (legible, not interactive).
   */
  lockElementAndDims?: boolean;
}

export function PosmCaptureCard({
  slot,
  posmTypes,
  onChange,
  onRemove,
  collapsed,
  onExpand,
  initialPosmTypeId,
  initialWidth,
  initialHeight,
  lockElementAndDims,
}: PosmCaptureCardProps) {
  const geo = useGeo();

  const [posmTypeId, setPosmTypeId] = useState(initialPosmTypeId ?? '');
  const [width, setWidth] = useState(initialWidth != null ? String(initialWidth) : '');
  const [height, setHeight] = useState(initialHeight != null ? String(initialHeight) : '');
  const unit = DIMENSION_UNIT;

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{ key: string; geo: GeoFix } | null>(null);
  const [quality, setQuality] = useState<MediaQuality | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On-photo POSM-area annotation (optional). Cleared whenever the photo changes.
  const [markup, setMarkup] = useState<RecceMarkup | null>(null);
  const [markupOpen, setMarkupOpen] = useState(false);
  const [markupUrl, setMarkupUrl] = useState<string | null>(null);

  // A persistent object-URL of the captured photo, so once the Element box is placed we can show
  // the box drawn OVER the photo (not just a text chip). Tracks `file`; revoked on change/unmount.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Keep the latest onChange without retriggering the report effect on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const w = Number(width);
  const h = Number(height);
  const dimsValid = width !== '' && height !== '' && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const started = posmTypeId !== '' || width !== '' || height !== '' || file !== null || uploaded !== null;

  // Human-readable label for the locked Element type (resubmit). Derived from the tenant's POSM
  // types; falls back to the raw code so the read-only field is never blank if the type is gated
  // out of the picker for this outlet.
  const lockedType = posmTypes.find((t) => t.id === posmTypeId);
  const lockedTypeLabel = lockedType ? `${lockedType.name} (${lockedType.code})` : posmTypeId || null;

  // Marking the photo is compulsory: a line is ready only once it also carries a markup (≥1 shape).
  const line: CapturedReccePosm | null =
    posmTypeId && dimsValid && uploaded && markup && markup.shapes.length > 0
      ? {
          posmTypeId,
          dimensions: { width: w, height: h, unit },
          photo: { key: uploaded.key, geo: uploaded.geo },
          markup,
        }
      : null;

  // Report state upward whenever the derived readiness changes.
  useEffect(() => {
    onChangeRef.current({ started, line, error: error ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, error, uploaded?.key, posmTypeId, width, height, unit, markup]);

  /** Capture a fix and upload the photo. Called when a new photo file is taken. */
  const captureAndUpload = async (picked: File) => {
    setError(null);
    setUploaded(null);
    setQuality(null);
    setUploading(true);
    try {
      // Grab the fix first so it is bound to THIS photo; geo failure blocks the line.
      const fix = await geo.capture();
      const { key, quality: q } = await uploadMedia(picked, fix);
      setUploaded({ key, geo: fix });
      setQuality(q ?? null); // advisory only — never blocks the line
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ?? 'Could not attach location or upload the photo.';
      setError(msg);
      setUploaded(null);
      setQuality(null);
    } finally {
      setUploading(false);
    }
  };

  const onPhoto = (picked: File | null) => {
    setFile(picked);
    setUploaded(null);
    setQuality(null);
    setMarkup(null); // a new/cleared photo invalidates any prior POSM-area markup
    if (picked) void captureAndUpload(picked);
    else setError(null);
  };

  const retryGeoUpload = () => {
    if (file) void captureAndUpload(file);
  };

  /** Discard the current photo so the capture zone reappears for a fresh shot. */
  const retakePhoto = () => {
    setFile(null);
    setUploaded(null);
    setQuality(null);
    setError(null);
    setMarkup(null);
  };

  // ── Element-box placement lifecycle ─────────────────────────────────────────
  /** Open the aspect-box placer over an object-URL of the captured photo. Needs valid dimensions
   *  (the box is shaped from them), so this is gated on `dimsValid` by its trigger below. */
  const openMarkup = () => {
    if (!file || !dimsValid) return;
    const url = URL.createObjectURL(file);
    setMarkupUrl(url);
    setMarkupOpen(true);
  };
  /** Revoke the object-URL and close the annotator. */
  const closeMarkup = () => {
    setMarkupOpen(false);
    if (markupUrl) URL.revokeObjectURL(markupUrl);
    setMarkupUrl(null);
  };
  const saveMarkup = (m: RecceMarkup | null) => {
    setMarkup(m);
    closeMarkup();
  };
  const clearMarkup = () => setMarkup(null);

  // Revoke a lingering object-URL if the card unmounts while the annotator is open.
  useEffect(() => {
    return () => {
      if (markupUrl) URL.revokeObjectURL(markupUrl);
    };
  }, [markupUrl]);

  const warning = qualityWarning(quality);

  // Collapsed summary (accordion): the card keeps all its captured state (the hooks above still
  // run); only its RENDER is compact. Tapping it asks the parent to expand this card.
  if (collapsed) {
    const typeName = posmTypes.find((t) => t.id === posmTypeId)?.name ?? null;
    const bits = [
      typeName ?? 'No Element type',
      dimsValid ? `${w}×${h} ft` : null,
      uploaded ? 'Photo ✓' : null,
      markup && markup.shapes.length > 0 ? 'Box placed' : null,
    ].filter(Boolean) as string[];
    const status = line
      ? { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700' }
      : started
        ? { label: 'Incomplete', cls: 'bg-amber-50 text-amber-700' }
        : { label: 'Not started', cls: 'bg-gray-100 text-gray-500' };
    return (
      <button
        type="button"
        onClick={onExpand}
        className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900">Element {slot}</h3>
            <p className="mt-0.5 truncate text-xs text-gray-500">{bits.join(' · ')}</p>
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

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">Element {slot}</h3>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 active:scale-95 transition-transform"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        )}
      </div>

      {/* POSM type */}
      <label className="mb-1.5 block text-xs font-medium text-gray-600">Element type</label>
      {lockElementAndDims ? (
        // Resubmit: the Element type is fixed to the original submission — read-only, legible.
        <div
          data-testid={`posm-type-locked-${slot}`}
          aria-label="Element type (locked)"
          className="mb-4 flex w-full items-center justify-between gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-900"
        >
          <span className="truncate">{lockedTypeLabel ?? 'Element type'}</span>
          <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        </div>
      ) : (
        <select
          value={posmTypeId}
          onChange={(e) => setPosmTypeId(e.target.value)}
          className="mb-4 w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
        >
          <option value="">Select an Element type…</option>
          {posmTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.code})
            </option>
          ))}
        </select>
      )}

      {/* Dimensions — captured in feet */}
      <label className="mb-1.5 block text-xs font-medium text-gray-600">Dimension (in Ft.)</label>
      {lockElementAndDims ? (
        // Resubmit: dimensions are fixed to the original submission — read-only, legible.
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div
            data-testid={`posm-width-locked-${slot}`}
            aria-label="Width (locked)"
            className="flex items-center justify-between gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-900"
          >
            <span className="truncate">{width || '—'} ft</span>
            <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          </div>
          <div
            data-testid={`posm-height-locked-${slot}`}
            aria-label="Height (locked)"
            className="flex items-center justify-between gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-900"
          >
            <span className="truncate">{height || '—'} ft</span>
            <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          </div>
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder="Width"
            className="w-full rounded-xl border-2 border-gray-200 px-3 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
          />
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder="Height"
            className="w-full rounded-xl border-2 border-gray-200 px-3 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
          />
        </div>
      )}

      {/* Photo */}
      <label className="mb-1.5 block text-xs font-medium text-gray-600">Photo</label>
      <CameraCapture value={file} onChange={onPhoto} disabled={uploading} label="Take Element photo" />

      {/* Status line */}
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
                <button type="button" onClick={retryGeoUpload} className="font-semibold underline">
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

      {/* Non-blocking quality advisory — the photo uploaded fine and the line stays
          submittable; this only nudges the user to retake for a clearer shot. */}
      {!uploading && !error && uploaded && warning && (
        <div
          role="status"
          className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1">{warning}</span>
          <button
            type="button"
            onClick={retakePhoto}
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-800 underline active:scale-95 transition-transform"
          >
            <RefreshCw className="h-3 w-3" />
            Retake
          </button>
        </div>
      )}

      {/* Element box — available once a photo is captured. REQUIRED (gates submit). The box is
          shaped from the entered dimensions, so it needs valid Width × Height first. */}
      {file && !uploading && (
        <div className="mt-3">
          {markup ? (
            <div className="overflow-hidden rounded-xl border border-[var(--brand-primary)]/30">
              {/* The placed Element box drawn OVER the captured photo, so the field user sees
                  exactly where they marked it — not just a "placed" text chip. The img is
                  natural-aspect (block w-full h-auto) so the overlay's 0..1 coords map to the
                  image content box (same alignment contract as the review/audit overlays). */}
              {photoUrl && (
                <div className="relative bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl}
                    alt="Captured photo with the Element box"
                    className="block h-auto w-full"
                  />
                  <MarkupOverlay markup={markup} />
                </div>
              )}
              <div className="flex items-center gap-2 bg-[var(--brand-primary-light)] px-3 py-2 text-xs text-gray-800">
                <PenSquare className="h-3.5 w-3.5 shrink-0 text-[var(--brand-primary)]" />
                <span className="flex-1 font-medium">Element box placed</span>
                <button
                  type="button"
                  onClick={openMarkup}
                  className="shrink-0 font-semibold text-[var(--brand-primary)] underline active:scale-95 transition-transform"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={clearMarkup}
                  aria-label="Clear Element box"
                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-gray-500 active:scale-95 transition-transform"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={openMarkup}
                disabled={!dimsValid}
                className="inline-flex items-center gap-1.5 rounded-xl border-2 border-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-[var(--brand-primary)] active:scale-95 transition-transform disabled:border-gray-200 disabled:text-gray-400"
              >
                <PenSquare className="h-4 w-4" />
                Place Element box
              </button>
              <p className="mt-1.5 text-xs text-[var(--brand-primary)]">
                {dimsValid
                  ? 'Required — position the box where the Element will go on the photo.'
                  : 'Enter the Width × Height above first — the box is shaped from them.'}
              </p>
            </div>
          )}
        </div>
      )}

      {markupOpen && markupUrl && (
        <ElementBoxPlacer
          imageUrl={markupUrl}
          width={w}
          height={h}
          initial={markup}
          onSave={saveMarkup}
          onCancel={closeMarkup}
        />
      )}
    </div>
  );
}

export default PosmCaptureCard;
