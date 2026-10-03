import { test, expect } from '@playwright/test';
import { ROLES, login, PASSWORD, homeRegex } from '../support/roles';

test.describe('authentication', () => {
  for (const role of Object.values(ROLES)) {
    test(`${role.key} (${role.label}) logs in and lands on ${role.home}`, async ({ page }) => {
      await login(page, role);
      await expect(page).toHaveURL(homeRegex(role.home));
    });
  }

  test('a wrong password is rejected and stays on the login page', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByPlaceholder('you@company.com').fill(ROLES.admin.email);
    await page.getByPlaceholder('Your password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('an unauthenticated visit to a portal redirects to login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('ensures the shared password is set (guards a mis-seeded env)', async () => {
    expect(PASSWORD.length).toBeGreaterThanOrEqual(8);
  });
});
