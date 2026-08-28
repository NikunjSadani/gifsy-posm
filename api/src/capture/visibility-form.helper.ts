/**
 * visibility-form.helper.ts — pure form-schema field engine for the POSM capture form.
 * Trimmed to what capture needs (photos + geo + simple classification; NO reward/
 * calculation/lookup/consent).
 *
 * PURE: no NestJS / Prisma imports — directly unit-testable.
 *
 * Exports:
 *   - Field-type / clause types re-exported from visibility-types (single source).
 *   - validateFormSchema(schema)          — structural validator for the stored form.
 *   - validateSubmittedValues(schema, v)  — submit-time validation; returns the
 *                                           projected/validated values (hidden fields
 *                                           dropped, unknown keys dropped).
 *   - evaluateVisibleWhen / isFieldRequired / evaluateClause / parseGpsPoint.
 *   - MEDIA_FIELD_TYPES.
 */

import {
  FORM_FIELD_TYPES,
  FormFieldType,
  GPS_CAPTURE_TRIGGERS,
  VISIBLE_WHEN_OPS,
  VisibleWhen,
  FormField,
  VisibilityFormSchema,
  MEDIA_FIELD_TYPES,
  readMediaValue,
} from './visibility-types';

// Re-export the shared types + constants so consumers can import everything the form
// engine touches from one module.
export {
  FORM_FIELD_TYPES,
  GPS_CAPTURE_TRIGGERS,
  VISIBLE_WHEN_OPS,
  MEDIA_FIELD_TYPES,
  readMediaValue,
};
export type { FormFieldType, VisibleWhen, FormField, VisibilityFormSchema };
export type { MediaValue, GpsCapture } from './visibility-types';

// ─────────────────────────────────────────────────────────────────────────────
// Structural type guards
// ─────────────────────────────────────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number';
}
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// validateFormSchema — structural integrity of a stored VisibilityFormSchema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the structural integrity of a capture form schema. Returns an array of
 * human-readable error strings; an empty array means valid.
 */
/**
 * Validate a capture-form schema. `requireCamera` (default true) enforces the visibility rule
 * that a form must carry at least one CAMERA field (proof-of-POSM via photo); the MANUAL-task
 * builder passes `false` because a manual task may be a photo-less survey / checklist.
 */
