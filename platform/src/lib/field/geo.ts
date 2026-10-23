'use client';

/**
 * Field-capture geolocation — a thin, honest wrapper around the W3C Geolocation API
 * (`navigator.geolocation.getCurrentPosition`) for the recce/install photo flows.
 *
 * `useGeo().capture()` requests a single HIGH-ACCURACY fix and resolves to a
 * {@link GeoFix} (`{ lat, lng, accuracy?, capturedAt }`) — the exact per-photo geotag
 * the backend `photo.geo` submission field (GeoDto: lat/lng/accuracy?/capturedAt?)
 * expects. Permission-denied, position-unavailable and a 15 s timeout are surfaced as
 * typed {@link GeoError}s so the UI can show honest, actionable copy.
 *
 * IMPORTANT — no spoof/mock detection: a browser PWA CANNOT read Android's
 * `isFromMockProvider()`; this hook makes NO claim about a fix being "real" or
 * "verified". It only reports the coordinates the platform hands it. The backend is the
 * sole authority on the geo-fence verdict.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/** A single shutter-time GPS fix — matches the backend `photo.geo` (GeoDto) contract. */
export interface GeoFix {
  lat: number;
  lng: number;
  /** Reported horizontal accuracy in metres (omitted when the platform gives none). */
  accuracy?: number;
  /** ISO-8601 fix time (the position timestamp), sent as `geo.capturedAt`. */
  capturedAt: string;
}

export type GeoErrorCode = 'unsupported' | 'permission_denied' | 'unavailable' | 'timeout';

export interface GeoError {
  code: GeoErrorCode;
  message: string;
}

/** The high-accuracy fix timeout (ms) — no fix at all within this rejects with `timeout`. */
export const GEO_TIMEOUT_MS = 15_000;
/** Sampling window (ms): once a first fix arrives, keep watching briefly and settle for the BEST
 *  (lowest accuracy) reading — GPS usually tightens over a few seconds as more satellites lock. */
export const GEO_SAMPLE_MS = 6_000;
/** Good-enough accuracy (m): a fix at least this tight resolves immediately (no need to keep sampling). */
export const GEO_GOOD_ENOUGH_M = 20;

/** Human, actionable copy for each failure mode (pure — unit-tested). */
export function geoErrorMessage(code: GeoErrorCode): string {
  switch (code) {
    case 'unsupported':
      return 'This device or browser cannot provide a location. Open the app in Chrome with location enabled.';
    case 'permission_denied':
      return 'Location permission is blocked. Enable location for this site in your browser settings, then retry.';
    case 'unavailable':
      return 'Could not get a location fix. Move to an open area (away from tall buildings/roof) and retry.';
    case 'timeout':
      return 'Getting your location took too long. Check that GPS/location is on, then retry.';
    default:
      return 'Could not get your location. Please retry.';
  }
}

/** Map a W3C GeolocationPositionError code to our typed code (pure — unit-tested). */
export function mapPositionError(err: { code?: number } | null | undefined): GeoErrorCode {
  // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
  switch (err?.code) {
    case 1:
      return 'permission_denied';
    case 3:
      return 'timeout';
    case 2:
    default:
      return 'unavailable';
  }
}

/**
 * Format a fix for display, e.g. `19.07600, 72.87770` (pure — unit-tested). The raw accuracy
 * is intentionally NOT shown to the field user (it's still captured + submitted in the geo data
 * and used server-side for the fence/quality checks — the rep just doesn't need the ±N m number).
 */
export function formatFix(fix: { lat: number; lng: number; accuracy?: number }): string {
  return `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`;
}

export interface UseGeoResult {
  /** The most recent successful fix, or null. */
  coords: GeoFix | null;
  /** The most recent failure, or null. */
  error: GeoError | null;
  /** True while a `capture()` is in flight. */
  loading: boolean;
  /** Request a fresh high-accuracy fix. Resolves with the fix or rejects with a GeoError. */
  capture: () => Promise<GeoFix>;
}

