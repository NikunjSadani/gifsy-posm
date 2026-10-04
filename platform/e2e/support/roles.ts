import { type Page, type APIRequestContext, expect } from '@playwright/test';

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

// The /v1/auth/login route is rate-limited per IP (brute-force protection), enforced on deployed envs
// (off locally). The go-live smoke suite logs in many times, so the TEST env (staging) relaxes that
// limit via AUTH_LOGIN_THROTTLE_LIMIT while PROD stays strict. apiToken caches per role so each API
// role logs in once.
const apiTokenCache: Record<string, string> = {};

/** Raw UI form login — always hits the real /auth/login flow. Used by auth.spec (which TESTS the
 *  form) and by `login()`. */
export async function loginViaForm(page: Page, role: Role): Promise<void> {
  await page.goto('/auth/login');
  await page.getByPlaceholder('you@company.com').fill(role.email);
  await page.getByPlaceholder('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(homeRegex(role.home), { timeout: NAV_TIMEOUT });
  await expect(page).toHaveURL(homeRegex(role.home));
}

/** Log in as `role` via the real form (rate-gated on deployed envs). Alias of loginViaForm — a
 *  cookie-reuse fast path was tried but was net-negative (flaky cross-context cookie injection),
 *  so the robust path for a green DEPLOYED-env gate is a server-side login-throttle exemption on
 *  the test env, not client-side juggling. */
export const login = loginViaForm;

/** Cached API access token for `role` (login once per role, reuse). */
export async function apiToken(ctx: APIRequestContext, role: Role): Promise<string> {
  if (apiTokenCache[role.key]) return apiTokenCache[role.key];
  const res = await ctx.post('/v1/auth/login', { data: { clientId: CLIENT_ID, email: role.email, password: PASSWORD } });
  expect(res.ok(), `apiToken ${role.email}: ${await res.text()}`).toBeTruthy();
  const token = (await res.json()).data.accessToken as string;
  apiTokenCache[role.key] = token;
  return token;
}
