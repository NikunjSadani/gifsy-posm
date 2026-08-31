/* ─── Capture settings (geo-fence) — typed API client + pure helpers ────────────
   The admin sets the per-tenant geo-fence: whether it's enforced, the radius (metres)
   a capture must fall within of the outlet — the "is the rep AT the store?" distance —
   and the GPS-accuracy cap. Thin wrappers over `/api/settings/capture`, tenant-scoped
   and re-validated by the backend. Pure validation lives here and is unit-tested.
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';

export interface GeoFenceConfig {
  /** When true, an out-of-fence or unverifiable capture is hard-blocked; when false it's only flagged for review. */
  enabled: boolean;
  /** How close (metres) a capture must be to the outlet to count as "at the outlet". */
  radiusMeters: number;
  /** A GPS fix reported worse than this (metres) is treated as unverifiable. */
  maxAccuracyMeters: number;
}

export interface CaptureConfig {
  geoFence: GeoFenceConfig;
  /** Gifsy-controlled; shown read-only here and preserved on save. */
  nearbyOutletsEnabled: boolean;
}

/** The editable geo-fence fields sent on save (nearby-outlets is intentionally omitted → preserved). */
export interface CaptureConfigUpdate {
  geoFence: GeoFenceConfig;
}

export const RADIUS_MIN = 10;
export const RADIUS_MAX = 100_000;
export const ACCURACY_MIN = 1;
export const ACCURACY_MAX = 100_000;

/** Field-level validation errors (empty object = valid), matching the backend DTO bounds. */
export function validateGeoFence(g: {
  radiusMeters: number | '';
  maxAccuracyMeters: number | '';
}): Partial<Record<'radiusMeters' | 'maxAccuracyMeters', string>> {
  const errs: Partial<Record<'radiusMeters' | 'maxAccuracyMeters', string>> = {};
  const r = g.radiusMeters;
  if (r === '' || !Number.isInteger(r) || r < RADIUS_MIN || r > RADIUS_MAX) {
    errs.radiusMeters = `Enter a whole number between ${RADIUS_MIN} and ${RADIUS_MAX} metres.`;
  }
  const a = g.maxAccuracyMeters;
  if (a === '' || !Number.isInteger(a) || a < ACCURACY_MIN || a > ACCURACY_MAX) {
    errs.maxAccuracyMeters = `Enter a whole number between ${ACCURACY_MIN} and ${ACCURACY_MAX} metres.`;
  }
  return errs;
}

export function fetchCaptureConfig(): Promise<ApiResponse<CaptureConfig>> {
  return api.get<CaptureConfig>('/api/settings/capture');
}

export function saveCaptureConfig(body: CaptureConfigUpdate): Promise<ApiResponse<CaptureConfig>> {
  return api.put<CaptureConfig>('/api/settings/capture', body);
}
