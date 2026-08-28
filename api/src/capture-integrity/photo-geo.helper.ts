/**
 * photo-geo.helper.ts — pure, dependency-free geo-fence AGGREGATION over a submission's set
 * of per-photo GPS fixes. Wraps the shared `evaluatePhotoFence`/`haversineMeters` math (from
 * capture/geo-fence.helper) with the "roll up many photos into one submission verdict" logic
 * that Recce and Installation both need — so the two lanes agree bit-for-bit. NO NestJS /
 * Prisma imports.
 *
 * Verdict rules (matches the build plan §6 anti-fraud posture, HARDENED by audit B1/B8):
 *   - `geoFenceOk`  = true  when a reference exists AND there is ≥1 usable fix AND EVERY photo
 *                           is verifiably INSIDE (a no-geo / poor-fix photo blocks a `true`);
 *                   = false when a reference exists AND some photo is OUTSIDE **or** cannot be
 *                           verified inside (missing / invalid / over-accuracy-cap) alongside
 *                           at least one usable fix;
 *                   = null  when there is NO reference OR NO photo carries a usable fix at all
 *                           (fully unverifiable → a flag, never persisted as a pass/fail).
 *   - `anyOutside`  = a usable fix lies beyond the radius (only meaningful with a reference).
 *   - `anyUnverifiable` = **with a reference**, at least one photo could NOT be confirmed
 *                     inside — its fix is missing, invalid, or its reported accuracy is worse
 *                     than the cap. This is the B1 fail-CLOSED signal: the SERVICE turns
 *                     `anyOutside || anyUnverifiable` into a HARD 403 WHEN the fence is enabled;
 *                     with the fence disabled (or no reference) it stays a soft flag only.
 *   - `lowAccuracy` = any usable-coordinate fix reported an accuracy worse than the cap (B8).
 *   - `worst`       = the representative "worst-fixed" photo — the valid-coordinate photo
 *                     FARTHEST from the reference (the anti-fraud worst case). Its lat/lng/
 *                     accuracy/capturedAt are what the submission stores. With a valid fix but
 *                     no reference, the first valid fix is kept (distance null).
 *
 * B1 rationale: previously ONLY an explicit `outside` fix blocked; a MISSING/INVALID/poor fix
 * fell through as `null` and PASSED. When the tenant fence is enabled and the site has a
 * reference, an unverifiable fence-required photo must fail CLOSED, not open.
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
  /** B1: with a reference, ≥1 photo could not be confirmed inside (missing/invalid/over-cap). */
  anyUnverifiable: boolean;
  /** B8: ≥1 valid-coordinate fix reported an accuracy worse than the cap. */
  lowAccuracy: boolean;
  worst: WorstFix | null;
}

/** Optional aggregation tuning. */
export interface PhotoFenceOptions {
  /**
   * GPS reported-accuracy cap (metres). A valid-coordinate fix whose accuracy exceeds this is
   * treated as UNVERIFIABLE for the fence verdict (B8 feeds B1) and raises `lowAccuracy`.
   * Undefined ⇒ no accuracy gating (coordinates alone decide).
   */
  accuracyCapMeters?: number;
}

/**
 * Aggregate the per-photo fences of one submission against the site reference.
 *
 * @param photos   the submission's photos (each with an optional geo)
 * @param reference the site's authoritative {lat,lng}, or null when the site has no geo
 * @param radiusMeters the geo-fence radius
 * @param opts     optional tuning (accuracy cap)
 */
export function aggregatePhotoFence(
  photos: PhotoGeoInput[],
  reference: { lat: number; lng: number } | null,
  radiusMeters: number,
  opts: PhotoFenceOptions = {},
): PhotoFenceAggregate {
  const cap = typeof opts.accuracyCapMeters === 'number' ? opts.accuracyCapMeters : null;

  let anyOutside = false;
  let anyInside = false;
  let anyValid = false; // ≥1 fix USABLE for the inside/outside verdict (valid coords, within cap)
  let anyUnverifiable = false; // with a reference, ≥1 photo we could not confirm inside
  let lowAccuracy = false;
  let worst: WorstFix | null = null;
  let worstDistance = -1;

  for (const p of photos) {
    const geo = p.geo;

    // A missing / invalid fix is UNVERIFIABLE — with a reference it fails closed (B1).
    if (!isValidGeo(geo)) {
      if (reference) anyUnverifiable = true;
      continue;
    }

    // Valid coordinates → eligible as the representative "worst" fix (so captureAccuracy is
    // recorded even for a poor fix), but a fix worse than the accuracy cap is NOT trusted for
    // the fence verdict (B8) → treat as unverifiable and raise lowAccuracy.
    const overCap =
      cap !== null && typeof geo.accuracy === 'number' && Number.isFinite(geo.accuracy) && geo.accuracy > cap;
    if (overCap) {
      lowAccuracy = true;
      if (reference) anyUnverifiable = true;
    }

    const distance = reference ? haversineMeters({ lat: geo.lat, lng: geo.lng }, reference) : null;
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

    if (!overCap) {
      anyValid = true;
      const status = evaluatePhotoFence(geo, reference, radiusMeters);
      if (status === 'inside') anyInside = true;
      else if (status === 'outside') anyOutside = true;
      // status === 'unverifiable' here means "no reference" — no fence signal to record.
    }
  }

  // geoFenceOk:
  //   no reference OR no usable fix at all ⇒ null (fully unverifiable — a flag, not a fail);
  //   a true pass requires ≥1 inside AND nothing outside AND nothing unverifiable (B1 hole:
  //   one inside + one no-geo must NOT read as a clean pass);
  //   otherwise false.
  let geoFenceOk: boolean | null;
  if (!reference || !anyValid) geoFenceOk = null;
  else if (anyOutside || anyUnverifiable) geoFenceOk = false;
  else geoFenceOk = anyInside ? true : null;

  return { geoFenceOk, anyOutside, anyUnverifiable, lowAccuracy, worst };
}
