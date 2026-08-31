'use client';

import { useEffect, useRef, useState } from 'react';
import { X, ImageOff, MapPin } from 'lucide-react';
import type { ReccePosm } from '@/lib/review/api';
import { mediaSrc, dimensionsLabel } from '@/lib/review/api';
import { cn } from '@/lib/utils';
import { useFocusTrap } from './use-focus-trap';

/**
 * POSM photo grid for a recce, with a click-to-zoom lightbox. Each tile shows the auth-gated
 * media (served through `/api/media/view`, which composites the evidence watermark), the slot
 * number, POSM type, dimensions and per-photo geo. Honest states: a slot with no photo shows a
 * placeholder; a photo that fails to load shows a broken-image state rather than a blank box.
 */
export function PhotoViewer({ posms }: { posms: ReccePosm[] }) {
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const [zoomErrored, setZoomErrored] = useState(false);
  const lightboxRef = useRef<HTMLDivElement | null>(null);

  // Fresh error state whenever a new photo is enlarged.
  useEffect(() => {
    setZoomErrored(false);
  }, [zoomKey]);

  // Escape closes the lightbox.
  useEffect(() => {
    if (!zoomKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomKey]);

  // Focus moves into the lightbox on open, is trapped, and returns to the tile on close.
  useFocusTrap(zoomKey !== null, lightboxRef);

  if (posms.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-500">
        This recce has no POSM lines.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {posms.map((p) => (
          <PosmTile key={p.id} posm={p} onZoom={setZoomKey} />
        ))}
      </div>

      {zoomKey && (
        <div
          ref={lightboxRef}
          tabIndex={-1}
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 outline-none"
          onClick={() => setZoomKey(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged photo"
        >
          <button
            onClick={() => setZoomKey(null)}
            aria-label="Close"
            className="absolute top-4 right-4 text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 active:scale-95 transition-all"
          >
            <X className="h-6 w-6" />
          </button>
          {zoomErrored ? (
            <div
              className="flex flex-col items-center text-white/80"
              onClick={(e) => e.stopPropagation()}
            >
              <ImageOff className="h-10 w-10 mb-2" />
              <span className="text-sm">Photo failed to load</span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaSrc(zoomKey)}
              alt="POSM photo (enlarged)"
              className="max-h-[90vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
              onError={() => setZoomErrored(true)}
            />
          )}
        </div>
      )}
    </>
  );
}

function PosmTile({ posm, onZoom }: { posm: ReccePosm; onZoom: (key: string) => void }) {
  const [errored, setErrored] = useState(false);
  const photo = posm.photo;
  const zoomable = !!photo && !errored;
  const dims = dimensionsLabel(posm.dimensions);

  const openZoom = () => {
    if (zoomable && photo) onZoom(photo.key);
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm">
      <div
        className={cn(
          'relative aspect-[4/3] bg-gray-100 flex items-center justify-center outline-none',
          zoomable && 'cursor-zoom-in focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]',
        )}
        {...(zoomable
          ? {
              role: 'button' as const,
              tabIndex: 0,
              'aria-label': `Enlarge photo — slot ${posm.slotNo}${
                posm.posmType ? ` (${posm.posmType.name})` : ''
              }`,
              onClick: openZoom,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openZoom();
                }
              },
            }
          : {})}
      >
        {!photo ? (
          <div className="flex flex-col items-center text-gray-400">
            <ImageOff className="h-8 w-8 mb-1" />
            <span className="text-xs">No photo</span>
          </div>
        ) : errored ? (
          <div className="flex flex-col items-center text-gray-400">
            <ImageOff className="h-8 w-8 mb-1" />
            <span className="text-xs">Photo failed to load</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaSrc(photo.key)}
            alt={`POSM slot ${posm.slotNo}${posm.posmType ? ` — ${posm.posmType.name}` : ''}`}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        )}
        <span className="absolute top-2 left-2 bg-black/60 text-white text-xs font-semibold rounded-md px-2 py-0.5">
          Slot {posm.slotNo}
        </span>
      </div>

      <div className="p-3">
        <p className="text-sm font-semibold text-gray-900">
          {posm.posmType?.name ?? 'Unknown POSM'}
          {posm.posmType?.code && (
            <span className="ml-1 text-xs font-normal text-gray-400">({posm.posmType.code})</span>
          )}
        </p>
        {dims && (
          <p className="text-xs text-gray-500 mt-0.5">Dimensions: {dims}</p>
        )}
        {photo?.geo && (
          <p className="flex items-center gap-1 text-xs text-gray-500 mt-1">
            <MapPin className="h-3 w-3 shrink-0" />
            {photo.geo.lat.toFixed(5)}, {photo.geo.lng.toFixed(5)}
            {photo.geo.accuracy != null && ` (±${Math.round(photo.geo.accuracy)} m)`}
          </p>
        )}
      </div>
    </div>
  );
}

export default PhotoViewer;
