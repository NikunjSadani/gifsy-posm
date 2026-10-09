/**
 * Provisional Outlet-ID (Site.code) sentinel for the Manual Recce feature.
 *
 * When a field executive submits a MANUAL recce WITHOUT typing an Outlet ID, the Site is created
 * with an internal, unique provisional code `MAN-<uuid>` so the (clientId, code) unique still
 * holds. HO finalises the real Outlet ID at approval, which overwrites this code after the
 * exists-check. Any code still carrying this prefix is a placeholder, NOT a real Outlet ID — the
 * HO queue therefore surfaces `outletId: null` for it, and HO must supply a real one to approve.
 *
 * Centralised here so the recce (submit), recce-ho-review (queue + approve) and any report lane
 * all agree on one convention. Uses node:crypto `randomUUID` — no cuid dependency.
 */
export const PROVISIONAL_CODE_PREFIX = 'MAN-';

/** Is this Site.code a provisional manual-recce placeholder (not yet a real Outlet ID)? */
export function isProvisionalCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && code.startsWith(PROVISIONAL_CODE_PREFIX);
}
