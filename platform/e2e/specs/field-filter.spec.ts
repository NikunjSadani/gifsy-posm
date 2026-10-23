import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { ROLES, login, apiToken } from '../support/roles';

/**
 * Field "Recce to do" screen — now a ONE-STEP flow. After a VENDOR_FIELD user logs in, `/field`
 * sends them to `/field/sites`, which hosts the filter controls INLINE at the top (RS + Beat) with
 * the outlet list live below. Picking an RS shows that RS's recce-to-do outlets immediately (no
 * "Show outlets" step); Beat is OPTIONAL and multi-select (it only narrows the already-shown list).
 * `/field/filter` now just redirects to `/field/sites` (old links still resolve).
 *
 * SELF-CONTAINED: creates its OWN recce-less outlet under a UNIQUE RS + Beat (serviced by fielda's
 * vendor) in beforeAll, asserts THAT outlet appears, and soft-deletes it in afterAll. Why: the list
 * is "Recce to do" (pendingRecce:true — only outlets that still owe a recce), so a freshly-created
 * recce-less outlet under a unique RS is the sole, always-listed match regardless of seed state.
 *
 * The RS control is the shared SearchableSelect; the Beat control the new SearchableMultiSelect —
 * both expose `${prefix}-input` and `${prefix}-option-<value>` testids (prefixes "filter-rs" /
 * "filter-beat"), and the RS option value is the RS CODE. We type to filter, then click the option.
 */
const API_URL = process.env.E2E_API_URL || 'http://localhost:4000';
const VENDOR_ID = process.env.E2E_VENDOR_ID || 'cmtcrifhh0002fcih7btytu5d'; // VENDA — fielda's vendor
const ASM_ID = process.env.E2E_ASM_ID || 'cmtcrifhn0004fcihzjzv3z3w'; // asm@kwality.in
const LAT = 19.07;
const LNG = 72.87;

/** Open a combobox by prefix, type to filter, then click the exact option (by value). */
async function pickOption(
  page: import('@playwright/test').Page,
  prefix: string,
  value: string,
) {
  await page.getByTestId(`${prefix}-input`).click();
  await page.getByTestId(`${prefix}-input`).fill(value);
  await page.getByTestId(`${prefix}-option-${value}`).click();
}

test.describe('field recce-to-do (one-step RS + optional Beat filter)', () => {
  let api: APIRequestContext;
  let adminTok = '';
  let siteId = '';
  const tag = Date.now().toString().slice(-7);
  const RS = `E2ERS${tag}`;
  const BEAT = `E2E Beat ${tag}`;
  const OUTLET = `E2E Filter Outlet ${tag}`;

  test.beforeAll(async () => {
    api = await pwRequest.newContext({ baseURL: API_URL });
    adminTok = await apiToken(api, ROLES.admin);
    const res = await api.post('/v1/sites', {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: {
        code: `E2E-FLT-${tag}`, name: OUTLET, vendorId: VENDOR_ID, asmUserId: ASM_ID,
        lat: LAT, lng: LNG, rsCode: RS, beatName: BEAT,
      },
    });
    expect(res.ok(), `create filter test site: ${await res.text()}`).toBeTruthy();
    siteId = (await res.json()).data.id;
  });

  test.afterAll(async () => {
    if (siteId && adminTok) {
      await api.patch(`/v1/sites/${siteId}/deactivate`, { headers: { Authorization: `Bearer ${adminTok}` } }).catch(() => undefined);
    }
    await api.dispose();
  });

  test('field login lands on the merged recce-to-do screen with inline filters', async ({ page }) => {
    await login(page, ROLES.field);
    // `/field` redirects to the merged list, which hosts the filter controls inline.
    await expect(page).toHaveURL(/\/field\/sites(\/|\?|$)/);
    await expect(page.getByTestId('filter-rs-input')).toBeVisible();
    await expect(page.getByTestId('filter-beat-input')).toBeVisible();
    // No separate "Show outlets" step any more.
    await expect(page.getByRole('button', { name: /show outlets/i })).toHaveCount(0);
  });

  test('picking an RS shows its outlets live (Beat is optional)', async ({ page }) => {
    await login(page, ROLES.field);
    await expect(page).toHaveURL(/\/field\/sites(\/|\?|$)/);

    // Pick the RS only — no beat. The list refreshes in place; our recce-less outlet is the sole
    // match for this unique RS and appears without any further step.
    await pickOption(page, 'filter-rs', RS);
    await expect(page.getByText(OUTLET)).toBeVisible();
  });
});
