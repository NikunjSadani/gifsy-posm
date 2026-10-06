/**
 * Per-device outlet filter (RS code + Beat) for the field app.
 *
 * The field app is a filter-first experience: a VENDOR_FIELD rep must pick an RS code and a
 * Beat before the recce / installation lists will show any outlets. That choice is stored
 * ON THE DEVICE (localStorage) ON PURPOSE — the same vendor login is shared across many reps
 * on different phones, so the selection is personal to a handset and must NEVER be persisted
 * server-side (that would leak one rep's beat onto every other rep sharing the login).
 *
 * localStorage can throw (private mode, disabled storage) or hold junk, so every read/write
 * is wrapped in try/catch and `getOutletFilter()` returns null for anything unusable.
 */

const STORAGE_KEY = 'kwality.field.outletFilter';

/** The on-device outlet filter — both fields are required and non-empty when set. */
export interface OutletFilter {
  rsCode: string;
  beatName: string;
}

/**
 * Read the stored filter, or null when unset / unparseable / empty. A stored value with a
 * blank rsCode or beatName is treated as unset (null) so callers can gate on a single check.
 */
export function getOutletFilter(): OutletFilter | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { rsCode, beatName } = parsed as Record<string, unknown>;
    if (typeof rsCode !== 'string' || typeof beatName !== 'string') return null;
    if (!rsCode.trim() || !beatName.trim()) return null;
    return { rsCode, beatName };
  } catch {
    return null;
  }
}

/** Persist the device's outlet filter. A no-op if storage is unavailable. */
export function setOutletFilter(filter: OutletFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rsCode: filter.rsCode, beatName: filter.beatName }));
  } catch {
    /* storage unavailable (private mode / disabled) — the filter just won't persist */
  }
}

/** Clear the device's outlet filter. A no-op if storage is unavailable. */
export function clearOutletFilter(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
