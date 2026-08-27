/**
 * geo-fence.helper.ts — pure, dependency-free per-photo geo-fence math for POSM capture.
 * NO NestJS / Prisma imports so it is unit-testable and safe to import from services and
 * the report/review layer alike.
 *
 * A "photo fence" evaluates a single photo's embedded shutter-time GPS fix against the
 * site's reference location:
 *   - 'inside'       → a valid fix within `radiusMeters` of the reference;
 *   - 'outside'      → a valid fix beyond `radiusMeters` (the anti-fraud hard-block);
 *   - 'unverifiable' → no reference geo, or the photo has no / an invalid fix
 *                      (flag-for-approver, never a hard-block).
 */

import type { GpsCapture } from './visibility-types';

/** Outcome of a single fence-required photo's location check. */
export type PhotoFenceStatus = 'inside' | 'outside' | 'unverifiable';

/**
 * Great-circle distance in metres between two lat/lng points (haversine). Pure.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A usable geo fix: a non-null object whose lat/lng are finite AND within valid Earth
 * ranges (lat −90..90, lng −180..180). Garbage / out-of-range / absent fixes are NOT valid.
 */
export function isValidGeo(g: GpsCapture | null | undefined): g is GpsCapture {
  if (!g || typeof g !== 'object') return false;
  const { lat, lng } = g;
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Evaluate one fence-required photo's fix against the site reference geo.
 *
 * reference null OR geo absent/invalid → 'unverifiable' (flag, never block);
 * else 'inside' when haversine distance ≤ `radiusMeters`, otherwise 'outside'.
 */
export function evaluatePhotoFence(
  geo: GpsCapture | null | undefined,
  reference: { lat: number; lng: number } | null,
  radiusMeters: number,
): PhotoFenceStatus {
  if (!reference || !isValidGeo(geo)) return 'unverifiable';
  const distance = haversineMeters({ lat: geo.lat, lng: geo.lng }, reference);
  return distance <= radiusMeters ? 'inside' : 'outside';
}
