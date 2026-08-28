'use client';

/**
 * Auth-gated photo tile for the auditor console.
 *
 * Photos stream from the backend `GET /v1/media/view` (rendered through the `/api/media/view`
 * proxy path). The stream is bearer-gated, so a failed load is surfaced HONESTLY as an
 * "unavailable" state rather than a broken-image glyph — the auditor still gets every geo /
 * integrity signal from the JSON payload alongside it.
 */

import { useState } from 'react';
import { ImageOff, Loader2, Maximize2 } from 'lucide-react';
import { toApiMediaUrl, type MediaRef } from '@/lib/audit/api';

export function MediaImage({
  photo,
  alt,
  className = '',
  onEnlarge,
}: {
  photo: MediaRef | null;
  alt: string;
  className?: string;
  onEnlarge?: (src: string, alt: string) => void;
}) {
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
        className={`h-full w-full object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {loaded && onEnlarge && (
        <button
          type="button"
          onClick={() => onEnlarge(src, alt)}
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
  onClose,
}: {
  src: string | null;
  alt: string;
  onClose: () => void;
}) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated dynamic stream */}
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain rounded-lg" />
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
