'use client';

import { useEffect, useRef, useState } from 'react';
import { X, ImageOff, MapPin, AlertTriangle } from 'lucide-react';
import type { ReccePosm } from '@/lib/review/api';
import { mediaSrc, dimensionsLabel, posmQualityFlags } from '@/lib/review/api';
import { cn } from '@/lib/utils';
import { MarkupOverlay } from '@/components/ui/markup-overlay';
import { useFocusTrap } from './use-focus-trap';

/**
 * POSM photo grid for a recce, with a click-to-zoom lightbox. Each tile shows the auth-gated
 * media (served through `/api/media/view`, which composites the evidence watermark), the slot
 * number, POSM type, dimensions and per-photo geo. Honest states: a slot with no photo shows a
 * placeholder; a photo that fails to load shows a broken-image state rather than a blank box.
 */
export function PhotoViewer({ posms }: { posms: ReccePosm[] }) {
  // The enlarged photo carries its markup so the lightbox shows the field's markings too.
  const [zoom, setZoom] = useState<{ key: string; markup: unknown } | null>(null);
  const [zoomErrored, setZoomErrored] = useState(false);
  const lightboxRef = useRef<HTMLDivElement | null>(null);

  // Fresh error state whenever a new photo is enlarged.
  useEffect(() => {
    setZoomErrored(false);
  }, [zoom]);

  // Escape closes the lightbox.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  // Focus moves into the lightbox on open, is trapped, and returns to the tile on close.
  useFocusTrap(zoom !== null, lightboxRef);

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
          <PosmTile key={p.id} posm={p} onZoom={(key, markup) => setZoom({ key, markup })} />
        ))}
      </div>

      {zoom && (
        <div
          ref={lightboxRef}
          tabIndex={-1}
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 outline-none"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged photo"
        >
          <button
            onClick={() => setZoom(null)}
            aria-label="Close"
            className="absolute top-4 right-4 z-10 text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 active:scale-95 transition-all"
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
            // The img sizes to its natural aspect (capped to the viewport, no object-contain), so
            // this relative wrapper's box equals the image box and the markup overlay aligns.
            <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaSrc(zoom.key)}
                alt="POSM photo (enlarged)"
                className="block max-h-[90vh] max-w-[92vw] rounded-lg"
                onError={() => setZoomErrored(true)}
              />
              <MarkupOverlay markup={zoom.markup} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function PosmTile({ posm, onZoom }: { posm: ReccePosm; onZoom: (key: string, markup: unknown) => void }) {
  const [errored, setErrored] = useState(false);
  const photo = posm.photo;
  const zoomable = !!photo && !errored;
  const dims = dimensionsLabel(posm.dimensions);
  // Advisory per-photo quality flags — informational only; they never block approve/reject.
  const qualityFlags = posmQualityFlags(posm.qualityFlags);

  const openZoom = () => {
    if (zoomable && photo) onZoom(photo.key, posm.markup);
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm">
      <div
        className={cn(
          'relative bg-gray-100 outline-none',
          // Placeholder states keep the stable 4:3 tile; a real photo renders at its natural
          // aspect (block w-full h-auto) so the markup overlay's content box matches the image.
          !zoomable && 'aspect-[4/3] flex items-center justify-center',
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
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaSrc(photo.key)}
              alt={`POSM slot ${posm.slotNo}${posm.posmType ? ` — ${posm.posmType.name}` : ''}`}
              className="block w-full h-auto"
              loading="lazy"
              onError={() => setErrored(true)}
            />
            {/* Recce markup — WHERE the install is proposed. Sibling of the img so the
                0..1 coords map to the image content box (img is w-full h-auto = the box). */}
            <MarkupOverlay markup={posm.markup} />
          </>
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
        {/* Advisory photo-quality chips (same amber pattern as the auditor's install review). */}
        {qualityFlags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {qualityFlags.map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PhotoViewer;
