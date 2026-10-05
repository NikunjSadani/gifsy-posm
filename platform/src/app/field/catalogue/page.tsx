'use client';

/**
 * POSM Catalogue (field reference) — a browse-all list of the tenant's ACTIVE POSM types with their
 * reference photo, name, code and default dimensions, so a field executive can see what each POSM
 * item looks like before/while capturing. Read-only; images stream auth-gated via /api/media/view.
 */

import { useEffect, useState } from 'react';
import { Images, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Spinner } from '@/components/ui/spinner';
import { mediaViewUrl } from '@/lib/field/media-upload';

interface CatalogueItem {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  imageKey?: string | null;
  defaultDimensions?: { width: number; height: number; unit: string } | null;
}

export default function CataloguePage() {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const res = await api.get<CatalogueItem[]>('/api/posm-types');
      if (cancelled) return;
      if (res.success) {
        setItems(res.data.filter((p) => p.isActive));
        setError(null);
      } else {
        setError(res.error || 'Could not load the catalogue.');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const dims = (p: CatalogueItem) =>
    p.defaultDimensions ? `${p.defaultDimensions.width} × ${p.defaultDimensions.height} ${p.defaultDimensions.unit}` : null;

  return (
    <div className="px-4 py-5 fade-in">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-gray-900">Element Catalogue</h1>
        <p className="text-sm text-gray-500 mt-0.5">All active Element types and what they look like.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-12 px-6">
          <div className="text-3xl mb-2">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-12 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <Images className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No Element types yet</p>
          <p className="text-xs text-gray-500 mt-1">Your admin hasn’t added any Element types.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex">
              <div className="h-24 w-24 shrink-0 bg-gray-50 flex items-center justify-center">
                {p.imageKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- auth-gated media stream, not a static asset
                  <img src={mediaViewUrl(p.imageKey)} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <Images className="h-7 w-7 text-gray-300" />
                )}
              </div>
              <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center">
                <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                <p className="font-mono text-xs text-gray-500 mt-0.5 truncate">{p.code}</p>
                {dims(p) && <p className="text-xs text-gray-400 mt-1">Default size: {dims(p)}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