export function useGeo(): UseGeoResult {
  const [coords, setCoords] = useState<GeoFix | null>(null);
  const [error, setError] = useState<GeoError | null>(null);
  const [loading, setLoading] = useState(false);

  // Unmount safety: a `capture()` schedules a watch + timers that can fire after the
  // component is gone. `mountedRef` gates every state write so we never setState on an
  // unmounted component (React warning), and `activeCleanupRef` holds the in-flight
  // capture's teardown so the unmount effect can tear down the watch + timers.
  const mountedRef = useRef(true);
  const activeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeCleanupRef.current?.();
      activeCleanupRef.current = null;
    };
  }, []);

  const capture = useCallback((): Promise<GeoFix> => {
    return new Promise<GeoFix>((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        const err: GeoError = { code: 'unsupported', message: geoErrorMessage('unsupported') };
        if (mountedRef.current) {
          setError(err);
          setLoading(false);
        }
        reject(err);
        return;
      }

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      // Sample over a short window and keep the TIGHTEST fix: GPS accuracy improves
      // over a few seconds as more satellites lock, so a single instantaneous reading
      // is often far looser than what the device can produce moments later.
      let settled = false;
      let watchId: number | null = null;
      let sampleTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;
      let best: GeoFix | null = null;

      const cleanup = () => {
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
        if (sampleTimer !== null) {
          clearTimeout(sampleTimer);
          sampleTimer = null;
        }
        if (hardTimer !== null) {
          clearTimeout(hardTimer);
          hardTimer = null;
        }
        activeCleanupRef.current = null;
      };

      // Let an unmount tear down this in-flight capture's watch + timers.
      activeCleanupRef.current = cleanup;

      const settleSuccess = (fix: GeoFix) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (mountedRef.current) {
          setCoords(fix);
          setLoading(false);
        }
        resolve(fix);
      };

      const settleError = (code: GeoErrorCode) => {
        if (settled) return;
        settled = true;
        cleanup();
        const err: GeoError = { code, message: geoErrorMessage(code) };
        if (mountedRef.current) {
          setError(err);
          setLoading(false);
        }
        reject(err);
      };

      hardTimer = setTimeout(() => {
        // Overall deadline: settle for the best fix seen, else no fix at all → timeout.
        if (best) settleSuccess(best);
        else settleError('timeout');
      }, GEO_TIMEOUT_MS);

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (settled) return;
          const acc = pos.coords.accuracy;
          const accFinite = Number.isFinite(acc);
          const fix: GeoFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: accFinite ? acc : undefined,
            capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
          };

          // Keep the fix with the smallest finite accuracy: a fix WITH accuracy beats
          // one without; between two with accuracy, the smaller (tighter) one wins.
          if (
            best === null ||
            (fix.accuracy != null && (best.accuracy == null || fix.accuracy < best.accuracy))
          ) {
            best = fix;
          }

          // Good enough — resolve immediately, no need to keep sampling.
          if (fix.accuracy != null && fix.accuracy <= GEO_GOOD_ENOUGH_M) {
            settleSuccess(fix);
            return;
          }

          // First fix arrived: start the brief sampling window, then settle for best.
          if (sampleTimer === null) {
            sampleTimer = setTimeout(() => {
              if (best) settleSuccess(best);
            }, GEO_SAMPLE_MS);
          }
        },
        (e) => {
          // A transient watch error (e.g. POSITION_UNAVAILABLE under flaky signal) must
          // NOT throw away a usable fix we already captured: hand up the best fix instead
          // of rejecting — matching the old getCurrentPosition path's reliability. Only
          // reject when we have no fix at all yet. (The server-side geofence remains the
          // authority on whether the fix is acceptable.)
          if (best) settleSuccess(best);
          else settleError(mapPositionError(e));
        },
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
      );
    });
  }, []);

  return { coords, error, loading, capture };
}
