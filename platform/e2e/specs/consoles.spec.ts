import { test, expect } from '@playwright/test';
import { ROLES, login } from '../support/roles';

/**
 * Each review/operations portal renders for its role. (The full recce→approve→install→audit capture
 * pipeline — native camera file input + geo-fenced submission — is a deeper follow-on; these verify
 * the consoles themselves load and are reachable per role, catching routing/API-wiring regressions.)
 */
test.describe('operational consoles render per role', () => {
  test('ASM → approval dashboard', async ({ page }) => {
    await login(page, ROLES.asm);
    await expect(page.getByRole('heading', { name: 'Approval dashboard' })).toBeVisible();
  });

  test('auditor → audit dashboard', async ({ page }) => {
    await login(page, ROLES.auditor);
    await expect(page.getByRole('heading', { name: 'Audit dashboard' })).toBeVisible();
  });

  test('vendor-HO → fleet analytics', async ({ page }) => {
    await login(page, ROLES.vendorho);
    await expect(page.getByRole('heading', { name: 'Fleet analytics' })).toBeVisible();
  });

  test('field user → recce to-do list', async ({ page }) => {
    await login(page, ROLES.field);
    // Field home redirects into the app shell; the bottom nav is the stable anchor.
    await expect(page.getByRole('link', { name: /recce to do/i })).toBeVisible();
  });
});
