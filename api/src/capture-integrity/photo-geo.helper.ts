/**
 * photo-geo.helper.ts — pure, dependency-free geo-fence AGGREGATION over a submission's set
 * of per-photo GPS fixes. Wraps the shared `evaluatePhotoFence`/`haversineMeters` math (from
 * capture/geo-fence.helper) with the "roll up many photos into one submission verdict" logic
 * that Recce and Installation both need — so the two lanes agree bit-for-bit. NO NestJS /
 * Prisma imports.
 *
 * Verdict rules (matches the build plan §6 anti-fraud posture):
 *   - `geoFenceOk`  = true  when a reference exists AND every valid-fix photo is INSIDE;
 *                   = false when a reference exists AND some valid-fix photo is OUTSIDE;
 *                   = null  when there is NO reference OR NO photo carries a valid fix
 *                           (unverifiable → a flag, never persisted as a pass/fail).
 *   - `anyOutside`  = a valid-fix photo lies beyond the radius (only meaningful with a
 *                     reference). The SERVICE turns this into a hard 403 WHEN the fence is
 *                     enabled; with the fence disabled it is retained only as geoFenceOk=false.
 *   - `worst`       = the representative "worst-fixed" photo — the valid-fix photo FARTHEST
 *                     from the reference (the anti-fraud worst case). Its lat/lng/accuracy/
 *                     capturedAt are what the submission stores. With a valid fix but no
 *                     reference, the first valid fix is kept (distance null).
 */

import { evaluatePhotoFence, haversineMeters, isValidGeo } from '../capture/geo-fence.helper';
import type { GpsCapture } from '../capture/visibility-types';

/** One photo's optional GPS fix (already normalized via readMediaValue). */
export interface PhotoGeoInput {
  geo?: GpsCapture;
}

/** The representative worst-fixed photo carried onto the submission row. */
export interface WorstFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string | null;
  distanceMeters: number | null;
}

/** The rolled-up geo verdict for a whole submission. */
export interface PhotoFenceAggregate {
  geoFenceOk: boolean | null;
  anyOutside: boolean;
  worst: WorstFix | null;
}

/**
 * Aggregate the per-photo fences of one submission against the site reference.
 *
 * @param photos   the submission's photos (each with an optional geo)
 * @param reference the site's authoritative {lat,lng}, or null when the site has no geo
 * @param radiusMeters the geo-fence radius
 */
export function aggregatePhotoFence(
  photos: PhotoGeoInput[],
  reference: { lat: number; lng: number } | null,
  radiusMeters: number,
): PhotoFenceAggregate {
  let anyOutside = false;
  let anyInside = false;
  let anyValid = false;
  let worst: WorstFix | null = null;
  let worstDistance = -1;

  for (const p of photos) {
    const geo = p.geo;
    if (!isValidGeo(geo)) continue; // unverifiable photo — contributes nothing to the verdict
    anyValid = true;

    const status = evaluatePhotoFence(geo, reference, radiusMeters);
    if (status === 'inside') anyInside = true;
    else if (status === 'outside') anyOutside = true;

    const distance = reference ? haversineMeters({ lat: geo.lat, lng: geo.lng }, reference) : null;
    // Pick the farthest valid fix as the representative; with no reference, keep the first.
    const isWorse = reference ? (distance as number) > worstDistance : worst === null;
    if (isWorse) {
      worstDistance = distance ?? -1;
      worst = {
        lat: geo.lat,
        lng: geo.lng,
        accuracy: typeof geo.accuracy === 'number' ? geo.accuracy : null,
        capturedAt: typeof geo.capturedAt === 'string' ? geo.capturedAt : null,
        distanceMeters: distance,
      };
    }
  }

  // No reference OR no valid fix ⇒ unverifiable ⇒ null (never a pass/fail).
  let geoFenceOk: boolean | null;
  if (!reference || !anyValid) geoFenceOk = null;
  else if (anyOutside) geoFenceOk = false;
  else geoFenceOk = anyInside ? true : null;

  return { geoFenceOk, anyOutside, worst };
}
