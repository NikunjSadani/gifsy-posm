/**
 * User bulk-upload column contract.
 *
 * Single-sheet .xlsx whose first row is these headers (matched case-INSENSITIVELY). Data rows
 * start at spreadsheet row 2, so a row at zero-based index `i` reports as row `i + 2`.
 *
 * REQUIRED: `phone`, `name`, `role`. `role` is one of CLIENT_ADMIN / ASM / AUDITOR / VENDOR_HO /
 * VENDOR_FIELD (case-insensitive). `vendor_code` is REQUIRED for VENDOR_* roles (resolves to a
 * vendor in the tenant) and must be EMPTY for every other role. `promoter_code` is optional and
 * unique per tenant.
 *
 * SAFETY (auth-sensitive path): a row whose `phone` already exists UPDATES only that user's `name`
 * and `promoter_code` — role, vendor and active-state are NEVER changed by upload (that would risk
 * mass session-eviction or a tenant admin lock-out). Use the Edit form to change role/vendor.
 */
export const USER_UPLOAD_HEADERS = [
  'phone',
  'name',
  'role',
  'vendor_code',
  'promoter_code',
] as const;

/** Columns whose presence is asserted before any row is processed. */
export const USER_UPLOAD_REQUIRED_HEADERS = ['phone', 'name', 'role'] as const;

/** Header row of the base64 rejection report (mirrors the source columns + row_number + reason). */
export const USER_ERROR_HEADERS = [
  'row_number',
  'phone',
  'name',
  'role',
  'vendor_code',
  'promoter_code',
  'error_remarks',
] as const;
