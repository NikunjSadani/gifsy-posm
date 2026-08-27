'use server';

/**
 * Server actions that manage the httpOnly auth cookies (rolling sessions).
 *
 * The access token lives ONLY in an httpOnly `token` cookie (set at login). It is never
 * readable by JS, so operations that must CHANGE the active token — silent refresh and
 * logout — run here, server-side, where `cookies()` can be mutated.
 *
 * The loyalty multi-brand operator flow (assume/exit-tenant) is stripped from the chassis.
 */

import { cookies } from 'next/headers';
import {
  REFRESH_MAX_AGE,
  accessCookieMaxAge,
  refreshTokensViaBackend,
  sessionCookieOptions as cookieOptions,
} from '@/lib/auth-refresh';

/**
 * Silently refresh an expired access token using the (single-use, rotating) httpOnly
 * refresh-token cookie. Called by SessionExpiryGuard on a 401 BEFORE bouncing to login, so a
 * normal session-expiry doesn't interrupt the user. On success the new access + refresh
 * cookies are set and `{ ok: true }` is returned; the caller retries the request. On failure
 * the cookies are LEFT INTACT: with the backend returning successor tokens on a
 * contended/just-rotated refresh (multi-tab), deleting the refresh cookie here would strand
 * other tabs on a session that is actually still alive.
 */
export async function refreshSession(): Promise<{ ok: boolean }> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;
  if (!refreshToken) return { ok: false };

  const refreshed = await refreshTokensViaBackend(refreshToken);
  if (!refreshed) return { ok: false };

  cookieStore.set('token', refreshed.accessToken, cookieOptions(accessCookieMaxAge(refreshed.accessToken)));
  if (refreshed.refreshToken) {
    cookieStore.set('refresh_token', refreshed.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  }
  return { ok: true };
}

/** Clear the auth cookies on logout (the token is httpOnly so only the server can). */
export async function logoutAction(): Promise<{ success: boolean }> {
  const cookieStore = await cookies();
  cookieStore.delete('token');
  cookieStore.delete('refresh_token');
  return { success: true };
}
