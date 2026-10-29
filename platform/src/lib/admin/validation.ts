/* ─── Admin masters — pure client-side form validation ───────────────────────
   These mirror the backend DTO rules so the UI can fail fast BEFORE a request,
   while the backend stays the real authority (its 400/409 is surfaced verbatim).
   Every function returns a field→message map; an empty map means "valid".
─────────────────────────────────────────────────────────────────────────────── */

import { MANAGED_ROLES, isVendorRole, type ManagedRole, type PosmMeasurement } from './types';

export type FieldErrors = Record<string, string>;

const isBlank = (v: string | undefined | null): boolean => !v || v.trim() === '';

/** A 10-digit Indian mobile (leading 6–9). The backend canonicalises to +91 E.164. */
export function isValidIndianMobile(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone.trim());
}

export interface VendorInput {
  code: string;
  name: string;
}

export function validateVendor(input: VendorInput): FieldErrors {
  const errors: FieldErrors = {};
  if (isBlank(input.code)) errors.code = 'Code is required';
  else if (input.code.trim().length > 50) errors.code = 'Code must be at most 50 characters';
  if (isBlank(input.name)) errors.name = 'Name is required';
  else if (input.name.trim().length > 160) errors.name = 'Name must be at most 160 characters';
  return errors;
}

export interface PosmTypeInput {
  code: string;
  name: string;
  /** Measurement mode — defaults to DIMENSION. UNIT elements carry no size, so dims + cap are ignored. */
  measurement?: PosmMeasurement;
  /** Optional dimensions — all three required together when any is supplied (DIMENSION only). */
  width?: string;
  height?: string;
  unit?: string;
  /** Optional max-size cap (sq ft); when provided it must be a positive number (DIMENSION only). */
  maxAreaSqFt?: string;
}

export function validatePosmType(input: PosmTypeInput): FieldErrors {
  const errors: FieldErrors = {};
  if (isBlank(input.code)) errors.code = 'Code is required';
  else if (input.code.trim().length > 50) errors.code = 'Code must be at most 50 characters';
  if (isBlank(input.name)) errors.name = 'Name is required';
  else if (input.name.trim().length > 160) errors.name = 'Name must be at most 160 characters';

  // Dimensions + max-size cap only apply to DIMENSION elements; a UNIT element has no size.
  const measurement: PosmMeasurement = input.measurement ?? 'DIMENSION';
  if (measurement === 'DIMENSION') {
    const anyDim = !isBlank(input.width) || !isBlank(input.height) || !isBlank(input.unit);
    if (anyDim) {
      const w = Number(input.width);
      const h = Number(input.height);
      if (isBlank(input.width) || !Number.isFinite(w) || w <= 0) {
        errors.width = 'Width must be a positive number';
      }
      if (isBlank(input.height) || !Number.isFinite(h) || h <= 0) {
        errors.height = 'Height must be a positive number';
      }
      if (isBlank(input.unit)) errors.unit = 'Unit is required when dimensions are set';
    }

    if (!isBlank(input.maxAreaSqFt)) {
      const m = Number(input.maxAreaSqFt);
      if (!Number.isFinite(m) || m <= 0) {
        errors.maxAreaSqFt = 'Max size must be a positive number';
      }
    }
  }
  return errors;
}

export interface UserInput {
  name: string;
  email: string;
  password?: string;
  /** Optional: true when editing an existing user (password may be left blank to keep current). */
  isEdit?: boolean;
  phone?: string;
  role: string;
  vendorId?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUser(input: UserInput): FieldErrors {
  const errors: FieldErrors = {};
  if (isBlank(input.name)) errors.name = 'Name is required';
  else if (input.name.trim().length > 120) errors.name = 'Name must be at most 120 characters';

  // Email is the login id — required + well-formed.
  if (isBlank(input.email)) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(input.email.trim())) errors.email = 'Enter a valid email address';

  // Phone is now OPTIONAL (contact only) — validate only when provided.
  if (!isBlank(input.phone) && !isValidIndianMobile(input.phone as string)) {
    errors.phone = 'Enter a valid 10-digit Indian mobile number';
  }

  // Password: optional on create (login disabled until set) and on edit (blank = keep). When
  // supplied, enforce the 8-char minimum to match the backend.
  if (!isBlank(input.password) && (input.password as string).length < 8) {
    errors.password = 'Password must be at least 8 characters';
  }

  if (isBlank(input.role)) {
    errors.role = 'Role is required';
  } else if (!MANAGED_ROLES.includes(input.role as ManagedRole)) {
    errors.role = 'Select a valid role';
  } else if (isVendorRole(input.role)) {
    // A vendor role MUST be linked to a vendor.
    if (isBlank(input.vendorId)) errors.vendorId = 'A vendor login must be linked to a vendor';
  } else if (!isBlank(input.vendorId)) {
    // A non-vendor role must NOT carry a vendorId.
    errors.vendorId = 'Only vendor roles may be linked to a vendor';
  }
  return errors;
}

export interface SiteInput {
  code: string;
  name: string;
  phone?: string;
  lat?: string;
  lng?: string;
  town?: string;
  rsCode?: string;
  beatName?: string;
}

export function validateSite(input: SiteInput): FieldErrors {
  const errors: FieldErrors = {};
  if (isBlank(input.code)) errors.code = 'Code is required';
  else if (input.code.trim().length > 100) errors.code = 'Code must be at most 100 characters';
  if (isBlank(input.name)) errors.name = 'Name is required';
  else if (input.name.trim().length > 200) errors.name = 'Name must be at most 200 characters';

  // RS code + Beat are REQUIRED — the field app filters outlets by (RS code, Beat), so every
  // site must carry both. Mirrors the backend, which now rejects a site missing either.
  if (isBlank(input.rsCode)) errors.rsCode = 'RS code is required';
  else if ((input.rsCode as string).trim().length > 60) errors.rsCode = 'RS code must be at most 60 characters';
  if (isBlank(input.beatName)) errors.beatName = 'Beat name is required';
  else if ((input.beatName as string).trim().length > 120) errors.beatName = 'Beat name must be at most 120 characters';

  const hasLat = !isBlank(input.lat);
  const hasLng = !isBlank(input.lng);
  if (hasLat !== hasLng) {
    errors.lat = 'Latitude and longitude must be provided together';
  } else if (hasLat && hasLng) {
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.lat = 'Latitude must be between -90 and 90';
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.lng = 'Longitude must be between -180 and 180';
    }
  }
  return errors;
}

/** True when a field-error map has no entries. */
export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
