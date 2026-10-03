import { test, expect } from '@playwright/test';
import { ROLES, login } from '../support/roles';

/**
 * Role route-gating is enforced at the edge (proxy.ts ROLE_ROUTES). A role visiting a portal it is
 * not allowed into must be redirected away — never land on the gated path. These are the
 * security-critical cross-role isolation checks.
 */
test.describe('role route-gating (cross-portal isolation)', () => {
  test('a field user cannot open the admin portal', async ({ page }) => {
    await login(page, ROLES.field);
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin(\/|$)/);
  });

  test('an admin cannot open the field app', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto('/field');
    await expect(page).not.toHaveURL(/\/field(\/|$)/);
  });

  test('a vendor-HO cannot open the admin portal', async ({ page }) => {
    await login(page, ROLES.vendorho);
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin(\/|$)/);
  });

  test('an ASM cannot open the auditor console', async ({ page }) => {
    await login(page, ROLES.asm);
    await page.goto('/audit');
    await expect(page).not.toHaveURL(/\/audit(\/|$)/);
  });

  test('an auditor cannot open the ASM review console', async ({ page }) => {
    await login(page, ROLES.auditor);
    await page.goto('/review');
    await expect(page).not.toHaveURL(/\/review(\/|$)/);
  });
});
