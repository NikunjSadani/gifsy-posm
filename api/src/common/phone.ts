/**
 * Canonicalise an Indian mobile number to E.164 `+91XXXXXXXXXX`.
 *
 * Strips every non-digit, drops any country-code / trunk prefix, and keeps the last
 * 10 digits — so `9830011252`, `+91 98300 11252`, `0919830011252` and
 * `+919830011252` all collapse to the SINGLE identity `+919830011252`. Applied at
 * EVERY User-phone boundary (admin create/update, login lookup, ASM resolution) so
 * one person is one row regardless of how the number was typed, and the
 * `(clientId, phone)` uniqueness constraint cannot be side-stepped by re-typing the
 * same number in a different shape.
 *
 * NOTE: the caller still VALIDATES the raw input (DTO `@IsMobilePhone('en-IN')`);
 * this only canonicalises an already-accepted number for storage/lookup. A number
 * shorter than 10 digits (which validation would have rejected) is passed through as
 * `+91<digits>` rather than throwing — normalisation is not a validation gate.
 */
export function normalizeIndianPhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  return `+91${last10}`;
}
