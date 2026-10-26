import { test, expect } from '@playwright/test';
import { ROLES, login } from '../support/roles';

test.describe('recce report', () => {
  test('renders the grouped, frozen-column table', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto('/admin/execution-report');
    // Phase A renamed the screen "Execution report" -> "Recce Report" (route unchanged).
    await expect(page.getByRole('heading', { name: 'Recce Report' })).toBeVisible();
    // Grouped 2-row header + the frozen identity column.
    await expect(page.getByText('OUTLET CODE').first()).toBeVisible();
    await expect(page.getByText('OUTLET NAME').first()).toBeVisible();
  });

  test('downloads the .xlsx export', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto('/admin/execution-report');
    await expect(page.getByRole('heading', { name: 'Recce Report' })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 25_000 }),
      page.getByRole('button', { name: /download \.xlsx/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });
});
