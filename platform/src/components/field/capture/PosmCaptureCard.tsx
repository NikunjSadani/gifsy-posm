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
import { Trash2, MapPin, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { CameraCapture } from './CameraCapture';
import { useGeo, formatFix, type GeoFix } from '@/lib/field/geo';
import { uploadMedia } from '@/lib/field/media-upload';

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

const UNITS = ['cm', 'in', 'ft', 'mm'] as const;

interface PosmCaptureCardProps {
  /** 1-based slot number, for the card heading. */
  slot: number;
  posmTypes: PosmTypeOption[];
  onChange: (state: PosmCaptureState) => void;
  onRemove?: () => void;
}

export function PosmCaptureCard({ slot, posmTypes, onChange, onRemove }: PosmCaptureCardProps) {
  const geo = useGeo();

  const [posmTypeId, setPosmTypeId] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [unit, setUnit] = useState<string>('cm');

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{ key: string; geo: GeoFix } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest onChange without retriggering the report effect on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const w = Number(width);
  const h = Number(height);
  const dimsValid = width !== '' && height !== '' && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const started = posmTypeId !== '' || width !== '' || height !== '' || file !== null || uploaded !== null;

  const line: CapturedReccePosm | null =
    posmTypeId && dimsValid && uploaded
      ? { posmTypeId, dimensions: { width: w, height: h, unit }, photo: { key: uploaded.key, geo: uploaded.geo } }
      : null;

  // Report state upward whenever the derived readiness changes.
  useEffect(() => {
    onChangeRef.current({ started, line, error: error ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, error, uploaded?.key, posmTypeId, width, height, unit]);

  /** Capture a fix and upload the photo. Called when a new photo file is taken. */
  const captureAndUpload = async (picked: File) => {
    setError(null);
    setUploaded(null);
    setUploading(true);
    try {
      // Grab the fix first so it is bound to THIS photo; geo failure blocks the line.
      const fix = await geo.capture();
      const { key } = await uploadMedia(picked, fix);
      setUploaded({ key, geo: fix });
    } catch (e) {
      const msg =
        (e as { message?: string })?.message ?? 'Could not attach location or upload the photo.';
      setError(msg);
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

  const retryGeoUpload = () => {
    if (file) void captureAndUpload(file);
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">POSM {slot}</h3>
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
      <label className="mb-1.5 block text-xs font-medium text-gray-600">POSM type</label>
      <select
        value={posmTypeId}
        onChange={(e) => setPosmTypeId(e.target.value)}
        className="mb-4 w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
      >
        <option value="">Select a POSM type…</option>
        {posmTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.code})
          </option>
        ))}
      </select>

      {/* Dimensions */}
      <label className="mb-1.5 block text-xs font-medium text-gray-600">Dimensions</label>
      <div className="mb-4 grid grid-cols-[1fr_1fr_auto] gap-2">
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
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="rounded-xl border-2 border-gray-200 bg-white px-2 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      {/* Photo */}
      <label className="mb-1.5 block text-xs font-medium text-gray-600">Photo</label>
      <CameraCapture value={file} onChange={onPhoto} disabled={uploading} label="Take POSM photo" />

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
    </div>
  );
}

export default PosmCaptureCard;
