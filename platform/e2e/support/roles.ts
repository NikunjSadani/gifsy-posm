import { type Page, type BrowserContext, type APIRequestContext, expect } from '@playwright/test';

/** Shared seed login password. Local/staging only — never a real prod secret. */
export const PASSWORD = process.env.E2E_PASSWORD || 'Password123';
const DOMAIN = process.env.E2E_EMAIL_DOMAIN || 'kwality.in';
const CLIENT_ID = process.env.E2E_CLIENT_ID || 'cmtcriffz0000fcihcsz6qzp8';
// Remote (deployed) targets need a longer post-login nav wait than localhost (network + cold starts).
const NAV_TIMEOUT = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL || 'localhost') ? 20_000 : 45_000;

export interface Role {
  key: string;
  email: string;
  /** The portal the role lands on after login (getRoleHome). */
  home: string;
  label: string;
}

/** The six seeded roles (seed-verify.mjs). `home` mirrors auth-client.getRoleHome. */
export const ROLES: Record<string, Role> = {
  admin: { key: 'admin', email: `admin@${DOMAIN}`, home: '/admin', label: 'CLIENT_ADMIN' },
  asm: { key: 'asm', email: `asm@${DOMAIN}`, home: '/review', label: 'ASM' },
  auditor: { key: 'auditor', email: `auditor@${DOMAIN}`, home: '/audit', label: 'AUDITOR' },
  field: { key: 'field', email: `fielda@${DOMAIN}`, home: '/field', label: 'VENDOR_FIELD' },
  vendorho: { key: 'vendorho', email: `vendorho@${DOMAIN}`, home: '/vendor', label: 'VENDOR_HO' },
};

/** A regex that matches the home path OR any sub-path of it (e.g. /field → /field/sites). */
export function homeRegex(home: string): RegExp {
  return new RegExp(`${home.replace('/', '\\/')}(\\/|$|\\?)`);
}

// ── Login-throttle friendliness (deployed envs only) ────────────────────────────────────────────
// The /v1/auth/login route is rate-limited to 10 requests/min per IP (brute-force protection), and it
// is ENFORCED on deployed envs (off locally). A suite that exercises 5 roles + API capture issues far
// more than that in bursts, so we: (a) log in each role ONCE and reuse its httpOnly auth cookies /
// API token (workers:1 → one shared cache for the run), and (b) gate every *real* login so we never
// exceed the limit. Net effect: a handful of logins, spread under the cap — green against staging/prod.
type CookieList = Parameters<BrowserContext['addCookies']>[0];
const cookieCache: Record<string, CookieList> = {};
const apiTokenCache: Record<string, string> = {};
const loginTimestamps: number[] = [];

const REMOTE = !/localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL || 'localhost');
async function loginGate(): Promise<void> {
  if (!REMOTE) return; // throttling is off on localhost — no need to pace logins there.
  const now = Date.now();
  while (loginTimestamps.length && now - loginTimestamps[0] > 60_000) loginTimestamps.shift();
  // Deployed login limit is 10/min per IP; stay well under it (margin for un-gated attempts + drift).
  if (loginTimestamps.length >= 6) {
    await new Promise((r) => setTimeout(r, 60_000 - (now - loginTimestamps[0]) + 1_000));
    return loginGate();
  }
  loginTimestamps.push(Date.now());
}

/** Raw UI form login — always hits the real /auth/login flow. Used by auth.spec (which TESTS the
 *  form) and as the cache-populator for `login()`. Rate-gated. */
export async function loginViaForm(page: Page, role: Role): Promise<void> {
  await loginGate();
  await page.goto('/auth/login');
  await page.getByPlaceholder('you@company.com').fill(role.email);
  await page.getByPlaceholder('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(homeRegex(role.home), { timeout: NAV_TIMEOUT });
  await expect(page).toHaveURL(homeRegex(role.home));
}

/** Log in as `role`, reusing the role's cached auth cookies when available (no extra login request,
 *  so the login throttle is not hit). First use per role does one real form login and caches it. */
export async function login(page: Page, role: Role): Promise<void> {
  const cached = cookieCache[role.key];
  if (cached) {
    await page.context().addCookies(cached);
    await page.goto(role.home);
    await expect(page).toHaveURL(homeRegex(role.home));
    return;
  }
  await loginViaForm(page, role);
  const { cookies } = await page.context().storageState();
  cookieCache[role.key] = cookies.filter((c) => c.name === 'token' || c.name === 'refresh_token');
}

/** Cached API access token for `role` (login once per role, reuse). Rate-gated on first use. */
export async function apiToken(ctx: APIRequestContext, role: Role): Promise<string> {
  if (apiTokenCache[role.key]) return apiTokenCache[role.key];
  await loginGate();
  const res = await ctx.post('/v1/auth/login', { data: { clientId: CLIENT_ID, email: role.email, password: PASSWORD } });
  expect(res.ok(), `apiToken ${role.email}: ${await res.text()}`).toBeTruthy();
  const token = (await res.json()).data.accessToken as string;
  apiTokenCache[role.key] = token;
  return token;
}
