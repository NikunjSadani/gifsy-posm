'use client';

/**
 * Side-by-side recce("before") vs install("after") comparison for one POSM — the auditor's
 * core review unit. Renders both photos with their honest geo status, the distance between the
 * two captures, and any soft integrity flags the backend raised at capture time.
 */

import { Ruler, AlertTriangle } from 'lucide-react';
import { MediaImage } from './media-image';
import { GeoBadge } from './geo-badge';
import {
  activeQualityFlags,
  distanceLabel,
  formatLatLng,
  type CompareRow,
} from '@/lib/audit/api';

/** Best-effort dimensions label from the recce POSM's JSON. */
function dimensionsLabel(dimensions: unknown): string | null {
  if (!dimensions) return null;
  if (typeof dimensions === 'string') return dimensions;
  if (typeof dimensions === 'object') {
    const d = dimensions as Record<string, unknown>;
    const w = d.width ?? d.w;
    const h = d.height ?? d.h;
    if (w != null && h != null) {
      const unit = typeof d.unit === 'string' ? ` ${d.unit}` : '';
      return `${String(w)} × ${String(h)}${unit}`;
    }
  }
  return null;
}

export function BeforeAfter({
  row,
  index,
  onEnlarge,
}: {
  row: CompareRow;
  index: number;
  onEnlarge?: (src: string, alt: string) => void;
}) {
  const dims = dimensionsLabel(row.dimensions);
  const flags = activeQualityFlags(row.qualityFlags);
  const noDiff = row.beforeAfterDiffOk !== true; // false = identical, null = not verifiable
  const recceCoords = row.reccePhoto?.geo
    ? formatLatLng(row.reccePhoto.geo.lat, row.reccePhoto.geo.lng)
    : null;
  const installCoords =
    formatLatLng(row.installGeo.lat, row.installGeo.lng) ??
    (row.installPhoto?.geo ? formatLatLng(row.installPhoto.geo.lat, row.installPhoto.geo.lng) : null);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* POSM header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {index}. {row.posmType.name}
          </p>
          <p className="text-[11px] text-gray-500 font-mono">{row.posmType.code}</p>
        </div>
        <div className="flex items-center gap-3">
          {dims && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-600">
              <Ruler className="h-3.5 w-3.5 text-gray-400" />
              {dims}
            </span>
          )}
          <GeoBadge geoFenceOk={row.geoFenceOk} />
        </div>
      </div>

      {/* Photos */}
      <div className="grid grid-cols-2 gap-px bg-gray-100">
        <figure className="bg-white">
          <div className="flex items-center justify-between px-3 pt-2.5">
            <figcaption className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              Before · Recce
            </figcaption>
          </div>
          <MediaImage
            photo={row.reccePhoto}
            alt={`Recce photo for ${row.posmType.name}`}
            className="aspect-[4/3] m-2 rounded-xl"
            onEnlarge={onEnlarge}
          />
          <p className="px-3 pb-2.5 text-[11px] text-gray-500 font-mono truncate">
            {recceCoords ?? 'No geotag'}
          </p>
        </figure>

        <figure className="bg-white">
          <div className="flex items-center justify-between px-3 pt-2.5">
            <figcaption className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              After · Installed
            </figcaption>
          </div>
          <MediaImage
            photo={row.installPhoto}
            alt={`Installation photo for ${row.posmType.name}`}
            className="aspect-[4/3] m-2 rounded-xl"
            onEnlarge={onEnlarge}
          />
          <p className="px-3 pb-2.5 text-[11px] text-gray-500 font-mono truncate">
            {installCoords ?? 'No geotag'}
          </p>
        </figure>
      </div>

      {/* Integrity signals */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100">
        <span className="text-[11px] text-gray-500">
          Recce → install distance:{' '}
          <span className="font-semibold text-gray-700">{distanceLabel(row.distanceFromRecce)}</span>
        </span>
        {noDiff && (
          <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            {row.beforeAfterDiffOk === false ? 'Identical to recce' : 'Before/after not verified'}
          </span>
        )}
        {flags.map((f) => (
          <span
            key={f}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
          >
            <AlertTriangle className="h-3 w-3" />
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

export default BeforeAfter;
