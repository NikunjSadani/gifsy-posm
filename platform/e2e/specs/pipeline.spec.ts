import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROLES, login, apiToken } from '../support/roles';

/**
 * Full capture pipeline, end-to-end: field RECCE → ASM APPROVE → field INSTALL → auditor AUDIT.
 *
 * Capture (recce + install) is done through the real backend API (the native camera file-input is
 * the fragile bit to automate); the two APPROVAL gates — the regression-prone review/audit consoles —
 * are driven through the REAL BROWSER. Deterministic: it creates its own dedicated site, uses two
 * DISTINCT photos (so the identical-photo anti-fraud guard passes) with a geo fix on the site's
 * coordinates (so the geo-fence passes), then soft-deletes the site at the end.
 *
 * Needs the API reachable at E2E_API_URL (default http://localhost:4000) and the seeded vendor/ASM
 * (local ids defaulted below; override with E2E_VENDOR_ID / E2E_ASM_ID / E2E_CLIENT_ID for staging).
 */
const API_URL = process.env.E2E_API_URL || 'http://localhost:4000';
const VENDOR_ID = process.env.E2E_VENDOR_ID || 'cmtcrifhh0002fcih7btytu5d'; // VENDA — fielda's vendor
const ASM_ID = process.env.E2E_ASM_ID || 'cmtcrifhn0004fcihzjzv3z3w'; // asm@kwality.in
const LAT = 19.07;
const LNG = 72.87;

// Resolved from the suite's cwd (platform/ — where `npm run e2e` runs).
const RECCE_PNG = resolve(process.cwd(), 'public/kwality-walls-logo.png');
const INSTALL_PNG = resolve(process.cwd(), 'public/icons/icon-192.png'); // DISTINCT from the recce photo

async function uploadPhoto(ctx: APIRequestContext, token: string, file: string, name: string, uniq: string): Promise<string> {
  // Append a unique marker after the PNG's IEND so EVERY upload is byte-unique — the app's exact-byte
  // identical-photo guard (image_hashes unique) would otherwise reject a photo whose bytes a prior run
  // already registered. Trailing bytes don't affect the magic-byte sniff or rendering.
  const buffer = Buffer.concat([readFileSync(file), Buffer.from(`\n<<e2e:${uniq}>>`)]);
  const res = await ctx.post('/v1/media/upload', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name, mimeType: 'image/png', buffer } },
  });
  expect(res.ok(), `upload ${name}: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data.key as string;
}

/** Click a confirm-dialog Approve: the trigger button opens the dialog, then its confirm button. */
async function approveWithConfirm(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  // The confirm dialog adds a second "Approve" button on top — click the last one.
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
}

test.describe.serial('capture pipeline (recce → approve → install → audit)', () => {
  let api: APIRequestContext;
  let adminTok = '';
  let fieldTok = '';
  let siteId = '';
  let posmTypeId = '';
  let recceId = '';
  let reccePosmId = '';
  let installId = '';
  const code = `E2E-PIPE-${Date.now().toString().slice(-7)}`;

  test.beforeAll(async () => {
    api = await pwRequest.newContext({ baseURL: API_URL });
    adminTok = await apiToken(api, ROLES.admin);
    fieldTok = await apiToken(api, ROLES.field);

    // An active POSM type to capture against.
    const typesRes = await api.get('/v1/posm-types', { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(typesRes.ok()).toBeTruthy();
    const types = (await typesRes.json()).data.filter((t: { isActive: boolean }) => t.isActive);
    expect(types.length, 'need at least one active POSM type seeded').toBeGreaterThan(0);
    posmTypeId = types[0].id;

    const res = await api.post('/v1/sites', {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: { code, name: 'E2E Pipeline Site', vendorId: VENDOR_ID, asmUserId: ASM_ID, lat: LAT, lng: LNG },
    });
    expect(res.ok(), `create site: ${await res.text()}`).toBeTruthy();
    siteId = (await res.json()).data.id;
  });

  test.afterAll(async () => {
    // Soft-delete the dedicated site (no hard-delete API); recce/install stay attached but hidden.
    if (siteId && adminTok) {
      await api.patch(`/v1/sites/${siteId}/deactivate`, { headers: { Authorization: `Bearer ${adminTok}` } }).catch(() => undefined);
    }
    await api.dispose();
  });

  test('1 · field submits a recce (API capture)', async () => {
    const key = await uploadPhoto(api, fieldTok, RECCE_PNG, 'recce.png', `${code}-recce`);
    const res = await api.post('/v1/recce', {
      headers: { Authorization: `Bearer ${fieldTok}` },
      data: { siteId, posms: [{ posmTypeId, dimensions: { width: 30, height: 40, unit: 'cm' }, photo: { key, geo: { lat: LAT, lng: LNG, accuracy: 8 } }, markup: { version: 1, shapes: [{ type: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.25 }] } }] },
    });
    expect(res.ok(), `submit recce: ${await res.text()}`).toBeTruthy();
    const body = (await res.json()).data;
    recceId = body.id;
    expect(body.status).toBe('SUBMITTED');
  });

  test('2 · ASM approves the recce (browser)', async ({ page }) => {
    await login(page, ROLES.asm);
    await page.goto(`/review/recces/${recceId}`);
    await approveWithConfirm(page);
    await expect(page.getByText(/recce approved/i)).toBeVisible();
  });

  test('3 · recce is APPROVED; capture reccePosmId (API)', async () => {
    const res = await api.get(`/v1/approval/recces/${recceId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.status).toBe('APPROVED');
    reccePosmId = d.posms[0].id;
    expect(reccePosmId).toBeTruthy();
  });

  test('3b · HO approves the recce (API) — now required before installation', async () => {
    // The recce HO-review gate: after the ASM approval, an HO (CLIENT_ADMIN/GIFSY_ADMIN) must
    // approve the recce before installation is allowed, else POST /v1/installation returns 409.
    const res = await api.post(`/v1/recce-ho-review/recces/${recceId}/approve`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok(), `HO approve recce: ${await res.text()}`).toBeTruthy();
  });

  test('4 · field submits the installation (API capture, distinct photo)', async () => {
    const key = await uploadPhoto(api, fieldTok, INSTALL_PNG, 'install.png', `${code}-install`);
    const res = await api.post('/v1/installation', {
      headers: { Authorization: `Bearer ${fieldTok}` },
      data: { siteId, posms: [{ reccePosmId, photo: { key, geo: { lat: LAT, lng: LNG, accuracy: 8 } } }] },
    });
    expect(res.ok(), `submit installation: ${await res.text()}`).toBeTruthy();
    installId = (await res.json()).data.id;
    expect(installId).toBeTruthy();
  });

  test('5 · auditor approves the installation (browser)', async ({ page }) => {
    await login(page, ROLES.auditor);
    await page.goto(`/audit/installations/${installId}`);
    await approveWithConfirm(page);
    await expect(page.getByText(/approved/i)).toBeVisible();
  });

  test('6 · installation is AUDIT_APPROVED (API)', async () => {
    const res = await api.get(`/v1/audit/installations/${installId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.status).toBe('AUDIT_APPROVED');
  });
});
