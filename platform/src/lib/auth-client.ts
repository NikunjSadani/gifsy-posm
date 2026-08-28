/* ─── Client-side auth helpers ───────────────────────────────────────────────
   The access token lives ONLY in an httpOnly `token` cookie — it is NOT readable by JS
   and is NOT mirrored to localStorage, so a stored-XSS has no bearer token to steal. The
   edge proxy reads that cookie and injects `Authorization: Bearer` for the backend on every
   `/api/*` call; same-origin fetches send the cookie automatically, so client code never
   needs to attach a token.

   localStorage holds only NON-sensitive display state: the `user` object (id/name/role/phone)
   for client-side routing. Mutating the auth cookies (logout) happens via the server action
   in lib/auth-actions.ts.
   Client-only.
─────────────────────────────────────────────────────────────────────────────── */

import { logoutAction } from './auth-actions';

const USER_KEY = 'user';

/**
 * @deprecated The access token is an httpOnly cookie and is intentionally NOT readable from
 * JS. Always returns null. Use `isAuthenticated()` for a presence check and let same-origin
 * fetches carry the cookie automatically. Kept only so legacy call sites compile.
 */
export function getToken(): string | null {
  return null;
}

export interface StoredUser {
  id: string;
  name: string;
  role: string;
  phone: string;
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

/**
 * Client-side "is there a session?" check. Based on the NON-sensitive stored user (the real
 * credential is the httpOnly cookie + backend verification). A guard that passes here but has
 * no valid cookie still gets a 401 from the backend → SessionExpiryGuard bounces it to login.
 */
export function isAuthenticated(): boolean {
  return !!getStoredUser();
}

/**
 * Which backend roles each portal admits. Used by the role-aware route guard so a role can't
 * load another portal. Keep in sync with the backend UserRole enum + proxy ROLE_ROUTES.
 *
 * POSM roles: GIFSY_ADMIN, CLIENT_ADMIN, ASM, AUDITOR, VENDOR_HO, VENDOR_FIELD.
 */
export const PORTAL_ROLES: Record<'admin' | 'review' | 'audit' | 'vendor' | 'field', string[]> = {
  admin: ['GIFSY_ADMIN', 'CLIENT_ADMIN'],
  review: ['ASM', 'CLIENT_ADMIN', 'GIFSY_ADMIN'],
  audit: ['AUDITOR', 'CLIENT_ADMIN', 'GIFSY_ADMIN'],
  vendor: ['VENDOR_HO'],
  field: ['VENDOR_FIELD'],
};

/** The home route for a role — where the guard sends a user who lands on a portal they can't use. */
export function getRoleHome(role?: string | null): string {
  if (!role) return '/auth/login';
  if (PORTAL_ROLES.admin.includes(role)) return '/admin';
  if (PORTAL_ROLES.review.includes(role)) return '/review';
  if (PORTAL_ROLES.audit.includes(role)) return '/audit';
  if (PORTAL_ROLES.vendor.includes(role)) return '/vendor';
  if (PORTAL_ROLES.field.includes(role)) return '/field';
  return '/auth/login';
}

/** Clear the session (httpOnly cookies server-side + local display state) and return to login. */
export async function logout(): Promise<void> {
  try {
    await logoutAction();
  } catch {
    /* even if the cookie-clear call fails, still clear local state + redirect */
  }
  if (typeof window !== 'undefined') {
    localStorage.removeItem(USER_KEY);
    window.location.href = '/auth/login';
  }
}
