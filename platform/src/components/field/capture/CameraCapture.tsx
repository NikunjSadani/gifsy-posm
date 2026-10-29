'use client';

/**
 * Live in-app camera capture (getUserMedia). Camera-ONLY: there is no file/gallery picker, so a
 * field user cannot upload a pre-existing/stale image — the photo is grabbed from a live rear
 * camera frame at the moment of capture. This is the stricter anti-fraud alternative to the
 * native `<input capture>` (which some OSes still let fall back to the photo library).
 *
 * Controlled: the parent owns the `File` (`value` + `onChange`) — the assembled File is a JPEG
 * frame. Tapping the zone opens a FULL-SCREEN camera (better framing on a phone); an optional
 * `overlay` can be layered over the live feed (e.g. a framing guide).
 *
 * Requirements + honest limits: getUserMedia needs a secure context (HTTPS, or localhost in dev)
 * and a granted camera permission. If the camera is unavailable or denied we show a clear error
 * with Retry rather than silently allowing a gallery upload. A live camera still cannot defeat a
 * determined spoofer (a rooted phone / virtual camera); the geo-fence, before≠after, duplicate-
 * hash and capture-timestamp checks remain the real backstops.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X, SwitchCamera, CircleAlert } from 'lucide-react';
import { useFocusTrap } from '@/components/audit/use-focus-trap';

interface CameraCaptureProps {
  /** The currently captured file, or null. */
  value: File | null;
  /** Called with the captured JPEG file, or null when cleared/retaken. */
  onChange: (file: File | null) => void;
  /** Optional overlay shown over the live feed (e.g. a framing guide). */
  overlay?: React.ReactNode;
  /** Disable capture (e.g. while uploading). */
  disabled?: boolean;
  /** Accessible label for the capture control. */
  label?: string;
}

type Facing = 'environment' | 'user';

function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission is blocked. Allow camera access for this site in your browser settings, then tap Retry.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is in use by another app. Close it and tap Retry.';
    default:
      return 'Could not start the camera. Check that this is a secure (https) connection with a camera, then tap Retry.';
  }
}

export function CameraCapture({
  value,
  onChange,
  overlay,
  disabled = false,
  label = 'Take photo',
}: CameraCaptureProps) {
  const [open, setOpen] = useState(false); // full-screen camera visible
  const [viewerOpen, setViewerOpen] = useState(false); // full-screen image lightbox visible
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [hasMultiple, setHasMultiple] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Object-URL preview of the captured file, revoked on change/unmount.
  useEffect(() => {
    if (!value) {
      setPreview(null);
      setViewerOpen(false); // nothing to view once the photo is cleared
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(
    async (mode: Facing) => {
      setStarting(true);
      setError(null);
      stopStream();
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode } },
          audio: false,
        });
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined); // autoplay may resolve late; ignore
        }
        // Offer the flip control only when the device actually has >1 camera.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setHasMultiple(devices.filter((d) => d.kind === 'videoinput').length > 1);
        } catch {
          setHasMultiple(false);
        }
      } catch (err) {
        stopStream();
        setError(cameraErrorMessage(err));
      } finally {
        setStarting(false);
      }
    },
    [stopStream],
  );

  const openCamera = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    void start(facing);
  }, [disabled, facing, start]);

  const closeCamera = useCallback(() => {
    stopStream();
    setOpen(false);
    setError(null);
  }, [stopStream]);

  const flip = useCallback(() => {
    const next: Facing = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void start(next);
  }, [facing, start]);

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `posm-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onChange(file);
        closeCamera();
      },
      'image/jpeg',
      0.9,
    );
  }, [onChange, closeCamera]);

  // Release the camera if the component unmounts while open.
  useEffect(() => () => stopStream(), [stopStream]);

  // A11y for both full-screen overlays: trap focus + restore on close (shared hook), and close
  // on Escape (the hook leaves Escape to the caller). Matches the auditor/ASM lightboxes.
  useFocusTrap(open, cameraRef);
  useFocusTrap(viewerOpen, viewerRef);
  useEffect(() => {
    if (!open && !viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewerOpen) setViewerOpen(false);
      else if (open) closeCamera();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, viewerOpen, closeCamera]);

  return (
    <div>
      {preview ? (
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
          {/* Tapping the thumbnail opens a full-screen lightbox (separate from the camera). */}
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label="View photo full screen"
            title="Tap to view full screen"
            className="block w-full cursor-zoom-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Captured photo preview" className="max-h-72 w-full object-contain" />
          </button>
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
        <button
          type="button"
          onClick={openCamera}
          disabled={disabled}
          aria-label={label}
          className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-primary-light)]">
            <Camera className="h-7 w-7 text-[var(--brand-primary)]" />
          </span>
          <span className="text-sm font-semibold">{label}</span>
        </button>
      )}

      {open && (
        <div ref={cameraRef} tabIndex={-1} className="fixed inset-0 z-[70] flex flex-col bg-black outline-none touch-none" role="dialog" aria-modal="true" aria-label="Camera">
          {/* Live feed (or error) */}
          <div className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {/* Alignment overlay (ghost) sits over the live feed. */}
            {overlay}

            {starting && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                Starting camera…
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center">
                <CircleAlert className="h-10 w-10 text-white/80" />
                <p className="max-w-sm text-sm text-white/90">{error}</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => void start(facing)}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 active:scale-95 transition-transform"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={closeCamera}
                    className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white active:scale-95 transition-transform"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Close (top-left) */}
            <button
              type="button"
              onClick={closeCamera}
              aria-label="Close camera"
              className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white active:scale-95 transition-transform"
            >
              <X className="h-5 w-5" />
            </button>

          </div>

          {/* Shutter bar — shutter centered, flip control to the right (kept out of the
              top corners so it never collides with the Close control). */}
          {!error && (
            <div
              className="relative flex items-center justify-center bg-black py-5"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
            >
              <button
                type="button"
                onClick={capture}
                disabled={starting}
                aria-label="Capture photo"
                className="flex h-20 w-20 items-center justify-center rounded-full ring-4 ring-white/40 disabled:opacity-40"
              >
                <span className="h-16 w-16 rounded-full bg-white active:scale-90 transition-transform" />
              </button>
              {hasMultiple && (
                <button
                  type="button"
                  onClick={flip}
                  aria-label="Switch camera"
                  className="absolute right-8 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white active:scale-95 transition-transform"
                >
                  <SwitchCamera className="h-5 w-5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Full-screen image lightbox — separate from the live camera. Tap the scrim or Close
          to dismiss; the underlying controlled value is untouched. */}
      {viewerOpen && preview && (
        <div
          ref={viewerRef}
          tabIndex={-1}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="Photo full screen"
          onClick={() => setViewerOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Captured photo, full screen"
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setViewerOpen(false)}
            aria-label="Close full screen photo"
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white active:scale-95 transition-transform"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default CameraCapture;
