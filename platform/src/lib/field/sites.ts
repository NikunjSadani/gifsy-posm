/**
 * Field-app site model + helpers.
 *
 * A "site" is a retail outlet the vendor's field user may recce/install at. The backend
 * `GET /v1/sites` list is already vendor-scoped (a VENDOR_FIELD login only ever sees its own
 * fleet), so the field app just renders what it is given.
 *
 * lat/lng arrive as Prisma Decimal values, which serialise to JSON *strings* (not numbers).
 * `siteCoords()` normalises either form to numbers and returns null when a site has no
 * geotag — a site with no coordinates can't be mapped or routed to.
 */

import { api, type ApiResponse } from '@/lib/api-client';

export type SiteStatus = 'ACTIVE' | 'INACTIVE';

/** A site row as returned by `GET /v1/sites`. */
export interface Site {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  /** Decimal → serialised as a string over JSON; may also be null. */
  lat: string | number | null;
  lng: string | number | null;
  town: string | null;
  rsCode: string | null;
  /** Human RS/distributor name (alongside the RS code). */
  rsName: string | null;
  beatName: string | null;
  /** Postal pincode. */
  pincode: string | null;
  vendorId: string | null;
  asmUserId: string | null;
  /** Whether the GSB element type may be captured at this outlet. Gates the recce element picker. */
  gsbAllowed: boolean;
  status: SiteStatus;
  /**
   * On the "Recce to do" list: true when this outlet is here because its APP recce was REJECTED
   * (needs re-capture), vs an outlet that was never recced. Only set by the pendingRecce list.
   */
  hasRejectedRecce?: boolean;
}

/** The `GET /v1/sites` envelope payload (already unwrapped by the api-client). */
export interface SiteListResult {
  sites: Site[];
  total: number;
  page: number;
  limit: number;
}

/** Filters accepted by the sites list endpoint. */
export interface SiteFilters {
  name?: string;
  code?: string;
  town?: string;
  rsCode?: string;
  /**
   * Beats are matched EXACTLY by name (there is no beatId) and are OPTIONAL + MULTI — the
   * filter-first field screen. Sent as a repeated `beatNames` query param (`?beatNames=A&beatNames=B`);
   * an empty/absent array means "all beats under the RS code".
   */
  beatNames?: string[];
  /** "Recce to do": only outlets that still owe a recce (no recce yet). */
  pendingRecce?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Fetch the vendor-scoped site list with optional filters. Returns the api-client
 * `ApiResponse` so callers can branch on `.success`.
 */
export function fetchSites(filters: SiteFilters = {}) {
  const params = new URLSearchParams();
  if (filters.name) params.set('name', filters.name);
  if (filters.code) params.set('code', filters.code);
  if (filters.town) params.set('town', filters.town);
  if (filters.rsCode) params.set('rsCode', filters.rsCode);
  // Beats are optional + multi: each selected beat becomes a repeated `beatNames` param.
  for (const b of filters.beatNames ?? []) params.append('beatNames', b);
  if (filters.pendingRecce) params.set('pendingRecce', 'true');
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 200));
  const qs = params.toString();
  return api.get<SiteListResult>(`/api/sites?${qs}`);
}

/** Page size used when draining every matching outlet (the backend list cap). */
export const SITES_PAGE_SIZE = 200;

/**
 * Fetch EVERY matching outlet across pages, not just the first window.
 *
 * A client-side global sort (e.g. nearest-first by distance from the device) is only correct
 * when the field app holds the FULL matching set — a single `fetchSites` page would sort just
 * that window and silently mis-rank an RS/Beat with more than {@link SITES_PAGE_SIZE} outlets.
 * This drains the paginated endpoint (page 1..n) until the server reports no more rows, then
 * returns the merged list. A failure on any page short-circuits to that page's error so the
 * caller surfaces it rather than sorting a partial set. (`page`/`limit` on the incoming filters
 * are ignored — this owns pagination.)
 */
export async function fetchAllSites(
  filters: Omit<SiteFilters, 'page' | 'limit'> = {},
): Promise<ApiResponse<{ sites: Site[]; total: number }>> {
  const all: Site[] = [];
  let page = 1;
  // Hard cap on iterations so a misbehaving/looping backend can never spin forever.
  for (let guard = 0; guard < 1000; guard += 1) {
    const res = await fetchSites({ ...filters, page, limit: SITES_PAGE_SIZE });
    if (!res.success) return res;
    const batch = res.data.sites ?? [];
    all.push(...batch);
    // Exhausted = a short/empty page. This is the RELIABLE signal; we do NOT stop on
    // `all.length >= total`, because an under-reported `total` would silently drop later pages.
    if (batch.length < SITES_PAGE_SIZE) {
      return { success: true, data: { sites: all, total: res.data.total ?? all.length } };
    }
    page += 1;
  }
  // Cap hit before a short page — surface an error rather than returning a partial set as "complete"
  // (which would be globally sorted as if it were the whole fleet).
  return { success: false, error: 'Too many outlets to load at once — narrow the RS/Beat filter and try again.' };
}

/**
 * Fetch ONE vendor-scoped outlet by id (`GET /v1/sites/:id`). Authoritative per-outlet read —
 * used by the recce page to resolve an outlet's `gsbAllowed` gate for the exact `siteId` instead
 * of scanning the capped list (which could miss an outlet beyond the window for a large fleet).
 * Scoped server-side to the caller's vendor/tenant: a 404 means "not your outlet". Returns the
 * api-client `ApiResponse` so callers branch on `.success`.
 */
