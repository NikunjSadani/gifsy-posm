'use client';

/**
 * FieldInput — renders ONE manual-task form field to the right control and reports its value
 * up via `onChange(fieldId, value)`. Controlled: the parent form owns the whole `FormValues`
 * map; this component never holds the answer for the simple types.
 *
 * Type → control:
 *   TEXT         → text input
 *   TEXTAREA     → textarea
 *   NUMBER       → numeric input (stored as a number, or null when blank)
 *   DATE         → date input (ISO yyyy-mm-dd string)
 *   DROPDOWN     → native select (one of options)
 *   MULTI_SELECT → checkbox list (string[])
 *   TOGGLE       → Yes / No segmented switch (boolean)
 *   CAMERA       → native camera (CameraCapture) + optional auto-geo, uploads to a media key,
 *                  stores { key, geo? }; owns its own file/upload/geo lifecycle
 *   GPS_POINT    → "Capture location" button (useGeo), stores { lat, lng, accuracy?, capturedAt? }
 *
 * Media/GPS controls manage their own async state and disable themselves while busy. Honest
 * copy throughout — GPS is captured and shown (lat/lng/±accuracy), never claimed "verified"
 * (a browser PWA can't detect a mock provider).
 */

import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, AlertCircle, CheckCircle2, Crosshair } from 'lucide-react';
import { CameraCapture } from '@/components/field/capture/CameraCapture';
import { useGeo, formatFix, type GeoFix } from '@/lib/field/geo';
import { uploadMedia } from '@/lib/field/media-upload';
import type { FormField, FormValue, MediaValue, GpsCapture } from '@/lib/manual/form-types';

interface FieldInputProps {
  field: FormField;
  value: FormValue | undefined;
  onChange: (fieldId: string, value: FormValue) => void;
  /** Read-only render (task under review / approved). */
  disabled?: boolean;
}

const INPUT_CLASS =
  'w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none disabled:bg-gray-50 disabled:text-gray-500';

export function FieldInput({ field, value, onChange, disabled = false }: FieldInputProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-gray-800">
        {field.label}
        {field.required && <span className="ml-1 text-[var(--brand-primary)]">*</span>}
      </label>
      {field.helpText && <p className="mb-2 text-xs text-gray-500">{field.helpText}</p>}
      <FieldControl field={field} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function FieldControl({ field, value, onChange, disabled }: Required<Pick<FieldInputProps, 'disabled'>> & FieldInputProps) {
  switch (field.type) {
    case 'TEXT':
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.id, e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          className={INPUT_CLASS}
        />
      );

    case 'TEXTAREA':
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.id, e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          rows={4}
          className={INPUT_CLASS}
        />
      );

    case 'NUMBER':
      return (
        <input
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(field.id, null);
            const n = Number(raw);
            onChange(field.id, Number.isFinite(n) ? n : null);
          }}
          placeholder={field.placeholder}
          disabled={disabled}
          className={INPUT_CLASS}
        />
      );

    case 'DATE':
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.id, e.target.value || null)}
          disabled={disabled}
          className={INPUT_CLASS}
        />
      );

    case 'DROPDOWN':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(field.id, e.target.value || null)}
          disabled={disabled}
          className={INPUT_CLASS}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case 'MULTI_SELECT':
      return <MultiSelectControl field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'TOGGLE':
      return <ToggleControl field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'CAMERA':
      return <CameraField field={field} value={value} onChange={onChange} disabled={disabled} />;

    case 'GPS_POINT':
      return <GpsField field={field} value={value} onChange={onChange} disabled={disabled} />;

    default:
      return null;
  }
}

/* ─── MULTI_SELECT ──────────────────────────────────────────────────────────── */

