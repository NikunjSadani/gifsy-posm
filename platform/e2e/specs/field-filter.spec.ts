import { test, expect } from '@playwright/test';
import { ROLES, login } from '../support/roles';

/**
 * Field filter-first screen. After a VENDOR_FIELD user logs in, `/field` sends them to
 * `/field/filter` — a mandatory gate with two required searchable dropdowns (RS code + Beat).
 * Picking both and pressing "Show outlets" navigates to /field/sites scoped to that RS code +
 * Beat. The seeded field role (fielda, vendorA) owns outlet 'Site A1' (rsCode RS001, Beat 1),
 * which still owes a recce — so it appears under RS001 / Beat 1.
 *
 * The dropdowns are the shared SearchableSelect (platform/src/components/ui/searchable-select.tsx):
 * a text input `data-testid="${prefix}-input"` that filters options, each option rendered as
 * `data-testid="${prefix}-option-<value>"`. The filter screen uses prefixes "filter-rs" and
 * "filter-beat". We type to filter, then click the exact option (robust even with a long list).
 */

/** Open a SearchableSelect by prefix, type to filter, then click the exact option. */
async function pickOption(
  page: import('@playwright/test').Page,
  prefix: string,
  value: string,
) {
  await page.getByTestId(`${prefix}-input`).click();
  await page.getByTestId(`${prefix}-input`).fill(value);
  await page.getByTestId(`${prefix}-option-${value}`).click();
}

test.describe('field filter-first screen (RS code + Beat)', () => {
  test('field login lands on the filter screen', async ({ page }) => {
    await login(page, ROLES.field);
    // `/field` redirects to the mandatory filter gate.
    await expect(page).toHaveURL(/\/field\/filter(\/|\?|$)/);
    // Both required dropdowns are present.
    await expect(page.getByTestId('filter-rs-input')).toBeVisible();
    await expect(page.getByTestId('filter-beat-input')).toBeVisible();
    await expect(page.getByRole('button', { name: /show outlets/i })).toBeVisible();
  });

  test('selecting RS + Beat shows the matching outlet', async ({ page }) => {
    await login(page, ROLES.field);
    await expect(page).toHaveURL(/\/field\/filter(\/|\?|$)/);

    await pickOption(page, 'filter-rs', 'RS001');
    await pickOption(page, 'filter-beat', 'Beat 1');

    await page.getByRole('button', { name: /show outlets/i }).click();

    await expect(page).toHaveURL(/\/field\/sites(\/|\?|$)/);
    // The seeded outlet for RS001 / Beat 1 (fielda's vendorA) is listed.
    await expect(page.getByText('Site A1')).toBeVisible();
  });
});
