import { test, expect } from '@playwright/test';
import { ROLES, login } from '../support/roles';

test.describe('field Element catalogue', () => {
  test('a field user sees the catalogue with the seeded Element type', async ({ page }) => {
    await login(page, ROLES.field);
    await page.goto('/field/catalogue');
    await expect(page.getByRole('heading', { name: 'Element Catalogue' })).toBeVisible();
    await expect(page.getByText('Standard Board')).toBeVisible();
  });

  test('the catalogue is reachable from the field bottom nav', async ({ page }) => {
    await login(page, ROLES.field);
    await page.getByRole('link', { name: /catalogue/i }).click();
    await expect(page).toHaveURL(/\/field\/catalogue/);
    await expect(page.getByRole('heading', { name: 'Element Catalogue' })).toBeVisible();
  });
});