export function fetchSite(id: string) {
  return api.get<Site>(`/api/sites/${encodeURIComponent(id)}`);
}

/**
 * One outlet matched by `GET /v1/sites/lookup?outletId=…` (the warn-and-prefill contract). Note
 * `address` is carried here (the list `Site` has no address) because the manual-recce form
 * prefills it read-only when an entered Outlet ID already exists.
 */
export interface SiteLookupMatch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  /** Whether the GSB element type may be captured at the matched (attached) outlet. */
  gsbAllowed: boolean;
}

/** `GET /v1/sites/lookup` payload — `exists` plus the matched outlet when found. */
export interface SiteLookupResult {
  exists: boolean;
  site?: SiteLookupMatch;
}

/**
 * Look up an outlet by its Outlet ID (= `Site.code`). Drives the manual-recce warn-and-prefill
 * UX (D6): a hit means the recce attaches to that existing outlet. Scoped server-side to the
 * caller's tenant/fleet. Returns the api-client `ApiResponse` so callers branch on `.success`.
 */
export function lookupSiteByOutletId(outletId: string) {
  return api.get<SiteLookupResult>(`/api/sites/lookup?outletId=${encodeURIComponent(outletId)}`);
}

/** One RS/distributor option — the code plus its (optional) human name, for labeled display. */
export interface RsCodeOption {
  code: string;
  name: string | null;
}

/**
 * Distinct, sorted RS codes available to this vendor login (for the filter-first screen's
 * first dropdown). Each carries the RS code and its human name so the dropdown can show — and
 * search by — both. Vendor-scoped server-side.
 */
export function fetchRsCodes() {
  return api.get<{ rsCodes: RsCodeOption[] }>('/api/sites/filter-options/rs-codes');
}

/**
 * Distinct, sorted beat names under a given RS code (the filter screen's second dropdown).
 * Beats have no id — they are matched by name — so this returns plain strings.
 */
export function fetchBeats(rsCode: string) {
  return api.get<{ beats: string[] }>(
    `/api/sites/filter-options/beats?rsCode=${encodeURIComponent(rsCode)}`,
  );
}

/** Normalise a site's lat/lng to numbers, or null when it has no (valid) geotag. */
export function siteCoords(site: Pick<Site, 'lat' | 'lng'>): { lat: number; lng: number } | null {
  if (site.lat == null || site.lng == null) return null;
  const lat = typeof site.lat === 'number' ? site.lat : Number(site.lat);
  const lng = typeof site.lng === 'number' ? site.lng : Number(site.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** A free Google Maps directions deep-link to a site's geotag (no API key required). */
export function directionsUrl(site: Pick<Site, 'lat' | 'lng'>): string | null {
  const c = siteCoords(site);
  if (!c) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
}

/** Hex pin colour for a site status — used by the map markers. */
export function statusPinColor(status: SiteStatus): string {
  return status === 'ACTIVE' ? '#16a34a' /* green */ : '#9ca3af' /* gray */;
}

/** A bare geographic coordinate (device fix or outlet geotag). */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance in metres between two coordinates (haversine). Pure — unit-tested.
 * Used to rank outlet lists by proximity to the device's current location.
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Human-friendly distance — "1.2 km" at 1000 m and above, "350 m" below. Pure — unit-tested. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/** How a field outlet list is ordered: nearest-first by distance, or A–Z by name. */
export type FieldSortMode = 'nearest' | 'name';

/** An item annotated with its distance from the device (null when it can't be ranked). */
export interface Ranked<T> {
  item: T;
  /** Metres from the device fix, or null when there is no fix or the item has no geotag. */
  distanceMeters: number | null;
}

/**
 * Order an outlet list for the field screens, annotating each item with its distance from the
 * device. Pure — unit-tested. Reused by BOTH the recce-to-do and installation lists.
 *
 * - Every item is tagged with `distanceMeters` whenever a `fix` is known AND `coordsOf` resolves
 *   the item's geotag — so a distance chip can render regardless of the chosen sort.
 * - `mode: 'nearest'` sorts nearest-first. Items that can't be ranked (no geotag, or no fix at
 *   all) sink to the END, keeping their original relative order (stable). With NO fix, every
 *   item is unrankable, so the list is returned in its ORIGINAL order untouched — the honest
 *   fallback when location is denied/unavailable (never reorders, never empties the list).
 * - `mode: 'name'` sorts A–Z by `nameOf` (case-insensitive), independent of any fix.
 */
export function rankByDistance<T>(
  items: T[],
  fix: LatLng | null,
  coordsOf: (item: T) => LatLng | null,
  nameOf: (item: T) => string,
  mode: FieldSortMode,
): Ranked<T>[] {
  const annotated: Ranked<T>[] = items.map((item) => {
    const c = coordsOf(item);
    return { item, distanceMeters: fix && c ? distanceMeters(fix, c) : null };
  });

  if (mode === 'name') {
    return [...annotated].sort((x, y) =>
      nameOf(x.item).localeCompare(nameOf(y.item), undefined, { sensitivity: 'base' }),
    );
  }

  // Nearest-first; unrankable items (null distance) always last, original order preserved among
  // equals (Array.prototype.sort is stable). With no fix, all are null → list returned as-is.
  return [...annotated].sort((x, y) => {
    if (x.distanceMeters == null && y.distanceMeters == null) return 0;
    if (x.distanceMeters == null) return 1;
    if (y.distanceMeters == null) return -1;
    return x.distanceMeters - y.distanceMeters;
  });
}
