'use client';

/**
 * My Sites — the vendor-scoped site list. Search + filters (name / code / town / rsCode),
 * tappable cards, and a bottom-sheet detail with directions + "Start recce".
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, MapPin } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { SiteCard } from '@/components/field/site-card';
import { SiteSheet } from '@/components/field/site-sheet';
import { fetchSites, type Site, type SiteFilters } from '@/lib/field/sites';

export default function SitesPage() {
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [code, setCode] = useState('');
  const [town, setTown] = useState('');
  const [rsCode, setRsCode] = useState('');

  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Site | null>(null);

  // Debounce the filter set so typing doesn't fire a request per keystroke.
  const filters: SiteFilters = useMemo(
    () => ({ name: query.trim(), code: code.trim(), town: town.trim(), rsCode: rsCode.trim() }),
    [query, code, town, rsCode],
  );
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await fetchSites(filters);
      if (cancelled) return;
      if (res.success) {
        setSites(res.data.sites);
        setTotal(res.data.total);
        setError(null);
      } else {
        setError(res.error || 'Could not load your sites.');
        setSites([]);
        setTotal(0);
      }
      setLoading(false);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // filtersKey captures every filter value; filters is derived from the same state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const activeFilterCount = [code, town, rsCode].filter((v) => v.trim()).length;

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-gray-900">My Sites</h1>
        {!loading && !error && (
          <span className="text-xs text-gray-500">{total} total</span>
        )}
      </div>

      {/* Search + filter toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-2xl border border-gray-200 px-3 py-2.5 focus-within:border-[var(--brand-primary)] transition-colors">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="flex-1 text-sm text-gray-900 focus:outline-none bg-transparent"
          />
        </div>
        <button
          onClick={() => setShowFilters((s) => !s)}
          aria-label="Filters"
          className={`relative h-11 w-11 rounded-2xl border flex items-center justify-center active:scale-95 transition-transform ${
            showFilters || activeFilterCount
              ? 'bg-[var(--brand-primary-light)] border-[var(--brand-primary)] text-[var(--brand-primary)]'
              : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-[var(--brand-primary)] text-white text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-3 gap-2 mb-4 fade-in">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code"
            className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]"
          />
          <input
            value={town}
            onChange={(e) => setTown(e.target.value)}
            placeholder="Town"
            className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]"
          />
          <input
            value={rsCode}
            onChange={(e) => setRsCode(e.target.value)}
            placeholder="RS code"
            className="text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)]"
          />
        </div>
      )}

      {/* List states */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="text-center py-16 px-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      ) : sites.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <MapPin className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No sites found</p>
          <p className="text-xs text-gray-500 mt-1">
            {query || activeFilterCount ? 'Try a different search or filter.' : 'No sites are assigned to you yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 pb-4">
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} onClick={() => setSelected(site)} />
          ))}
        </div>
      )}

      <SiteSheet site={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