function MultiSelectControl({ field, value, onChange, disabled }: FieldInputProps & { disabled: boolean }) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (opt: string) => {
    if (disabled) return;
    const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
    onChange(field.id, next);
  };
  return (
    <div className="space-y-2">
      {(field.options ?? []).map((opt) => {
        const checked = selected.includes(opt);
        return (
          <label
            key={opt}
            className={`flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-sm transition-colors ${
              checked ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-light)]' : 'border-gray-200 bg-white'
            } ${disabled ? 'opacity-60' : 'cursor-pointer active:scale-[0.99]'}`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(opt)}
              disabled={disabled}
              className="h-4 w-4 flex-none accent-[var(--brand-primary)]"
            />
            <span className="text-gray-800">{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

/* ─── TOGGLE ────────────────────────────────────────────────────────────────── */

function ToggleControl({ field, value, onChange, disabled }: FieldInputProps & { disabled: boolean }) {
  const isBool = typeof value === 'boolean';
  const set = (v: boolean) => !disabled && onChange(field.id, v);
  return (
    <div className="grid grid-cols-2 gap-2">
      {([
        { label: 'Yes', v: true },
        { label: 'No', v: false },
      ] as const).map(({ label, v }) => {
        const active = isBool && value === v;
        return (
          <button
            key={label}
            type="button"
            onClick={() => set(v)}
            disabled={disabled}
            className={`rounded-xl border-2 py-3 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60 ${
              active
                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-light)] text-[var(--brand-primary)]'
                : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── CAMERA ────────────────────────────────────────────────────────────────── */

function CameraField({ field, value, onChange, disabled }: FieldInputProps & { disabled: boolean }) {
  const geo = useGeo();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = value && typeof value === 'object' && 'key' in (value as object) ? (value as MediaValue) : null;

  // Keep the latest onChange without retriggering effects.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const captureAndUpload = async (picked: File) => {
    setError(null);
    setUploading(true);
    try {
      // When the field is geotagged, bind a fix to THIS photo (failure blocks the photo).
      const fix: GeoFix | undefined = field.geotag ? await geo.capture() : undefined;
      const { key } = await uploadMedia(picked, fix);
      const media: MediaValue = fix ? { key, geo: fix } : { key };
      onChangeRef.current(field.id, media);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'Could not upload the photo.';
      setError(msg);
      onChangeRef.current(field.id, null);
    } finally {
      setUploading(false);
    }
  };

  const onPhoto = (picked: File | null) => {
    setFile(picked);
    if (picked) void captureAndUpload(picked);
    else {
      setError(null);
      onChange(field.id, null);
    }
  };

  const retry = () => {
    if (file) void captureAndUpload(file);
  };

  if (disabled) {
    // Read-only: show whether a photo is on file + its geo, but no camera.
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        {stored ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--brand-confirm)]">
            <CheckCircle2 className="h-4 w-4" />
            Photo submitted
            {stored.geo && (
              <span className="inline-flex items-center gap-1 text-gray-400">
                <MapPin className="h-3 w-3" />
                {formatFix(stored.geo)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-gray-400">No photo</span>
        )}
      </div>
    );
  }

  return (
    <div>
      {field.instruction && <p className="mb-2 text-xs text-gray-500">{field.instruction}</p>}
      <CameraCapture
        value={file}
        onChange={onPhoto}
        disabled={uploading}
        label="Take photo"
      />
      <div className="mt-2 min-h-[1.25rem] text-xs">
        {uploading && (
          <span className="inline-flex items-center gap-1.5 text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {field.geotag ? 'Getting location & uploading…' : 'Uploading…'}
          </span>
        )}
        {!uploading && error && (
          <div className="flex items-start gap-1.5 text-[var(--brand-primary)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              {error}{' '}
              {file && (
                <button type="button" onClick={retry} className="font-semibold underline">
                  Retry
                </button>
              )}
            </span>
          </div>
        )}
        {!uploading && !error && stored && (
          <span className="inline-flex items-center gap-1.5 text-[var(--brand-confirm)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Uploaded
            {stored.geo && (
              <span className="inline-flex items-center gap-1 text-gray-400">
                <MapPin className="h-3 w-3" />
                {formatFix(stored.geo)}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── GPS_POINT ─────────────────────────────────────────────────────────────── */

function GpsField({ field, value, onChange, disabled }: FieldInputProps & { disabled: boolean }) {
  const geo = useGeo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GpsCapture is not enumerated in the shared FormValue union (the backend still accepts the
  // {lat,lng,…} object and `hasValue` checks it via `'lat' in v`), so we bridge with an
  // `unknown` cast — mirroring how form-types' own hasValue treats a GPS value as `object`.
  const fix =
    value && typeof value === 'object' && 'lat' in (value as object)
      ? (value as unknown as GpsCapture)
      : null;

  const capture = async () => {
    setError(null);
    setBusy(true);
    try {
      const f = await geo.capture();
      const captured: GpsCapture = {
        lat: f.lat,
        lng: f.lng,
        accuracy: f.accuracy,
        capturedAt: f.capturedAt,
      };
      onChange(field.id, captured as unknown as FormValue);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not get your location. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (disabled) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        {fix ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-gray-400" />
            {formatFix(fix)}
          </span>
        ) : (
          <span className="text-gray-400">No location captured</span>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={capture}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 transition-all active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Getting location…
          </>
        ) : (
          <>
            <Crosshair className="h-4 w-4 text-[var(--brand-primary)]" />
            {fix ? 'Re-capture location' : 'Capture location'}
          </>
        )}
      </button>
      <div className="mt-2 min-h-[1.25rem] text-xs">
        {!busy && error && (
          <div className="flex items-start gap-1.5 text-[var(--brand-primary)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}
        {!busy && !error && fix && (
          <span className="inline-flex items-center gap-1.5 text-[var(--brand-confirm)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="inline-flex items-center gap-1 text-gray-500">
              <MapPin className="h-3 w-3" />
              {formatFix(fix)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

export default FieldInput;
