'use client';

/**
 * SSR-safe geo heatmap card. The Leaflet map (`GeoMapInner`) is loaded via `next/dynamic`
 * with `ssr:false` — Leaflet touches `window` at import, so it must never render on the
 * server or the build breaks. This wrapper owns the stage filter, the legend, and the
 * loading / empty / error states so a failed geo call never blanks the dashboard.
 */

import dynamic from 'next/dynamic';
import { Loader2, AlertTriangle, MapPinOff } from 'lucide-react';
import {
  STAGE_ORDER,
  STAGE_COLORS,
  STAGE_LABELS,
  type GeoPoint,
  type AnalyticsStage,
} from '@/lib/analytics/api';

const GeoMapInner = dynamic(() => import('./GeoMapInner'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-primary)]" />
    </div>
  ),
});

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
      {STAGE_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
          <span className="h-2.5 w-2.5 rounded-full border border-white shadow-sm" style={{ backgroundColor: STAGE_COLORS[s] }} />
          {STAGE_LABELS[s]}
        </span>
      ))}
    </div>
  );
}

export function GeoMap({
  points,
  stage,
  onStageChange,
  loading,
  error,
  onRetry,
  onSelect,
  truncated,
  title = 'Site execution map',
}: {
  points: GeoPoint[] | null;
  stage: AnalyticsStage;
  onStageChange?: (stage: AnalyticsStage) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (point: GeoPoint) => void;
  /** Backend flagged the point set as capped (GEO_CAP) — show a "refine filters" notice. */
  truncated?: boolean;
  title?: string;
}) {
  const plottable = (points ?? []).filter((p) => p.lat != null && p.lng != null);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {onStageChange && (
          <div className="inline-flex rounded-xl border border-gray-200 p-0.5 text-xs">
            {(['recce', 'install'] as AnalyticsStage[]).map((s) => (
              <button
                key={s}
                onClick={() => onStageChange(s)}
                className={
                  'px-3 py-1 rounded-lg font-medium capitalize transition-colors ' +
                  (stage === s ? 'bg-[var(--brand-primary)] text-white' : 'text-gray-600 hover:text-gray-900')
                }
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-[420px] relative">
        {loading ? (
          <div className="h-full w-full flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--brand-primary)]" />
          </div>
        ) : error ? (
          <div className="h-full w-full flex flex-col items-center justify-center px-6 text-center">
            <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-gray-800">Couldn&apos;t load the map</p>
            <p className="text-sm text-gray-500 mt-1 max-w-md">{error}</p>
            {onRetry && (
              <button onClick={onRetry} className="mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline">
                Try again
              </button>
            )}
          </div>
        ) : plottable.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center justify-center px-6 text-center bg-gray-50">
            <div className="p-4 bg-gray-100 rounded-full mb-3 text-gray-400">
              <MapPinOff className="h-6 w-6" />
            </div>
            <p className="text-base font-semibold text-gray-900">No geotagged sites</p>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">
              Sites appear here once their captures carry GPS coordinates.
            </p>
          </div>
        ) : (
          <GeoMapInner points={plottable} onSelect={onSelect} />
        )}
      </div>

      {truncated && !loading && !error && (
        <div className="px-4 py-2 border-t border-amber-100 bg-amber-50 text-xs text-amber-800">
          Showing the first 5,000 sites — refine filters to see the rest.
        </div>
      )}

      <Legend />
    </div>
  );
}

export default GeoMap;
