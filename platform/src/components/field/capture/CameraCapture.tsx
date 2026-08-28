'use client';

/**
 * Native camera capture — uses `<input type="file" accept="image/*" capture="environment">`
 * so it works inside an INSTALLED PWA (getUserMedia is deliberately avoided: it needs a live
 * permission/secure-context dance that a homescreen PWA handles poorly, and the OS camera app
 * gives field users the familiar full-screen capture).
 *
 * Controlled: the parent owns the `File` (`value` + `onChange`). Renders a tap-to-capture zone
 * (with an optional ghost `overlay` layered for before/after alignment) or, once a photo is
 * taken, a preview thumbnail with a Retake action.
 */

import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';

interface CameraCaptureProps {
  /** The currently captured file, or null. */
  value: File | null;
  /** Called with the picked file, or null when cleared/retaken. */
  onChange: (file: File | null) => void;
  /** Optional overlay (e.g. <GhostOverlay/>) shown over the empty capture zone for alignment. */
  overlay?: React.ReactNode;
  /** Disable capture (e.g. while uploading). */
  disabled?: boolean;
  /** Accessible label for the capture control. */
  label?: string;
}

export function CameraCapture({
  value,
  onChange,
  overlay,
  disabled = false,
  label = 'Take photo',
}: CameraCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Object-URL preview, revoked on change/unmount to avoid leaks.
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const openCamera = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // Reset the input value so re-selecting the same file still fires onChange (retake).
    e.target.value = '';
    onChange(file);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {preview ? (
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Captured photo preview" className="max-h-72 w-full object-contain" />
          <button
            type="button"
            onClick={openCamera}
            disabled={disabled}
            className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-xl bg-black/70 px-3 py-2 text-xs font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retake
          </button>
        </div>
      ) : (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50">
          {/* Ghost overlay (if any) sits under the tap target but above the background. */}
          {overlay}
          <button
            type="button"
            onClick={openCamera}
            disabled={disabled}
            aria-label={label}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-primary-light)]">
              <Camera className="h-7 w-7 text-[var(--brand-primary)]" />
            </span>
            <span className="text-sm font-semibold">{label}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default CameraCapture;
