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

import { useState, useCallback } from 'react';

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

/** The high-accuracy fix timeout (ms) — a slow/failed fix rejects with `timeout`. */
export const GEO_TIMEOUT_MS = 15_000;

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

  const capture = useCallback((): Promise<GeoFix> => {
    return new Promise<GeoFix>((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        const err: GeoError = { code: 'unsupported', message: geoErrorMessage('unsupported') };
        setError(err);
        setLoading(false);
        reject(err);
        return;
      }

      setLoading(true);
      setError(null);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const acc = pos.coords.accuracy;
          const fix: GeoFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Number.isFinite(acc) ? acc : undefined,
            capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
          };
          setCoords(fix);
          setLoading(false);
          resolve(fix);
        },
        (e) => {
          const code = mapPositionError(e);
          const err: GeoError = { code, message: geoErrorMessage(code) };
          setError(err);
          setLoading(false);
          reject(err);
        },
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 },
      );
    });
  }, []);

  return { coords, error, loading, capture };
}
