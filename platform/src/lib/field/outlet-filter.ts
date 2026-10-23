/**
 * Per-device outlet filter (RS code + optional Beats) for the field app.
 *
 * The field app is a filter-first experience: a VENDOR_FIELD rep must pick an RS code before the
 * recce / installation lists will show any outlets; beats are OPTIONAL and MULTI (narrow the RS's
 * outlets to one or more beats, or leave empty for all). That choice is stored ON THE DEVICE
 * (localStorage) ON PURPOSE — the same vendor login is shared across many reps on different phones,
 * so the selection is personal to a handset and must NEVER be persisted server-side (that would
 * leak one rep's beat onto every other rep sharing the login).
 *
 * localStorage can throw (private mode, disabled storage) or hold junk, so every read/write
 * is wrapped in try/catch and `getOutletFilter()` returns null for anything unusable.
 */

const STORAGE_KEY = 'kwality.field.outletFilter';

/** The on-device outlet filter — `rsCode` is required; `beatNames` may be empty (= all beats). */
export interface OutletFilter {
  rsCode: string;
  beatNames: string[];
}

/**
 * Read the stored filter, or null when unset / unparseable / empty. Only a non-empty `rsCode` is
 * required now (beats are optional) so callers can gate on a single check. A legacy value of shape
 * `{ rsCode, beatName }` (single required beat) is migrated to `{ rsCode, beatNames: [beatName] }`.
 */
export function getOutletFilter(): OutletFilter | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const { rsCode } = obj;
    if (typeof rsCode !== 'string' || !rsCode.trim()) return null;

    // Current shape: beatNames is a string[] (drop any non-string / blank entries). Absent or
    // malformed → []. Legacy shape: a single string `beatName` → [beatName] (or [] when blank).
    let beatNames: string[];
    if (Array.isArray(obj.beatNames)) {
      beatNames = obj.beatNames.filter((b): b is string => typeof b === 'string' && b.trim() !== '');
    } else if (typeof obj.beatName === 'string') {
      beatNames = obj.beatName.trim() ? [obj.beatName] : [];
    } else {
      beatNames = [];
    }
    return { rsCode, beatNames };
  } catch {
    return null;
  }
}

/** Persist the device's outlet filter. A no-op if storage is unavailable. */
export function setOutletFilter(filter: OutletFilter): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rsCode: filter.rsCode, beatNames: filter.beatNames }),
    );
  } catch {
    /* storage unavailable (private mode / disabled) — the filter just won't persist */
  }
}

/**
 * A short human summary of the chosen beats for the active-filter chip: "All beats" when none are
 * selected, the single beat when one is, else "N beats". Pure — unit-tested.
 */
export function beatSummary(beatNames: string[]): string {
  if (beatNames.length === 0) return 'All beats';
  if (beatNames.length === 1) return beatNames[0];
  return `${beatNames.length} beats`;
}

/** Clear the device's outlet filter. A no-op if storage is unavailable. */
export function clearOutletFilter(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
