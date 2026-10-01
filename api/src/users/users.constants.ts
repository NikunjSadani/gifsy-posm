/**
 * User bulk-upload column contract (email + password login; replaced phone+OTP 2026-10-01).
 *
 * Single-sheet .xlsx whose first row is these headers (matched case-INSENSITIVELY). Data rows
 * start at spreadsheet row 2, so a row at zero-based index `i` reports as row `i + 2`.
 *
 * REQUIRED: `email`, `name`, `role`. `email` is the login id (unique per tenant). `role` is one of
 * CLIENT_ADMIN / ASM / AUDITOR / VENDOR_HO / VENDOR_FIELD. `vendor_code` is REQUIRED for VENDOR_*
 * roles and must be EMPTY otherwise. `password` is OPTIONAL (a row without it creates a login that
 * can't sign in until an admin sets one). `phone` + `promoter_code` are optional.
 *
 * SAFETY (auth-sensitive path): a row whose `email` already exists UPDATES only name / phone /
 * promoter_code / password — role, vendor and active-state are NEVER changed by upload.
 */
export const USER_UPLOAD_HEADERS = [
  'email',
  'name',
  'role',
  'phone',
  'vendor_code',
  'promoter_code',
  'password',
] as const;

/** Columns whose presence is asserted before any row is processed. */
export const USER_UPLOAD_REQUIRED_HEADERS = ['email', 'name', 'role'] as const;

/** Header row of the base64 rejection report (mirrors the source columns + row_number + reason).
 *  NOTE: `password` is intentionally OMITTED from the rejection report so a plaintext password is
 *  never echoed back into a downloadable file. */
export const USER_ERROR_HEADERS = [
  'row_number',
  'email',
  'name',
  'role',
  'phone',
  'vendor_code',
  'promoter_code',
  'error_remarks',
] as const;
