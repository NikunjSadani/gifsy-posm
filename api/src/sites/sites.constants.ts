/**
 * Site bulk-upload column contract.
 *
 * The template is a single-sheet .xlsx whose first row is these headers (matched
 * case-INSENSITIVELY on ingest — a user may re-type "Code" / "CODE"). Data rows
 * start at spreadsheet row 2, so a row at zero-based index `i` reports as row
 * `i + 2` in the rejection report.
 *
 * REQUIRED: `code`, `name`. Everything else is optional; `vendor_code` and
 * `asm_phone` are RESOLVED to a Vendor / ASM User inside the caller's tenant
 * (an unknown value is a per-row error, never a silent null).
 */
export const SITE_UPLOAD_HEADERS = [
  'code',
  'name',
  'phone',
  'lat',
  'lng',
  'region',
  'state',
  'cluster',
  'town',
  'rs_code',
  'beat_name',
  'channel',
  'address',
  'vendor_code',
  'asm_phone',
  'status',
] as const;

/** Columns whose presence is asserted before any row is processed. */
export const SITE_UPLOAD_REQUIRED_HEADERS = ['code', 'name'] as const;

/**
 * Header row of the base64 rejection report returned by a bulk upload. Mirrors the
 * source columns (so a user can fix in place) plus `row_number` and `error_remarks`.
 */
export const SITE_ERROR_HEADERS = [
  'row_number',
  'code',
  'name',
  'phone',
  'lat',
  'lng',
  'region',
  'state',
  'cluster',
  'town',
  'rs_code',
  'beat_name',
  'channel',
  'address',
  'vendor_code',
  'asm_phone',
  'status',
  'error_remarks',
] as const;
