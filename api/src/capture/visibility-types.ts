/**
 * visibility-types.ts — shared, dependency-free TS types for the POSM capture toolkit
 * (copied from the loyalty Visibility feature and trimmed of loyalty specifics). This is
 * the single source of truth for the capture-form field shape and the per-photo geotag
 * media contract; `visibility-form.helper.ts` re-exports the form types alongside its
 * validators, and `geo-fence.helper.ts` consumes `GpsCapture`.
 *
 * PURE: no NestJS / Prisma imports, so it is safe to import anywhere (services,
 * controllers, DTOs, specs) without standing up the DI container.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Capture-form field model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The capture-form field types (a deliberately TRIMMED set — photos + geo + a few simple
 * classification fields; NO reward/calculation/consent-OTP/lookup surface).
 *
 *   TEXT / TEXTAREA — free text (single- / multi-line)
 *   NUMBER          — numeric value
 *   DATE            — ISO date
 *   DROPDOWN        — single choice from `options`
 *   MULTI_SELECT    — many choices from `options`
 *   TOGGLE          — yes/no
 *   CAMERA          — native-camera photo (value = a stored GCS object key)
 *   GPS_POINT       — a captured geo fix (value = a JSON blob)
 */
export const FORM_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'DROPDOWN',
  'MULTI_SELECT',
  'TOGGLE',
  'CAMERA',
  'GPS_POINT',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** GPS capture trigger — when the location fix is taken. */
export const GPS_CAPTURE_TRIGGERS = ['ON_SUBMIT', 'ON_PHOTO', 'MANUAL'] as const;
export type GpsCaptureTrigger = (typeof GPS_CAPTURE_TRIGGERS)[number];

/** Field types whose stored value is a GCS object key (media). Capture = CAMERA only. */
export const MEDIA_FIELD_TYPES: ReadonlySet<string> = new Set(['CAMERA']);

export const VISIBLE_WHEN_OPS = ['eq', 'neq', 'gt', 'lt', 'contains'] as const;
export type VisibleWhenOp = (typeof VISIBLE_WHEN_OPS)[number];

/** A single conditional clause: `submittedValues[fieldId] <op> value`. */
export interface VisibleWhen {
  fieldId: string;
  op: VisibleWhenOp;
  value: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  order: number;
  /** Show this field only while the clause evaluates true. */
  visibleWhen?: VisibleWhen;
  /** Make this field required only while the clause evaluates true (conditional-required). */
  requiredWhen?: VisibleWhen;
  /** GPS_POINT: when the location fix is captured. */
  captureTrigger?: GpsCaptureTrigger;
  /**
   * Reject a fix whose reported accuracy (metres) exceeds this cap; unset = no cap. Applies
   * to a GPS_POINT value AND to a CAMERA photo's embedded per-photo geo.
   */
  gpsMaxAccuracy?: number;
  /** CAMERA: suppress the gallery fallback — native camera capture only. */
  noGallery?: boolean;
  /** CAMERA: capture a GPS fix at this photo's shutter time, embedded in the media value. */
  geotag?: boolean;
  /** CAMERA: this photo must be inside the geo-fence. A fence-required photo with no fix → unverifiable (flag, not a hard-fail). */
  geoFenceRequired?: boolean;

  // ── CAMERA extensions ──────────────────────────────────────────────────────
  /** CAMERA: what/how to shoot — shown to the rep at capture time. */
  instruction?: string;
  /** CAMERA: a GCS key for a reference / sample image the rep can compare against. */
  sampleImageKey?: string;
}

/**
 * The stored capture-form schema. `captureGpsOnSubmit` requires a GPS_POINT field to store
 * the fix into (enforced by validateFormSchema).
 */
export interface VisibilityFormSchema {
  captureGpsOnSubmit: boolean;
  fields: FormField[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Media value shape + per-photo geotag (shared contract)
// ─────────────────────────────────────────────────────────────────────────────

/** A captured GPS fix. */
export interface GpsCapture {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt?: string;
}

/**
 * A stored media-field value: the legacy bare object-key string, OR a `{ key, geo? }`
 * object carrying that photo's own shutter-time GPS fix (per-photo geotag). Both shapes
 * are accepted everywhere for full backward-compat.
 */
export type MediaValue = string | { key: string; geo?: GpsCapture };

/**
 * Normalize a stored media-field value (bare key string OR `{key, geo}`) to a uniform shape.
 * A bare string yields `{ key, geo: undefined }`. Returns `{ key: '' }` for empty/invalid
 * input. A malformed `geo` is dropped rather than throwing.
 */
export function readMediaValue(v: unknown): { key: string; geo?: GpsCapture } {
  if (typeof v === 'string') return { key: v };
  if (v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string') {
    return { key: (v as { key: string }).key, geo: normalizeGeo((v as { geo?: unknown }).geo) };
  }
  return { key: '' };
}

/** Loose geo validation: an object with numeric lat/lng → a GpsCapture; else undefined. */
function normalizeGeo(g: unknown): GpsCapture | undefined {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return undefined;
  const o = g as Record<string, unknown>;
  if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return undefined;
  return o as unknown as GpsCapture;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tenant capture geo-fence configuration (settings-backed; PosmConfig lives on
// Client.settings). Trimmed to what POSM needs — the loyalty outlet-scope / sales-level /
// frequency fields are dropped (POSM keys on Site + stage, not outlet-type/month windows).
// ─────────────────────────────────────────────────────────────────────────────

/** Geo-fence policy on capture. */
export interface GeoFencePolicy {
  enabled: boolean;
  radiusMeters: number;
}

/** POSM per-tenant capture configuration (settings-backed). */
export interface PosmCaptureConfig {
  /** Geo-fence policy on capture. */
  geoFence: GeoFencePolicy;
  /** Whether the "nearby outlets" (OpenStreetMap) helper is enabled for this tenant. */
  nearbyOutletsEnabled?: boolean;
}