export function validateFormSchema(
  rawSchema: unknown,
  opts: { requireCamera?: boolean } = {},
): string[] {
  const requireCamera = opts.requireCamera ?? true;
  const errors: string[] = [];

  if (!isObject(rawSchema)) {
    return ['formSchema must be a JSON object.'];
  }

  if (!isBoolean(rawSchema.captureGpsOnSubmit)) {
    errors.push('formSchema.captureGpsOnSubmit must be a boolean.');
  }

  if (!Array.isArray(rawSchema.fields)) {
    errors.push('formSchema.fields must be an array.');
    return errors;
  }

  const fields = rawSchema.fields as unknown[];
  if (fields.length === 0) {
    errors.push('The capture form must have at least one field.');
    return errors;
  }

  // Pass 1 — per-field structure + id collection.
  const fieldIds = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const pos = `Field ${i + 1}`;

    if (!isObject(f)) {
      errors.push(`${pos}: must be a JSON object.`);
      continue;
    }

    if (!isString(f.id) || f.id.trim() === '') {
      errors.push(`${pos}: id must be a non-empty string.`);
    } else if (fieldIds.has(f.id)) {
      errors.push(`${pos}: duplicate field id "${f.id}".`);
    } else {
      fieldIds.add(f.id);
    }

    if (!isString(f.type) || !(FORM_FIELD_TYPES as readonly string[]).includes(f.type)) {
      errors.push(`${pos}: type must be one of: ${FORM_FIELD_TYPES.join(', ')}.`);
    }

    if (!isString(f.label) || f.label.trim() === '') {
      errors.push(`${pos}: label cannot be empty.`);
    }

    if (!isBoolean(f.required)) {
      errors.push(`${pos}: required must be a boolean.`);
    }

    if (!isNumber(f.order)) {
      errors.push(`${pos}: order must be a number.`);
    }

    // options — required for the choice field types.
    if (f.type === 'DROPDOWN' || f.type === 'MULTI_SELECT') {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        const lbl = isString(f.label) && f.label.trim() ? f.label : String(f.type);
        errors.push(`${pos} ("${lbl}"): ${f.type} must have at least one option.`);
      } else if ((f.options as unknown[]).some((o) => !isString(o))) {
        errors.push(`${pos}: all options must be strings.`);
      }
    }

    if (f.captureTrigger !== undefined) {
      if (
        !isString(f.captureTrigger) ||
        !(GPS_CAPTURE_TRIGGERS as readonly string[]).includes(f.captureTrigger)
      ) {
        errors.push(`${pos}: captureTrigger must be one of: ${GPS_CAPTURE_TRIGGERS.join(', ')}.`);
      }
    }

    if (f.noGallery !== undefined && !isBoolean(f.noGallery)) {
      errors.push(`${pos}: noGallery must be a boolean.`);
    }

    if (f.geotag !== undefined && !isBoolean(f.geotag)) {
      errors.push(`${pos}: geotag must be a boolean.`);
    }
    if (f.geoFenceRequired !== undefined) {
      if (!isBoolean(f.geoFenceRequired)) {
        errors.push(`${pos}: geoFenceRequired must be a boolean.`);
      }
      if (f.type !== 'CAMERA') {
        errors.push(`${pos}: geoFenceRequired is only valid on a CAMERA field.`);
      }
    }

    if (f.instruction !== undefined && !isString(f.instruction)) {
      errors.push(`${pos}: instruction must be a string.`);
    }
    if (f.sampleImageKey !== undefined && !isString(f.sampleImageKey)) {
      errors.push(`${pos}: sampleImageKey must be a string.`);
    }
  }

  // Pass 2 — cross-field clause reference checks.
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!isObject(f)) continue;
    const pos = `Field ${i + 1}`;
    const label =
      isString(f.label) && (f.label as string).trim()
        ? (f.label as string).trim()
        : isString(f.type)
          ? (f.type as string)
          : `${i + 1}`;

    for (const clauseKey of ['visibleWhen', 'requiredWhen'] as const) {
      const clause = f[clauseKey];
      if (clause === undefined) continue;
      if (!isObject(clause)) {
        errors.push(`${pos}: ${clauseKey} must be an object.`);
        continue;
      }
      if (!isString(clause.fieldId) || clause.fieldId.trim() === '') {
        errors.push(`${pos}: ${clauseKey}.fieldId must be a non-empty string.`);
      } else if (isString(f.id) && clause.fieldId === f.id) {
        errors.push(`${pos} ("${label}"): ${clauseKey} cannot depend on itself.`);
      } else if (!fieldIds.has(clause.fieldId as string)) {
        errors.push(
          `${pos} ("${label}"): ${clauseKey} references unknown field id "${clause.fieldId}".`,
        );
      }
      if (!isString(clause.op) || !(VISIBLE_WHEN_OPS as readonly string[]).includes(clause.op as string)) {
        errors.push(`${pos}: ${clauseKey}.op must be one of: ${VISIBLE_WHEN_OPS.join(', ')}.`);
      }
      if (!isString(clause.value)) {
        errors.push(`${pos}: ${clauseKey}.value must be a string.`);
      }
    }
  }

  // At least one CAMERA field — capture is proof-of-POSM via photo (visibility only).
  if (requireCamera) {
    const hasCamera = fields.some((f) => isObject(f) && f.type === 'CAMERA');
    if (!hasCamera) {
      errors.push('The capture form must have at least one CAMERA (photo) field.');
    }
  }

  // GPS coherence: a submit-time GPS capture needs a GPS_POINT field to store into.
  if (rawSchema.captureGpsOnSubmit === true) {
    const hasGps = fields.some((f) => isObject(f) && f.type === 'GPS_POINT');
    if (!hasGps) {
      errors.push(
        'formSchema.captureGpsOnSubmit is true but the form has no GPS_POINT field to store the fix.',
      );
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission-time helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Evaluate a single `{fieldId, op, value}` clause against the submitted values. */
export function evaluateClause(
  clause: VisibleWhen,
  submittedValues: Record<string, unknown>,
): boolean {
  const { fieldId, op, value: condValue } = clause;
  const raw = submittedValues[fieldId];
  const rawStr = raw !== null && raw !== undefined ? String(raw) : '';

  switch (op) {
    case 'eq':
      return rawStr === condValue;
    case 'neq':
      return rawStr !== condValue;
    case 'gt': {
      const n = Number(rawStr);
      const cv = Number(condValue);
      return !isNaN(n) && !isNaN(cv) && n > cv;
    }
    case 'lt': {
      const n = Number(rawStr);
      const cv = Number(condValue);
      return !isNaN(n) && !isNaN(cv) && n < cv;
    }
    case 'contains':
      return rawStr.includes(condValue);
    default:
      return false;
  }
}

/** Whether a field is visible under the current submitted values. */
export function evaluateVisibleWhen(
  field: FormField,
  submittedValues: Record<string, unknown>,
): boolean {
  if (!field.visibleWhen) return true;
  return evaluateClause(field.visibleWhen, submittedValues);
}

/**
 * Whether a (visible) field must have a value: a `required:true` field is always required;
 * a `requiredWhen` field is required only while its clause is true.
 */
export function isFieldRequired(
  field: FormField,
  submittedValues: Record<string, unknown>,
): boolean {
  if (field.required) return true;
  if (field.requiredWhen) return evaluateClause(field.requiredWhen, submittedValues);
  return false;
}

/**
 * Parse a GPS_POINT value (an object, or a JSON string) to a `{lat,lng}` fix whose
 * coordinates are finite AND within valid Earth ranges (lat −90..90, lng −180..180).
 * Returns null for anything unparseable/out-of-range.
 */
export function parseGpsPoint(raw: unknown): { lat: number; lng: number } | null {
  let val: unknown = raw;
  if (typeof val === 'string') {
    try {
      val = JSON.parse(val);
    } catch {
      return null;
    }
  }
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  const g = val as Record<string, unknown>;
  const lat = typeof g.lat === 'number' ? g.lat : typeof g.lat === 'string' ? parseFloat(g.lat) : NaN;
  const lng = typeof g.lng === 'number' ? g.lng : typeof g.lng === 'string' ? parseFloat(g.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** MULTI_SELECT-aware "empty" (false is a real TOGGLE answer, handled by the caller). */
function isBlank(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

const TRUE_TOKENS = new Set(['true', '1', 'yes', 'on']);
const FALSE_TOKENS = new Set(['false', '0', 'no', 'off']);

/** Submission-time validation result. */
export interface SubmissionValidationResult {
  /** Human-readable per-field validation messages; empty = valid. */
  errors: string[];
  /**
   * The validated values PROJECTED to only the schema's field ids AND only the fields
   * visible under the submitted values. Hidden fields and unknown client keys are dropped.
   */
  values: Record<string, unknown>;
}

/**
 * Validate submitted form values against the stored schema and return the projected values
 * (hidden + unknown keys dropped).
 */
export function validateSubmittedValues(
  schema: VisibilityFormSchema,
  submitted: Record<string, unknown> | null | undefined,
): SubmissionValidationResult {
  const errors: string[] = [];
  const projected: Record<string, unknown> = {};
  const values: Record<string, unknown> = submitted ?? {};

  for (const field of schema.fields ?? []) {
    // Hidden fields — never validated, never persisted.
    if (!evaluateVisibleWhen(field, values)) continue;

    const rawValue = values[field.id];
    const empty =
      field.type === 'TOGGLE'
        ? rawValue === null || rawValue === undefined
        : isBlank(rawValue);

    if (isFieldRequired(field, values) && empty) {
      errors.push(`Field "${field.label}" (${field.id}) is required.`);
      continue;
    }

    if (empty) continue;

    switch (field.type) {
      case 'NUMBER': {
        const n = Number(String(rawValue));
        if (!isFinite(n) || isNaN(n)) {
          errors.push(`Field "${field.label}" (${field.id}) must be a valid number.`);
          continue;
        }
        break;
      }
      case 'DATE': {
        const d = new Date(String(rawValue));
        if (isNaN(d.getTime())) {
          errors.push(`Field "${field.label}" (${field.id}) must be a valid date.`);
          continue;
        }
        break;
      }
      case 'TOGGLE': {
        const ok =
          typeof rawValue === 'boolean' ||
          TRUE_TOKENS.has(String(rawValue).toLowerCase()) ||
          FALSE_TOKENS.has(String(rawValue).toLowerCase());
        if (!ok) {
          errors.push(`Field "${field.label}" (${field.id}) must be yes/no.`);
          continue;
        }
        break;
      }
      case 'DROPDOWN': {
        if (Array.isArray(field.options) && field.options.length > 0) {
          if (!field.options.map(String).includes(String(rawValue))) {
            errors.push(`Field "${field.label}" (${field.id}) has an invalid selection.`);
            continue;
          }
        }
        break;
      }
      case 'MULTI_SELECT': {
        const arr = Array.isArray(rawValue)
          ? rawValue.map(String)
          : String(rawValue)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
        const allowed = new Set((field.options ?? []).map(String));
        const bad = arr.find((v) => !allowed.has(v));
        if (bad !== undefined) {
          errors.push(`Field "${field.label}" (${field.id}) contains an invalid option "${bad}".`);
          continue;
        }
        break;
      }
      case 'GPS_POINT': {
        if (parseGpsPoint(rawValue) === null) {
          errors.push(`Field "${field.label}" (${field.id}) must be a valid GPS location (lat/lng).`);
          continue;
        }
        break;
      }
      case 'CAMERA': {
        // A CAMERA value is a bare object-key string OR a `{ key, geo? }` object carrying the
        // photo's shutter-time GPS fix. When a geo IS embedded, validate its shape/Earth-range
        // + the per-field accuracy cap. A photo with no geo stays valid.
        const media = readMediaValue(rawValue);
        if (!media.key) {
          errors.push(`Field "${field.label}" (${field.id}) has an invalid media reference.`);
          continue;
        }
        const rawGeo =
          rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
            ? (rawValue as { geo?: unknown }).geo
            : undefined;
        if (rawGeo !== undefined && rawGeo !== null) {
          const point = media.geo ? parseGpsPoint(media.geo) : null;
          if (!point) {
            errors.push(
              `Field "${field.label}" (${field.id}) has a malformed or out-of-range photo location.`,
            );
            continue;
          }
          if (typeof field.gpsMaxAccuracy === 'number' && field.gpsMaxAccuracy > 0) {
            const acc = Number(media.geo?.accuracy);
            if (isFinite(acc) && acc > field.gpsMaxAccuracy) {
              errors.push(
                `Field "${field.label}" (${field.id}) location accuracy (±${acc}m) exceeds the ${field.gpsMaxAccuracy}m limit — move to open sky and recapture.`,
              );
              continue;
            }
          }
        }
        break;
      }
      // TEXT, TEXTAREA — any non-empty value accepted.
      default:
        break;
    }

    // The field is visible and valid → keep it in the projected values.
    projected[field.id] = rawValue;
  }

  return { errors, values: projected };
}
