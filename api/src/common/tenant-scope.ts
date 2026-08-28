import { JwtPayload } from './decorators/current-user.decorator';

/**
 * Multi-tenant read-scope predicate (cross-tenant boundary hardening).
 *
 * A Gifsy operator's JWT carries an `assumed` flag when they have ASSUMED a tenant
 * ("Working in <Brand>"): the token then pins `clientId` to the assumed tenant. In that
 * context the operator is treated as a tenant user for READ scoping — reads pin to the
 * assumed tenant, never leaking sibling tenants.
 *
 * `platformWide` is true ONLY for the OWNER (`GIFSY_ADMIN`) in TRUE platform context (NOT
 * assumed).
 *
 * NOTE: this governs READ scoping only. WRITE-authorization keys off isGifsyOperator (below)
 * / role — do NOT route those through this helper.
 */
export function platformWide(user: JwtPayload): boolean {
  return user.role === 'GIFSY_ADMIN' && !user.assumed;
}

/** The clientId to filter by, or undefined for a platform-wide (un-assumed OWNER) read. */
export function tenantScope(user: JwtPayload): string | undefined {
  return platformWide(user) ? undefined : user.clientId;
}

/**
 * WRITE-authorization predicate — is this caller a Gifsy platform OPERATOR?
 *
 * Replaces the bare `user.role === 'GIFSY_ADMIN'` checks on Gifsy-operated write/action
 * gates. WHICH tenant they may act on is pinned by the assumed `clientId`. Includes an
 * ASSUMED GIFSY_ADMIN (role is unchanged when assumed). Does NOT itself authorize
 * assume-tenant — that keeps its own check.
 */
export function isGifsyOperator(user: JwtPayload): boolean {
  return user.role === 'GIFSY_ADMIN';
}

/**
 * VENDOR read/write confinement predicate (cross-vendor boundary hardening).
 *
 * A vendor-role login (VENDOR_FIELD / VENDOR_HO) is confined to its OWN vendor's fleet — it
 * must NEVER see or act on another vendor's sites, recces, installations or tasks. This helper
 * returns the `vendorId` such a user is pinned to.
 *
 * RETURN CONTRACT — `null` is returned ONLY for a NON-vendor role. For a non-vendor caller a
 * null means "no vendor confinement; the tenant scope (tenantScope) alone governs" — that is
 * the correct, safe reading, because a non-vendor role is never vendor-scoped in the first place.
 *
 * A VENDOR_FIELD / VENDOR_HO token ALWAYS carries a vendorId: auth REFUSES a vendor login that
 * has no vendorId (assertVendorLoginAllowed), so for a vendor role this function returns a real
 * vendorId and NEVER null — the `?? null` fallback is unreachable in practice.
 *
 * ⚠️ FAIL-CLOSED FALLBACK: if a FUTURE change ever produced a vendor-role token WITHOUT a
 * vendorId, that fallback null would surface for a VENDOR role. Callers MUST treat a null-for-a-
 * vendor-role as FAIL-CLOSED (match NOTHING) — never as an unscoped, tenant-wide read — since an
 * unconfined vendor read would leak sibling vendors' fleets. So distinguish by role, not by the
 * bare null: `null` from a non-vendor role = tenant-governed; `null` from a vendor role = deny.
 *
 * ⚠️ CONTRACT: EVERY vendor-facing query (any list/read/count/update whose result set can
 * contain vendor-scoped rows — sites, recces, installations, manual tasks, reports) MUST apply
 * this. When it returns a vendorId, AND that vendorId into the `where` (e.g.
 * `where: { ...tenantScope, ...(v ? { vendorId: v } : {}) }`).
 */
export function vendorScope(user: JwtPayload): string | null {
  if (user.role !== 'VENDOR_FIELD' && user.role !== 'VENDOR_HO') return null;
  return user.vendorId ?? null;
}
