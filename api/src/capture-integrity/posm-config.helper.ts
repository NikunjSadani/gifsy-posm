/**
 * posm-config.helper.ts — pure reader for the per-tenant POSM capture config that lives on
 * `Client.settings` (settings-backed, mirroring the loyalty VisibilityConfig pattern). Both
 * the Recce and Installation lanes resolve the geo-fence policy through this ONE function so
 * they enforce identical rules. NO NestJS / Prisma imports — it parses a raw JSON blob.
 */

import type { PosmCaptureConfig, GeoFencePolicy } from '../capture/visibility-types';

/** Default fence radius (metres) when a tenant enables the fence without specifying one. */
export const DEFAULT_FENCE_RADIUS_METERS = 100;

/**
 * The effective capture config for a tenant, read from `Client.settings.posmCapture` (or a
 * top-level `geoFence` for back-compat). Missing / malformed → a SAFE default: fence DISABLED
 * (so a mis-configured tenant never hard-blocks a legitimate field submission — outside fixes
 * are still recorded as geoFenceOk=false for the reviewer), radius 100 m, nearby-outlets off.
 */
export function readPosmCaptureConfig(settings: unknown): PosmCaptureConfig {
  const root = isObject(settings) ? settings : {};
  const node =
    isObject(root.posmCapture) ? root.posmCapture
    : isObject(root.geoFence) || root.nearbyOutletsEnabled !== undefined ? root
    : {};

  return {
    geoFence: readGeoFence(isObject(node) ? node.geoFence : undefined),
    nearbyOutletsEnabled: Boolean((node as Record<string, unknown>).nearbyOutletsEnabled ?? false),
  };
}

function readGeoFence(raw: unknown): GeoFencePolicy {
  if (!isObject(raw)) return { enabled: false, radiusMeters: DEFAULT_FENCE_RADIUS_METERS };
  const enabled = Boolean(raw.enabled ?? false);
  const r = Number(raw.radiusMeters);
  const radiusMeters = Number.isFinite(r) && r > 0 ? r : DEFAULT_FENCE_RADIUS_METERS;
  return { enabled, radiusMeters };
}

/** Default GPS-accuracy cap (metres) — mirrors GPS_ACCURACY_CAP_METERS in image-integrity. */
export const DEFAULT_GPS_ACCURACY_CAP_METERS = 100;

/**
 * The effective per-tenant GPS-accuracy cap (metres): a fix reported worse than this is treated
 * as unverifiable for the fence verdict (B8 → feeds the B1 fail-closed 403). Read from
 * `Client.settings.posmCapture.geoFence.maxAccuracyMeters` (or a top-level `geoFence.…` for
 * back-compat); missing / malformed / non-positive ⇒ the 100 m default. Additive — it does NOT
 * change the shared PosmCaptureConfig shape, so no capture-lane type is touched.
 */
export function readGpsAccuracyCapMeters(settings: unknown): number {
  const root = isObject(settings) ? settings : {};
  const node =
    isObject(root.posmCapture) ? root.posmCapture
    : isObject(root.geoFence) ? root
    : {};
  const gf = isObject((node as Record<string, unknown>).geoFence)
    ? ((node as Record<string, unknown>).geoFence as Record<string, unknown>)
    : {};
  const v = Number(gf.maxAccuracyMeters);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GPS_ACCURACY_CAP_METERS;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
