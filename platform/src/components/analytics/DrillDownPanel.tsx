'use client';

/**
 * Right-side drill-down slide-over. Opens when a funnel stage or a vendor scorecard row is
 * clicked and lists the underlying evidence records (paginated) with photo thumbnails.
 *
 * Photos come back as backend view-paths (`/v1/media/view?...`) and are rendered through the
 * `/api/media/view` proxy (auth-gated stream) via `toAnalyticsMediaUrl`; a failed load shows an
 * honest "unavailable" tile, never a broken glyph. Geo-fence status is rendered truthfully
 * (inside / outside / not-verified) — we never claim GPS is "verified".
 *
 * The records endpoint is scoped by stage + status, plus an optional admin `vendorId`. A
 * vendor-scorecard-row click passes that row's `vendorId` so the list is filtered SERVER-SIDE —
 * the header `total` and pagination stay correct across all pages (no client-side single-page
 * narrowing).
 */

import { useCallback, useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ImageOff, Loader2, AlertTriangle, Inbox } from 'lucide-react';
import {
  fetchRecords,
  geoFenceLabel,
  toAnalyticsMediaUrl,
  type AnalyticsRecord,
  type AnalyticsStage,
} from '@/lib/analytics/api';

const PAGE_SIZE = 10;

export interface DrillTarget {
  stage: AnalyticsStage;
  status?: string;
  /** Admin vendor drill-down — narrows the records list SERVER-SIDE by this vendor's id. */
  vendorId?: string;
  title: string;
}

function Thumb({ viewPath }: { viewPath: string }) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = toAnalyticsMediaUrl(viewPath);

  if (errored) {
    return (
      <div className="h-16 w-16 shrink-0 rounded-lg bg-gray-100 flex flex-col items-center justify-center text-gray-400" role="img" aria-label="Photo unavailable">
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="h-16 w-16 shrink-0 rounded-lg bg-gray-100 overflow-hidden relative">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated dynamic media stream */}
      <img
        src={src}
        alt="Capture"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={`h-full w-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

const GEO_TONE: Record<'ok' | 'bad' | 'unknown', string> = {
  ok: 'bg-emerald-50 text-emerald-700',
  bad: 'bg-red-50 text-red-700',
  unknown: 'bg-gray-100 text-gray-500',
};

function RecordRow({ r }: { r: AnalyticsRecord }) {
  const geo = geoFenceLabel(r.geoFenceOk);
  return (
    <div className="flex gap-3 py-3 border-b border-gray-100 last:border-0">
      {r.photos.length > 0 ? (
        <Thumb viewPath={r.photos[0]} />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400" role="img" aria-label="No photo">
          <ImageOff className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {r.siteName} <span className="ml-1 text-xs font-normal text-gray-400">{r.siteCode}</span>
        </p>
        <p className="text-xs text-gray-500 truncate">{r.vendorName}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-[11px] font-medium">
            {r.status}
          </span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${GEO_TONE[geo.tone]}`}>
            {geo.label}
          </span>
          {r.capturedAt && (
            <span className="text-[11px] text-gray-400">{new Date(r.capturedAt).toLocaleDateString()}</span>
          )}
          {r.photos.length > 1 && (
            <span className="text-[11px] text-gray-400">+{r.photos.length - 1} more photo{r.photos.length - 1 > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function DrillDownPanel({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AnalyticsRecord[]>([]);
  const [total, setTotal] = useState(0);

  // Reset to page 1 whenever a new target opens.
  const targetKey = target ? `${target.stage}|${target.status ?? ''}|${target.vendorId ?? ''}` : '';
  useEffect(() => {
    if (target) setPage(1);
  }, [targetKey, target]);

  const load = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setError(null);
    const res = await fetchRecords({ stage: target.stage, status: target.status, vendorId: target.vendorId, page, limit: PAGE_SIZE });
    if (res.success) {
      setItems(res.data.items);
      setTotal(res.data.total);
    } else {
      setError(res.error);
      setItems([]);
      setTotal(0);
    }
    setLoading(false);
  }, [target, page]);

  useEffect(() => {
    if (target) void load();
  }, [target, load]);

  if (!target) return null;

  const shown = items;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-label={target.title}>
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col fade-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 truncate">{target.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {loading ? 'Loading…' : `${total.toLocaleString()} record${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-gray-500 hover:bg-gray-100 active:scale-95 transition-all"
            aria-label="Close drill-down"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-[var(--brand-primary)]" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 px-2 text-center">
              <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-gray-800">Couldn&apos;t load these records</p>
              <p className="text-sm text-gray-500 mt-1">{error}</p>
              <button onClick={() => void load()} className="mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline">
                Try again
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-2 text-center">
              <div className="p-4 bg-gray-100 rounded-full mb-3 text-gray-400">
                <Inbox className="h-6 w-6" />
              </div>
              <p className="text-base font-semibold text-gray-900">No records</p>
              <p className="text-sm text-gray-500 mt-1">Nothing to show for this stage yet.</p>
            </div>
          ) : (
            <div>{shown.map((r) => <RecordRow key={r.id} r={r} />)}</div>
          )}
        </div>

        {/* Pagination */}
        {!loading && !error && total > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 disabled:text-gray-300 hover:text-gray-900"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <span className="text-xs text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 disabled:text-gray-300 hover:text-gray-900"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default DrillDownPanel;
