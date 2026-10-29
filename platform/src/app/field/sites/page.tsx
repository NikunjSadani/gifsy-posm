'use client';

/**
 * Recce to do — the vendor's outlets (for the active RS code + Beat) that still owe a recce
 * (backend filters to sites with no recce yet).
 *
 * The RS + Beat filter is now INLINE at the top of this screen (it used to be a separate
 * /field/filter landing that this page bounced to). A rep picks an RS (required) and optionally
 * narrows to one or more beats; the outlet list below refines live as they change the RS, toggle
 * beats, or type a name. With no RS picked the screen shows the picker + a prompt and no list.
 *
 * The RS/Beat choice is still persisted PER-DEVICE (localStorage, via setOutletFilter) on every
 * change so /field/work and a return visit keep reading the same selection — the same vendor login
 * is shared across many reps on different phones, so the choice must never be server-side.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MapPin, AlertCircle, RefreshCw } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select';
import { SiteCard } from '@/components/field/site-card';
import { SiteSheet } from '@/components/field/site-sheet';
import { SortToggle } from '@/components/field/sort-toggle';
import {
  fetchAllSites,
  fetchRsCodes,
  fetchBeats,
  rankByDistance,
  siteCoords,
  type Site,
  type SiteFilters,
  type RsCodeOption,
  type FieldSortMode,
} from '@/lib/field/sites';
import { useGeo } from '@/lib/field/geo';
import { getOutletFilter, setOutletFilter, clearOutletFilter } from '@/lib/field/outlet-filter';

const FIELD_CLASS =
  'w-full text-sm text-gray-900 bg-white rounded-xl border border-gray-200 pl-3 py-2.5 focus:outline-none focus:border-[var(--brand-primary)] transition-colors';

export default function SitesPage() {
  // ── The inline RS + Beat filter (persisted per-device) ──────────────────────
  const [rsCode, setRsCode] = useState('');
  const [beatNames, setBeatNames] = useState<string[]>([]);

  const [rsCodes, setRsCodes] = useState<RsCodeOption[]>([]);
  const [rsLoading, setRsLoading] = useState(true);
  const [rsError, setRsError] = useState<string | null>(null);

  const [beats, setBeats] = useState<string[]>([]);
  const [beatsLoading, setBeatsLoading] = useState(false);
  const [beatsError, setBeatsError] = useState<string | null>(null);

  // ── The outlet list ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Site | null>(null);

  // ── Sort-by-distance (reuses the shared useGeo device-location hook — no second geo path) ─────
  const { coords, loading: geoLoading, capture } = useGeo();
  // Default Nearest: with a fix the list ranks by proximity; with NO fix, nearest-mode leaves the
  // list in its natural order (rankByDistance returns unrankable items untouched) — so the default
  // is harmless until a fix arrives, and a hint invites the rep to enable location.
  const [sortMode, setSortMode] = useState<FieldSortMode>('nearest');

  // Ask for one device fix on mount; a denial/timeout just leaves `coords` null (hint shown).
  useEffect(() => {
    void capture().catch(() => {});
  }, [capture]);

  // Load the vendor's RS codes (for the first dropdown), mirroring the old filter screen.
  const loadRsCodes = async () => {
    setRsLoading(true);
    setRsError(null);
    const res = await fetchRsCodes();
    if (res.success) {
      setRsCodes(res.data.rsCodes ?? []);
    } else {
      setRsError(res.error || 'Could not load your RS codes. Please try again.');
      setRsCodes([]);
    }
    setRsLoading(false);
  };

  // Guards against an out-of-order beats response: if the rep switches RS code while a beats
  // request is in flight, the stale response must not overwrite the newer RS code's beat list
  // (which would let them filter on a mismatched RS+Beat pair).
  const beatsReq = useRef(0);

  const loadBeats = async (code: string) => {
    if (!code) {
      setBeats([]);
      return;
    }
    const seq = ++beatsReq.current;
    setBeatsLoading(true);
    setBeatsError(null);
    const res = await fetchBeats(code);
    if (seq !== beatsReq.current) return; // a newer RS selection superseded this request
    if (res.success) {
      setBeats(res.data.beats ?? []);
    } else {
      setBeatsError(res.error || 'Could not load beats for this RS code.');
      setBeats([]);
    }
    setBeatsLoading(false);
  };

  useEffect(() => {
    void loadRsCodes();
    // Pre-fill from the saved per-device filter. If an RS code was saved, load its beats so the
    // saved beats render as selected rather than being silently dropped. No redirect: this screen
    // no longer bounces to /field/filter when nothing is saved — it shows the picker inline.
    const saved = getOutletFilter();
    if (saved) {
      setRsCode(saved.rsCode);
      setBeatNames(saved.beatNames);
      void loadBeats(saved.rsCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // RS change: clear the dependent beats (their list no longer applies), reload beats, and persist
  // the new (RS, []) selection so /field/work and a return visit stay in sync.
  const onRsChange = (next: string) => {
    setRsCode(next);
    setBeatNames([]);
    setBeats([]);
    setBeatsError(null);
    if (next) {
      setOutletFilter({ rsCode: next, beatNames: [] });
      void loadBeats(next);
    } else {
      clearOutletFilter();
    }
  };

  // A saved RS that's no longer in the vendor's scope (e.g. the outlet was reassigned) would
  // otherwise sit selected and show a misleading "all caught up". Once RS options have loaded
  // cleanly, drop a committed RS that isn't among them so the rep is prompted to pick a current one.
  useEffect(() => {
    if (rsLoading || rsError || !rsCode) return;
    if (!rsCodes.some((o) => o.code === rsCode)) {
      setRsCode('');
      setBeatNames([]);
      setBeats([]);
      clearOutletFilter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rsLoading, rsError, rsCodes, rsCode]);

  // Beats change: persist the (RS, beats) selection alongside updating local state.
  const onBeatsChange = (next: string[]) => {
    setBeatNames(next);
    setOutletFilter({ rsCode, beatNames: next });
  };

  // Only fetch outlets once an RS is chosen. Beat filtering stays SERVER-SIDE (repeated
  // `beatNames` params) so it remains correct under pagination — never client-side filtering.
  const filters: SiteFilters | null = useMemo(
    () =>
      rsCode
        ? {
            name: query.trim(),
            rsCode,
            beatNames,
            // "Recce to do": only outlets that still owe a recce (backend filters on no recce).
            pendingRecce: true,
          }
        : null,
    [query, rsCode, beatNames],
  );
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!filters) return;
    let cancelled = false;
    setLoading(true);
    // Debounce so changing RS, toggling beats, or typing a name doesn't fire a request per change.
    const t = setTimeout(async () => {
      // LOAD ALL matching outlets (every page), not just the first window — a global
      // nearest-first sort is only correct over the FULL RS/Beat set.
      const res = await fetchAllSites(filters);
      if (cancelled) return;
      if (res.success) {
        setSites(res.data.sites);
        setTotal(res.data.total);
        setError(null);
      } else {
        setError(res.error || 'Could not load your outlets.');
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

  // Rank the FULL loaded set for display. Nearest-first by device distance (outlets with no
  // geotag sink to the end, tagged "No location"), or A–Z — each card carries its distance chip.
  const hasFix = !!coords;
  const ranked = useMemo(
    () =>
      rankByDistance(
        sites,
        coords ? { lat: coords.lat, lng: coords.lng } : null,
        (s) => siteCoords(s),
        (s) => s.name,
        sortMode,
      ),
    [sites, coords, sortMode],
  );

  return (
    <div className="px-4 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Recce to do</h1>
        {rsCode && !loading && !error && (
          <span className="text-xs text-gray-500">{total} to do</span>
        )}
      </div>

      {rsLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : rsError ? (
        <div className="mt-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4">
          <div className="flex items-start gap-2 text-sm text-gray-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
            <span>{rsError}</span>
          </div>
          <button
            onClick={() => void loadRsCodes()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white active:scale-95 transition-transform"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      ) : rsCodes.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <MapPin className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No outlets assigned to you yet</p>
          <p className="text-xs text-gray-500 mt-1">
            Contact your admin to get outlets assigned to your account.
          </p>
        </div>
      ) : (
        <>
          {/* Inline filter header — RS (required) + Beat (optional, disabled until an RS). */}
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700">RS</label>
              <SearchableSelect
                value={rsCode}
                onChange={onRsChange}
                options={rsCodes.map((o) => ({
                  value: o.code,
                  label: o.name ? `${o.code} — ${o.name}` : o.code,
                  keywords: `${o.code} ${o.name ?? ''}`,
                }))}
                placeholder="Select RS…"
                testIdPrefix="filter-rs"
                aria-label="RS"
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                Beat <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <SearchableMultiSelect
                values={beatNames}
                onChange={onBeatsChange}
                options={beats}
                placeholder={rsCode ? 'All beats — pick to narrow…' : 'Choose an RS first'}
                disabled={!rsCode || beatsLoading}
                testIdPrefix="filter-beat"
                aria-label="Beat"
                className={FIELD_CLASS}
              />
              {beatsLoading && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400">
                  <Spinner size="sm" />
                  Loading beats…
                </p>
              )}
              {!beatsLoading && beatsError && (
                <p className="mt-1.5 text-xs text-[var(--brand-primary)]">{beatsError}</p>
              )}
              {!beatsLoading && !beatsError && rsCode && beats.length === 0 && (
                <p className="mt-1.5 text-xs text-gray-500">No beats found for this RS code.</p>
              )}
            </div>
          </div>

          {rsCode ? (
            <>
              {/* Name search — refines the list server-side (re-fetches on change). */}
              <div className="mt-4 mb-3 flex items-center gap-2">
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

              {/* Sort control — Nearest (device distance) / A–Z. Only meaningful once outlets exist. */}
              {!loading && !error && sites.length > 0 && (
                <SortToggle
                  mode={sortMode}
                  onChange={setSortMode}
                  hasFix={hasFix}
                  locating={geoLoading}
                  onRetryLocation={() => void capture().catch(() => {})}
                  className="mb-3"
                />
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
                  <p className="text-sm font-medium text-gray-700">
                    {query ? 'No matching outlets' : 'No recces pending'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {query
                      ? 'Try a different search.'
                      : 'You’re all caught up — every outlet here has a recce.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 pb-4">
                  {ranked.map(({ item, distanceMeters }) => (
                    <SiteCard
                      key={item.id}
                      site={item}
                      distanceMeters={distanceMeters}
                      noLocation={hasFix && distanceMeters == null}
                      onClick={() => setSelected(item)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            // No RS picked yet — guide the rep to pick one; no list / no "no recces" empty state.
            <div className="mt-6 text-center px-6">
              <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-[var(--brand-primary-light)] flex items-center justify-center">
                <MapPin className="h-6 w-6 text-[var(--brand-primary)]" />
              </div>
              <p className="text-sm font-medium text-gray-700">Pick your RS to see your outlets</p>
              <p className="text-xs text-gray-500 mt-1">
                Choose your RS above to see the outlets assigned to you. Add beats to narrow it down.
              </p>
            </div>
          )}
        </>
      )}

      <SiteSheet site={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
