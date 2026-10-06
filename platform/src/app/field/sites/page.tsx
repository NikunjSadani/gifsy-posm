'use client';

/**
 * Recce to do — the vendor's outlets (for the active RS code + Beat) that still owe a recce
 * (backend filters to sites with no recce yet). The screen is gated on the per-device outlet
 * filter: with none set the rep is sent to /field/filter to choose one. A name search, an
 * active-filter chip (with "Change"), tappable cards and a bottom-sheet detail round it out.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, SlidersHorizontal } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { SiteCard } from '@/components/field/site-card';
import { SiteSheet } from '@/components/field/site-sheet';
import { fetchSites, type Site, type SiteFilters } from '@/lib/field/sites';
import { getOutletFilter, type OutletFilter } from '@/lib/field/outlet-filter';

export default function SitesPage() {
  const router = useRouter();

  // `undefined` = not yet read; `null` = read, none set (redirecting away); object = active.
  const [outlet, setOutlet] = useState<OutletFilter | null | undefined>(undefined);

  const [query, setQuery] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Site | null>(null);

  // Gate: a device with no outlet filter is sent to the filter screen before any list loads.
  useEffect(() => {
    const f = getOutletFilter();
    if (!f) {
      setOutlet(null);
      router.replace('/field/filter');
      return;
    }
    setOutlet(f);
  }, [router]);

  // Debounce the filter set so typing doesn't fire a request per keystroke.
  const filters: SiteFilters | null = useMemo(
    () =>
      outlet
        ? {
            name: query.trim(),
            rsCode: outlet.rsCode,
            beatName: outlet.beatName,
            // "Recce to do": only outlets that still owe a recce (backend filters on no recce).
            pendingRecce: true,
          }
        : null,
    [query, outlet],
  );
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!filters) return;
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

  // Until the device filter has been read (and while redirecting when none is set), show a
  // spinner rather than flashing an empty list.
  if (outlet === undefined || outlet === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-gray-900">Recce to do</h1>
        {!loading && !error && <span className="text-xs text-gray-500">{total} to do</span>}
      </div>

      {/* Active outlet filter — RS code · Beat, with a Change control. */}
      <button
        type="button"
        onClick={() => router.push('/field/filter')}
        data-testid="sites-filter-chip"
        className="mb-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] px-3 py-2.5 text-left active:scale-[0.99] transition-transform"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <span className="truncate">
            RS <span className="font-semibold">{outlet.rsCode}</span> · Beat{' '}
            <span className="font-semibold">{outlet.beatName}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold text-[var(--brand-primary)]">Change</span>
      </button>

      {/* Name search */}
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
      </div>

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
          <p className="text-sm font-medium text-gray-700">
            {query ? 'No matching outlets' : 'No recces pending'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {query
              ? 'Try a different search.'
              : 'You’re all caught up — every outlet on this beat has a recce.'}
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
