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
