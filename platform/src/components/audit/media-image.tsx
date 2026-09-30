'use client';

/**
 * Auth-gated photo tile for the auditor console.
 *
 * Photos stream from the backend `GET /v1/media/view` (rendered through the `/api/media/view`
 * proxy path). The stream is bearer-gated, so a failed load is surfaced HONESTLY as an
 * "unavailable" state rather than a broken-image glyph — the auditor still gets every geo /
 * integrity signal from the JSON payload alongside it.
 */

import { useEffect, useRef, useState } from 'react';
import { ImageOff, Loader2, Maximize2 } from 'lucide-react';
import { toApiMediaUrl, type MediaRef } from '@/lib/audit/api';
import { useFocusTrap } from '@/components/audit/use-focus-trap';
import { MarkupOverlay } from '@/components/ui/markup-overlay';
import { parseMarkup } from '@/lib/markup';

export function MediaImage({
  photo,
  alt,
  className = '',
  onEnlarge,
  markup,
  fitToWidth = false,
}: {
  photo: MediaRef | null;
  alt: string;
  className?: string;
  onEnlarge?: (src: string, alt: string, markup?: unknown) => void;
  /**
   * Recce markup to draw OVER the loaded image (the field executive's proposed-POSM annotation).
   * When it parses to something, the image renders at NATURAL aspect (`block w-full h-auto`) so
   * the overlay's 0..1 coords align to the image box, and it is forwarded to `onEnlarge` so the
   * lightbox shows the same markings. Callers with markup should pass a `className` WITHOUT a
   * fixed `aspect-*`. Absent = unchanged behavior (install thumbnails, the "after" photo).
   */
  markup?: unknown;
  /**
   * Render at natural aspect (`block w-full h-auto`) WITHOUT markup — used by the "after" photo so
   * it sizes identically to the marked-up "before" photo in the before/after grid (both
   * natural-aspect → aligned columns; a fixed `aspect-*` would mismatch the marked-up one).
   */
  fitToWidth?: boolean;
}) {
  const parsedMarkup = parseMarkup(markup);
  const natural = !!parsedMarkup || fitToWidth;
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (!photo) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-100 text-gray-400 ${className}`}
        role="img"
        aria-label={`${alt} — no photo`}
      >
        <ImageOff className="h-6 w-6 mb-1" />
        <span className="text-[11px] font-medium">No photo</span>
      </div>
    );
  }

  const src = toApiMediaUrl(photo.viewPath);

  if (errored) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-100 text-gray-500 px-3 text-center ${className}`}
        role="img"
        aria-label={`${alt} — could not be loaded`}
      >
        <ImageOff className="h-6 w-6 mb-1 text-gray-400" />
        <span className="text-[11px] font-medium">Photo could not be loaded</span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-gray-100 ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated dynamic stream, not an optimizable static asset */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={`${
          natural ? 'block w-full h-auto' : 'h-full w-full object-contain'
        } transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* Markup overlay sibling — aligns to the image box because with markup the img is
          natural-aspect (w-full h-auto), so this wrapper's content box IS the image box. */}
      {loaded && parsedMarkup && <MarkupOverlay markup={markup} />}
      {loaded && onEnlarge && (
        <button
          type="button"
          onClick={() => onEnlarge(src, alt, markup)}
          aria-label={`Enlarge ${alt}`}
          className="absolute bottom-1.5 right-1.5 rounded-lg bg-black/50 hover:bg-black/70 text-white p-1.5 active:scale-95 transition-all"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Full-screen lightbox for an enlarged photo. */
export function Lightbox({
  src,
  alt,
  markup,
  onClose,
}: {
  src: string | null;
  alt: string;
  /** Recce markup to draw over the enlarged photo (forwarded from the tile's onEnlarge). */
  markup?: unknown;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [errored, setErrored] = useState(false);
  const open = !!src;

  // Reset the error state whenever a new photo is shown.
  useEffect(() => {
    setErrored(false);
  }, [src]);

  // Escape-to-close (unconditional — the lightbox has no in-flight action to guard).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus into the dialog on open, trap Tab, and return focus to the trigger on close.
  useFocusTrap(open, dialogRef);

  if (!src) return null;
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 fade-in focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      {errored ? (
        <div
          className="flex flex-col items-center justify-center text-gray-300 px-6 text-center"
          role="img"
          aria-label={`${alt} — could not be loaded`}
          onClick={(e) => e.stopPropagation()}
        >
          <ImageOff className="h-10 w-10 mb-2" />
          <span className="text-sm font-medium">Photo could not be loaded</span>
        </div>
      ) : (
        // Natural-aspect img (capped to the viewport, no object-contain) wrapped in a relative box
        // so the markup overlay aligns to the image content box.
        <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated dynamic stream */}
          <img
            src={src}
            alt={alt}
            onError={() => setErrored(true)}
            className="block max-h-[90vh] max-w-[92vw] rounded-lg"
          />
          <MarkupOverlay markup={markup} />
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-xl bg-white/15 hover:bg-white/25 text-white px-3 py-2 text-sm font-medium active:scale-95 transition-all"
      >
        Close
      </button>
    </div>
  );
}

export default MediaImage;
