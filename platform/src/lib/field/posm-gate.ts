/**
 * Per-outlet GSB element-type gate (pure helpers).
 *
 * "GSB" is the element type whose `code === 'GSB'`. An outlet may or may not permit GSB capture
 * (`Site.gsbAllowed`). When it does NOT, the GSB element type must be removed from the recce
 * element-type picker so the rep can't select it.
 *
 * This is the UX layer only — the backend is the sole authority and hard-rejects a GSB submission
 * on a disallowed outlet regardless. We mirror the backend's exact match (`code === 'GSB'`) so the
 * two stay consistent.
 */

/** The element-type code gated per-outlet. Mirrors the backend PosmType whose `code === 'GSB'`. */
export const GSB_POSM_CODE = 'GSB';

/**
 * Gate element-type picker options by the outlet's GSB permission. When the outlet does not allow
 * GSB, the GSB type (code === 'GSB') is dropped; otherwise the list is returned unchanged. Pure.
 */
export function gatePosmTypesByGsb<T extends { code: string }>(types: T[], gsbAllowed: boolean): T[] {
  if (gsbAllowed) return types;
  return types.filter((t) => t.code !== GSB_POSM_CODE);
}

/**
 * True when a GSB type exists in the list but the outlet disallows it — i.e. the picker is hiding
 * an option, so the UI should show the "GSB is not approved for this outlet" note. Pure.
 */
export function isGsbHiddenForOutlet<T extends { code: string }>(types: T[], gsbAllowed: boolean): boolean {
  return !gsbAllowed && types.some((t) => t.code === GSB_POSM_CODE);
}
