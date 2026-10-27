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

/**
 * Bulk-DEACTIVATE column contract. A single-sheet .xlsx whose ONLY required column is `email`
 * (matched case-INSENSITIVELY, normalized like the login path). Each email is resolved to a user
 * in the caller's tenant and, if active, deactivated via the SAME path as the single endpoint
 * (isActive=false + immediate session eviction), preserving the self / last-admin guards.
 */
export const USER_DEACTIVATE_HEADERS = ['email'] as const;
export const USER_DEACTIVATE_REQUIRED_HEADERS = ['email'] as const;

/** Header row of the bulk-deactivate rejection report (bad / missing / unknown emails + reason). */
export const USER_DEACTIVATE_ERROR_HEADERS = ['row_number', 'email', 'error_remarks'] as const;

/**
 * Header row of the bulk-deactivate SUCCESS report — the emails acted on, each labelled
 * `Deactivated` (was active, now inactive) or `Already inactive` (a no-op success).
 */
export const USER_DEACTIVATE_SUCCESS_HEADERS = ['email', 'name', 'action'] as const;

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
