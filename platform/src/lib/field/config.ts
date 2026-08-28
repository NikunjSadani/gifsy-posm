/**
 * Field-app (vendor PWA) constants.
 *
 * CLIENT_ID — the backend tenant (Client) the vendor's login belongs to. `verify-otp`
 * REQUIRES a clientId and `send-otp` uses it for the "no account" pre-check. It is a
 * per-deployment value supplied via `NEXT_PUBLIC_CLIENT_ID` (inlined into the client bundle
 * at build time). Until a real Kwality Client id is provisioned/seeded this is empty and the
 * login screen surfaces a clear "not configured" notice rather than firing a doomed request.
 */
export const CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID ?? '';

/** Roles admitted into the field PWA (client-side guard mirror of the proxy ROLE_ROUTES). */
export const FIELD_ROLES = ['VENDOR_FIELD', 'VENDOR_HO'] as const;

/** Home route after a successful field login. */
export const FIELD_HOME = '/field';
