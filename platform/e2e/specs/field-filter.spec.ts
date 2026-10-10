import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { ROLES, login, apiToken } from '../support/roles';

/**
 * Field filter-first screen. After a VENDOR_FIELD user logs in, `/field` sends them to
 * `/field/filter` — a mandatory gate with two required searchable dropdowns (RS code + Beat).
 * Picking both and pressing "Show outlets" navigates to /field/sites (the "Recce to do" list)
 * scoped to that RS code + Beat.
 *
 * SELF-CONTAINED: this spec creates its OWN recce-less outlet under a UNIQUE RS + Beat (serviced by
 * fielda's vendor) in beforeAll, then asserts THAT outlet appears, and soft-deletes it in afterAll.
 * Why: /field/sites is the "Recce to do" list (it fetches with pendingRecce:true — only outlets that
 * still owe a recce), so the product CORRECTLY hides an outlet once it has a recce. The old test
 * hard-asserted a seeded 'Site A1', which false-failed on any non-fresh DB where A1 already had a
 * recce. A freshly-created outlet with no recce under a unique filter is the sole match and is always
 * listed, so this is deterministic regardless of seed/other-spec state.
 *
 * The dropdowns are the shared SearchableSelect (platform/src/components/ui/searchable-select.tsx):
 * a text input `data-testid="${prefix}-input"` that filters options, each option rendered as
 * `data-testid="${prefix}-option-<value>"`. The filter screen uses prefixes "filter-rs" and
 * "filter-beat". We type to filter, then click the exact option (robust even with a long list).
 */
const API_URL = process.env.E2E_API_URL || 'http://localhost:4000';
const VENDOR_ID = process.env.E2E_VENDOR_ID || 'cmtcrifhh0002fcih7btytu5d'; // VENDA — fielda's vendor
const ASM_ID = process.env.E2E_ASM_ID || 'cmtcrifhn0004fcihzjzv3z3w'; // asm@kwality.in
const LAT = 19.07;
const LNG = 72.87;

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
    // A dedicated, recce-LESS outlet serviced by fielda's vendor under a UNIQUE RS + Beat — so it is
    // the sole match for that filter and (having no recce) is guaranteed to appear in "Recce to do".
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
    // Soft-delete the dedicated outlet (no hard-delete API); it drops out of the vendor's filter.
    if (siteId && adminTok) {
      await api.patch(`/v1/sites/${siteId}/deactivate`, { headers: { Authorization: `Bearer ${adminTok}` } }).catch(() => undefined);
    }
    await api.dispose();
  });

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

    await pickOption(page, 'filter-rs', RS);
    await pickOption(page, 'filter-beat', BEAT);

    await page.getByRole('button', { name: /show outlets/i }).click();

    await expect(page).toHaveURL(/\/field\/sites(\/|\?|$)/);
    // Our dedicated recce-less outlet is the sole match for this unique RS/Beat → always listed.
    await expect(page.getByText(OUTLET)).toBeVisible();
  });
});
