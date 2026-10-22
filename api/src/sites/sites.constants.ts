/**
 * Site bulk-upload column contract.
 *
 * The template is a single-sheet .xlsx whose first row is these headers (matched
 * case-INSENSITIVELY on ingest — a user may re-type "Code" / "CODE"). Data rows
 * start at spreadsheet row 2, so a row at zero-based index `i` reports as row
 * `i + 2` in the rejection report.
 *
 * REQUIRED: `code`, `name`. Everything else is optional; `vendor_code` and
 * `asm_email` are RESOLVED to a Vendor / ASM User inside the caller's tenant
 * (an unknown value is a per-row error, never a silent null). `gsb_allowed` is a
 * Yes/No flag (the per-outlet GSB element allow-list). The outlet `phone` field is
 * NOT part of this template — it stays on the schema / admin form / lookup only.
 */
export const SITE_UPLOAD_HEADERS = [
  'code',
  'name',
  'lat',
  'lng',
  'region',
  'state',
  'cluster',
  'town',
  'rs_code',
  'rs_name',
  'beat_name',
  'channel',
  'address',
  'pincode',
  'vendor_code',
  'asm_email',
  'gsb_allowed',
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
  'lat',
  'lng',
  'region',
  'state',
  'cluster',
  'town',
  'rs_code',
  'rs_name',
  'beat_name',
  'channel',
  'address',
  'pincode',
  'vendor_code',
  'asm_email',
  'gsb_allowed',
  'status',
  'error_remarks',
] as const;
