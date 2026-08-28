'use client';

/**
 * Renders one submission answer against the field it answers. Text-like answers show as
 * formatted text; a CAMERA answer renders the photo (via the media view proxy) with its
 * geo, if any; a GPS_POINT shows the lat/lng. Missing answers render an em-dash.
 */

import { useState } from 'react';
import { MapPin, ImageOff } from 'lucide-react';
import {
  type SubmissionValueRow,
  formatAnswer,
  readGps,
  readMedia,
  resolveMediaUrl,
} from '@/lib/manual/admin-api';
import { MEDIA_FIELD_TYPES, FIELD_TYPE_LABELS } from '@/lib/manual/form-types';

function GeoLine({ lat, lng, accuracy }: { lat: number; lng: number; accuracy?: number }) {
  return (
    <p className="mt-1.5 flex items-center gap-1 text-xs text-gray-500">
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      <span className="font-mono">
        {lat.toFixed(6)}, {lng.toFixed(6)}
      </span>
      {typeof accuracy === 'number' && <span>· ±{Math.round(accuracy)} m</span>}
    </p>
  );
}

function PhotoAnswer({ row }: { row: SubmissionValueRow }) {
  const [broken, setBroken] = useState(false);
  const media = row.media ?? readMedia(row.value);
  const url = resolveMediaUrl(media as { key: string; viewPath?: string | null } | null);
  const geo = row.media?.geo ?? media?.geo ?? null;

  if (!url) {
    return <p className="text-sm text-gray-400 italic">No photo captured</p>;
  }
  if (broken) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <ImageOff className="h-4 w-4" />
        Photo could not be loaded.
      </div>
    );
  }
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Submitted photo"
        onError={() => setBroken(true)}
        className="max-h-80 w-auto max-w-full rounded-xl border border-gray-200 object-contain"
      />
      {geo && typeof geo.lat === 'number' && typeof geo.lng === 'number' && (
        <GeoLine lat={geo.lat} lng={geo.lng} accuracy={geo.accuracy} />
      )}
    </div>
  );
}

export function AnswerViewer({ row }: { row: SubmissionValueRow }) {
  const { field, value } = row;
  const isMedia = MEDIA_FIELD_TYPES.has(field.type);
  const isGps = field.type === 'GPS_POINT';

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-medium text-gray-800">{field.label || '(untitled field)'}</p>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {FIELD_TYPE_LABELS[field.type]}
        </span>
        {field.required && <span className="text-[10px] font-medium text-[var(--brand-primary)]">Required</span>}
      </div>
      <div className="mt-1.5">
        {isMedia ? (
          <PhotoAnswer row={row} />
        ) : isGps ? (
          (() => {
            const g = readGps(value);
            return g ? (
              <GeoLine lat={g.lat} lng={g.lng} accuracy={g.accuracy} />
            ) : (
              <p className="text-sm text-gray-400">—</p>
            );
          })()
        ) : (
          <p className="whitespace-pre-wrap text-sm text-gray-900">{formatAnswer(field, value)}</p>
        )}
      </div>
    </div>
  );
}

export default AnswerViewer;
