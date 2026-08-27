'use client';

import { useEffect } from 'react';
import { refreshSession } from '@/lib/auth-actions';

/**
 * Pure decision: should an API response trigger a re-login redirect?
 *
 * Deliberate scope:
 *  - ONLY 401 (authentication failed → token missing/expired/invalid). 403 (Forbidden
 *    = authenticated but not permitted) is intentionally NOT handled, so RBAC errors
 *    still surface in-page instead of bouncing the user out.
 *  - ONLY same-origin `/api/*` calls, EXCLUDING `/api/auth/*` (the login flow itself
 *    legitimately returns 4xx on a bad OTP / expired OTP).
 *  - Never when already on an `/auth/*` page (avoids a redirect loop).
 */
export function shouldRedirectOnAuth(
  status: number,
  url: string,
  pathname: string,
): boolean {
  if (status !== 401) return false;
  if (!url.includes('/api/')) return false;
  if (url.includes('/api/auth/')) return false;
  if (pathname.startsWith('/auth/')) return false;
  return true;
}

/**
 * Pure decision: should a 403 surface a "no permission" notice (RBAC Option-X P6)?
 *
 * ONLY 403 (authenticated but forbidden) on a same-origin /api/* call, EXCLUDING
 * /api/auth/* (its 4xx are the login/OTP flow, not RBAC). 403 is NOT a redirect —
 * the page stays put and a clear toast is shown instead of a raw error. The toast
 * listener further scopes the notice to GIFSY_STAFF.
 */
export function shouldNotifyForbidden(status: number, url: string): boolean {
  if (status !== 403) return false;
  if (!url.includes('/api/')) return false;
  if (url.includes('/api/auth/')) return false;
  return true;
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

// Module-level: install the fetch patch once per app session, and fire the redirect
// at most once even if several in-flight /api calls 401 together.
let installed = false;
let redirecting = false;

// Single-flight refresh: several /api calls expiring together share ONE refresh so the
// single-use refresh token is rotated exactly once (concurrent refreshes would revoke
// each other and spuriously log the user out — the classic trap this guards against).
let refreshing: Promise<boolean> | null = null;
function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = refreshSession()
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * SessionExpiryGuard — graceful recovery from an expired / invalid token.
 *
 * When an access token expires the proxy answers `/api/*` calls with 401. This patches
 * window.fetch to detect any qualifying 401 (see shouldRedirectOnAuth) and FIRST attempt
 * a silent refresh using the httpOnly refresh-token cookie (AF-6) — on success the
 * original request is retried transparently and the user never notices. Only if the
 * refresh is unavailable/fails (refresh token expired or revoked) does it bounce the
 * user to /auth/login. Mounted once, app-wide, in the root layout.
 */
export default function SessionExpiryGuard() {
  useEffect(() => {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    const originalFetch = window.fetch.bind(window);
    const patched: typeof window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      try {
        // RBAC Option-X P6: a forbidden (403) /api call surfaces a clear "no permission"
        // toast instead of a raw error. Fire-and-forget event; the listener (staff-scoped)
        // decides whether to show it. Never blocks or alters the response.
        if (shouldNotifyForbidden(res.status, extractUrl(input))) {
          window.dispatchEvent(new CustomEvent('api:forbidden', { detail: { url: extractUrl(input) } }));
        }
        if (
          !redirecting &&
          shouldRedirectOnAuth(res.status, extractUrl(input), window.location.pathname)
        ) {
          // Try a silent refresh before giving up (single-flight across concurrent 401s).
          const refreshed = await refreshOnce();
          if (refreshed && !redirecting) {
            // New cookie is set — retry the original request once (unpatched, so a
            // second 401 can't recurse into another refresh).
            const retry = await originalFetch(input, init);
            if (retry.status !== 401) return retry;
          }
          // Refresh unavailable/failed, or the retry still 401s → the session is dead.
          if (!redirecting) {
            redirecting = true;
            try {
              localStorage.removeItem('token');
              localStorage.removeItem('user');
            } catch {
              /* storage blocked — proceed to login anyway */
            }
            window.location.assign('/auth/login?expired=1');
          }
        }
      } catch {
        /* the guard must NEVER break a fetch */
      }
      return res;
    };
    window.fetch = patched;
    // Intentionally not restored on unmount: the patch must persist for the whole app
    // session, and restoring could race with in-flight requests.
  }, []);

  return null;
}
