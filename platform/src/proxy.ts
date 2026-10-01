/**
 * Next.js Edge Proxy (proxy.ts) — auth + minimal tenant tagging.
 *
 * Runs on every request before any page or API route.
 *
 * Step 1 — Tenant tag (minimal):
 *   Derives a best-effort tenant slug from the first hostname label and forwards it as
 *   `x-tenant-slug` so Server Components/API routes can read it. The loyalty DB-routing /
 *   branded-host resolution is intentionally stripped for the chassis — a later wave can
 *   re-introduce real per-tenant resolution behind this same header.
 *
 * Step 2 — Auth:
 *   Verifies the httpOnly `token` cookie (jose), role-gates PAGE routes, injects the backend
 *   `Authorization: Bearer` for `/api/*`, and silently refreshes an expired access token on a
 *   full-page navigation using the 7-day rolling refresh cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify, type JWTPayload } from 'jose'
import {
  REFRESH_MAX_AGE,
  accessCookieMaxAge,
  refreshTokensViaBackend,
  sessionCookieOptions,
} from '@/lib/auth-refresh'

// Refuse to run in production without a real JWT_SECRET — never fall back to a weak default.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set in production')
}

const PUBLIC_PATHS = [
  '/auth/login',
  '/api/auth/login', // email+password login (replaced send-otp/verify-otp, 2026-10-01)
  '/version', // build-id probe for the online-only UpdateNudge — exposes only an opaque token
  '/_next',
  '/favicon.ico',
]
// NOTE: `/api/media/view` is deliberately NOT public. The backend MediaController.view is
// role-gated and reads the caller from a JWT (`@CurrentUser`) — there is no signed-token public
// variant in this app — so an in-app `<img src="/api/media/view?key=…">` must flow through the
// edge auth gate below, which injects the cookie→Bearer the backend requires. Listing it here
// (a leftover from a chassis that had tokenized public views) made every in-app photo 401.

/**
 * PAGE-route → allowed roles. POSM role set: GIFSY_ADMIN, CLIENT_ADMIN, ASM, AUDITOR,
 * VENDOR_HO, VENDOR_FIELD. These are the portal prefixes the later waves build out; the
 * map only gates PAGE navigation (API-route role enforcement is the backend's job).
 */
export const ROLE_ROUTES: Record<string, string[]> = {
  '/admin':  ['GIFSY_ADMIN', 'CLIENT_ADMIN'], // masters, config, dashboards
  '/review': ['ASM', 'CLIENT_ADMIN', 'GIFSY_ADMIN'], // ASM recce-approval console
  '/audit':  ['AUDITOR', 'CLIENT_ADMIN', 'GIFSY_ADMIN'], // auditor console
  '/vendor': ['VENDOR_HO'], // vendor head-office console
  '/field':  ['VENDOR_FIELD'], // vendor field recce/install app
}

function tenantSlugFromHost(hostname: string): string {
  // First label of the host, minus any port. `posm.example.com` → `posm`; bare host → ''.
  const label = hostname.split(':')[0].split('.')[0]
  return /^[a-z0-9-]+$/i.test(label) ? label.toLowerCase() : ''
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const headers = new Headers(request.headers)
  headers.set('x-pathname', pathname)

  // ── Step 1: minimal tenant tag ─────────────────────────────────────────────
  const slug = tenantSlugFromHost(request.nextUrl.hostname)
  headers.set('x-tenant-slug', slug)

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers } })
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // ── Step 2: Auth ───────────────────────────────────────────────────────────
  // The access token is read ONLY from the httpOnly `token` cookie — never from a
  // client-supplied Authorization header. Strip any inbound Authorization and inject our
  // own from the cookie so the backend's JwtStrategy keeps working unchanged.
  headers.delete('authorization')

  const token = request.cookies.get('token')?.value
  const isApi = pathname.startsWith('/api/')
  const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '')

  let payload: JWTPayload | null = null
  if (token) {
    try {
      payload = (await jwtVerify(token, secret)).payload
    } catch {
      payload = null
    }
  }

  // Happy path — a valid, unexpired access token: role-gate + forward with injected auth.
  if (token && payload) {
    return forwardAuthed(request, headers, token, payload)
  }

  // /api/* with a missing/expired token: keep 401ing. The client SessionExpiryGuard owns
  // the XHR path — it silently refreshes on the 401 and retries transparently.
  if (isApi) {
    return NextResponse.json(
      { success: false, error: token ? 'Invalid token' : 'Unauthorized' },
      { status: 401 },
    )
  }

  // PAGE navigation / hard reload: the ~60m access cookie has expired while the 7d refresh
  // cookie is still valid. Silently refresh SERVER-SIDE so the user isn't bounced hourly.
  const refreshToken = request.cookies.get('refresh_token')?.value
  if (refreshToken) {
    const refreshed = await refreshTokensViaBackend(refreshToken)
    if (refreshed) {
      let newPayload: JWTPayload | null = null
      try {
        newPayload = (await jwtVerify(refreshed.accessToken, secret)).payload
      } catch {
        newPayload = null
      }
      if (newPayload) {
        const res = forwardAuthed(request, headers, refreshed.accessToken, newPayload)
        res.cookies.set('token', refreshed.accessToken, sessionCookieOptions(accessCookieMaxAge(refreshed.accessToken)))
        if (refreshed.refreshToken) {
          res.cookies.set('refresh_token', refreshed.refreshToken, sessionCookieOptions(REFRESH_MAX_AGE))
        }
        return res
      }
    }
    // The refresh itself failed → the refresh token is truly dead. Do NOT delete the cookies
    // (a contended/just-rotated refresh can fail transiently); bounce to login with ?expired=1.
    return NextResponse.redirect(new URL('/auth/login?expired=1', request.url))
  }

  // No refresh token → never established a session (or fully logged out) → plain login.
  return NextResponse.redirect(new URL('/auth/login', request.url))
}

/**
 * Role-gate a verified identity and forward the request to the backend with injected auth
 * headers. Returns a role-failure redirect to /auth/login, or the next() passthrough carrying
 * the Bearer + identity headers. `headers` has already had any inbound authorization stripped.
 */
function forwardAuthed(
  request: NextRequest,
  headers: Headers,
  token: string,
  payload: JWTPayload,
): NextResponse {
  const { pathname } = request.nextUrl
  const role = payload.role as string

  for (const [prefix, allowedRoles] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(prefix) && !allowedRoles.includes(role)) {
      // ROLE_ROUTES lists only PAGE prefixes — an /api/* path never matches one, so a
      // wrong-role match here is always a page request → redirect to login.
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }
  }

  headers.set('authorization', `Bearer ${token}`)
  headers.set('x-user-id', payload.sub as string) // JWT user id is the `sub` claim
  headers.set('x-user-role', role)
  if (payload.vendorId) headers.set('x-vendor-id', payload.vendorId as string)

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: [
    // Static/brand assets are excluded so they serve WITHOUT the auth gate: `icons/` (install +
    // maskable icons, apple-touch), `manifest.webmanifest` (browsers fetch it with no
    // credentials), and the `kwality-walls-logo` brand mark — the login/header logo must render
    // for UNAUTHENTICATED visitors too (otherwise the middleware 307-redirects the image request
    // and it breaks on the login screen, and next/image optimisation 400s on the redirect).
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|kwality-walls-logo\\.|logos/|favicons/|icons/|images/).*)',
  ],
}
