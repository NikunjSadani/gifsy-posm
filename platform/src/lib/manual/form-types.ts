/* ─── Manual-task form model (FE copy of the backend capture-form contract) ────
   Mirrors `api/src/capture/visibility-types.ts` — the single source of truth the backend
   validates against. A ManualTask.formSchema is a `ManualFormSchema`; a submission's
   formValues is a `{ [fieldId]: FormValue }` map. Kept in sync with the backend by hand
   (both the admin builder and the vendor filler import THIS file so they never drift from
   each other). Pure types + a couple of tiny helpers — no React, no fetch.
─────────────────────────────────────────────────────────────────────────────── */

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

/** Human labels for the field-type picker in the builder. */
export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  TEXT: 'Short text',
  TEXTAREA: 'Long text',
  NUMBER: 'Number',
  DATE: 'Date',
  DROPDOWN: 'Dropdown (one)',
  MULTI_SELECT: 'Multi-select',
  TOGGLE: 'Yes / No',
  CAMERA: 'Photo',
  GPS_POINT: 'GPS location',
};

/** Types whose stored value is a media object key (`{key, geo?}`). */
export const MEDIA_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set(['CAMERA']);
/** Types that need an `options` list. */
export const OPTION_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set(['DROPDOWN', 'MULTI_SELECT']);

export const GPS_CAPTURE_TRIGGERS = ['ON_SUBMIT', 'ON_PHOTO', 'MANUAL'] as const;
export type GpsCaptureTrigger = (typeof GPS_CAPTURE_TRIGGERS)[number];

export interface GpsCapture {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt?: string;
}

/** A stored media-field value — `{ key, geo? }` (a bare key string is also accepted by the backend). */
export type MediaValue = { key: string; geo?: GpsCapture };

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  order: number;
  /** GPS_POINT: when the fix is captured. */
  captureTrigger?: GpsCaptureTrigger;
  /** Reject a fix whose accuracy (m) exceeds this cap (GPS_POINT + CAMERA per-photo geo). */
  gpsMaxAccuracy?: number;
  /** CAMERA: native camera only (no gallery). */
  noGallery?: boolean;
  /** CAMERA: embed a shutter-time GPS fix in the photo value. */
  geotag?: boolean;
  /** CAMERA: photo must be inside the tenant geo-fence (flag, not a hard fail). */
  geoFenceRequired?: boolean;
  /** CAMERA: capture instruction shown to the rep. */
  instruction?: string;
}

/** A ManualTask.formSchema. `captureGpsOnSubmit` requires a GPS_POINT field to hold the fix. */
export interface ManualFormSchema {
  captureGpsOnSubmit: boolean;
  fields: FormField[];
}

/** A single answer in a submission's formValues map (GPS_POINT stores a GpsCapture). */
export type FormValue = string | number | boolean | string[] | MediaValue | GpsCapture | null;

/** The submission answers, keyed by field id. */
export type FormValues = Record<string, FormValue>;

/** Fields sorted by their `order` (stable). */
export function orderedFields(schema: ManualFormSchema | null | undefined): FormField[] {
  return [...(schema?.fields ?? [])].sort((a, b) => a.order - b.order);
}

/** Whether a required field has a non-empty answer (client-side pre-submit guard). */
export function hasValue(field: FormField, v: FormValue): boolean {
  if (v == null) return false;
  if (field.type === 'MULTI_SELECT') return Array.isArray(v) && v.length > 0;
  if (field.type === 'TOGGLE') return typeof v === 'boolean';
  if (MEDIA_FIELD_TYPES.has(field.type)) return !!(v as MediaValue)?.key;
  if (field.type === 'GPS_POINT') return !!v && typeof v === 'object' && 'lat' in (v as object);
  if (typeof v === 'string') return v.trim().length > 0;
  // Every empty case (null, empty array/multi-select, blank string) is handled above; a
  // remaining number / boolean / media value is a present answer.
  return true;
}
