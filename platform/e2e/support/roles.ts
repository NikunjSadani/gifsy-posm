import { type Page, expect } from '@playwright/test';

/** Shared seed login password. Local/staging only — never a real prod secret. */
export const PASSWORD = process.env.E2E_PASSWORD || 'Password123';
const DOMAIN = process.env.E2E_EMAIL_DOMAIN || 'kwality.in';
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

/** Log in through the real UI as `role` and wait until the role's home portal is reached. */
export async function login(page: Page, role: Role): Promise<void> {
  await page.goto('/auth/login');
  await page.getByPlaceholder('you@company.com').fill(role.email);
  await page.getByPlaceholder('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(homeRegex(role.home), { timeout: NAV_TIMEOUT });
  await expect(page).toHaveURL(homeRegex(role.home));
}
