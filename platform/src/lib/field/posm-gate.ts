/**
 * Per-outlet GSB element-type gate (pure helpers).
 *
 * "GSB" is the element type the backend flags with `isGsb === true` (an authoritative per-type
 * flag, not a brittle code/name match). An outlet may or may not permit GSB capture
 * (`Site.gsbAllowed`). When it does NOT, every GSB element type must be removed from the recce
 * element-type picker so the rep can't select one.
 *
 * This is the UX layer only — the backend is the sole authority and hard-rejects a GSB submission
 * on a disallowed outlet regardless. We mirror the backend's own `isGsb` flag so the two stay
 * consistent even if the display code/name changes.
 */

/**
 * Gate element-type picker options by the outlet's GSB permission. When the outlet does not allow
 * GSB, every GSB type (`isGsb === true`) is dropped; otherwise the list is returned unchanged. Pure.
 */
export function gatePosmTypesByGsb<T extends { isGsb: boolean }>(types: T[], gsbAllowed: boolean): T[] {
  if (gsbAllowed) return types;
  return types.filter((t) => !t.isGsb);
}

/**
 * True when a GSB type exists in the list but the outlet disallows it — i.e. the picker is hiding
 * an option, so the UI should show the "GSB is not approved for this outlet" note. Pure.
 */
export function isGsbHiddenForOutlet<T extends { isGsb: boolean }>(types: T[], gsbAllowed: boolean): boolean {
  return !gsbAllowed && types.some((t) => t.isGsb);
}
