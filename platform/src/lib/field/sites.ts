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

import { api } from '@/lib/api-client';

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
  vendorId: string | null;
  asmUserId: string | null;
  status: SiteStatus;
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
  if (filters.pendingRecce) params.set('pendingRecce', 'true');
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 200));
  const qs = params.toString();
  return api.get<SiteListResult>(`/api/sites?${qs}`);
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

/**
 * Great-circle distance in metres between two coordinates (haversine). Used to sort the
 * "nearby" list by proximity to the device.
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Human-friendly distance ("320 m", "1.4 km"). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}
