import { test, expect } from '@playwright/test';
import { ROLES, login } from '../support/roles';

test.describe('admin portal', () => {
  test('masters overview renders the four count cards', async ({ page }) => {
    await login(page, ROLES.admin);
    await expect(page.getByRole('heading', { name: 'Masters overview' })).toBeVisible();
    for (const label of ['Vendors', 'Users', 'POSM Types', 'Sites']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('POSM Types list renders the seeded type', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto('/admin/posm-types');
    await expect(page.getByRole('heading', { name: 'POSM Types' })).toBeVisible();
    await expect(page.getByText('STD', { exact: true }).first()).toBeVisible();
  });

  test('can create and then deactivate a POSM type', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto('/admin/posm-types');

    const code = `E2E-${Date.now().toString().slice(-6)}`;
    await page.getByRole('button', { name: /new posm type/i }).click();
    await page.getByLabel('Code').fill(code);
    await page.getByLabel('Name').fill('E2E Temp Type');
    await page.getByRole('button', { name: /create posm type/i }).click();

    // It appears in the list…
    await expect(page.getByText(code, { exact: true })).toBeVisible();

    // …then deactivate it (row action → confirm), so the suite leaves only an inactive temp row.
    const row = page.getByRole('row', { name: new RegExp(code) });
    await row.getByRole('button', { name: /deactivate/i }).click();
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText('POSM type deactivated')).toBeVisible();
  });
});
