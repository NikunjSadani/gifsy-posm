import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROLES, login, apiToken } from '../support/roles';

/**
 * MANUAL RECCE pipeline, end-to-end (Manual Recce feature, Wave B / lane B2).
 *
 * The field exec submits a MANUAL recce (field-typed outlet, no master row) that SKIPS the ASM
 * stage and lands directly in the HO queue. HO approves it with a mandatory, newly-assigned Outlet
 * ID; the recce then installs (recce-keyed) and the installation is audited — the exact existing
 * downstream flow. Also proves the two invariants the feature hinges on: an outlet may carry
 * UNLIMITED manual recces (attach-to-existing by Outlet ID) but only ONE app recce.
 *
 * Determinism mirrors pipeline.spec / ho-review.spec: capture (recce + install) runs through the
 * backend API (the native camera file-input is the fragile bit); the regression-prone APPROVAL
 * consoles — the HO recce desk (mandatory Outlet ID) and the auditor install desk — run through the
 * REAL BROWSER. Byte-unique photos (a marker appended after IEND so the exact-byte identical-photo
 * guard never collides across runs), a geo fix on the site coords, env-parameterised, and every
 * created site soft-deleted in afterAll.
 *
 * Needs the API at E2E_API_URL and the seeded vendor/ASM (override with E2E_VENDOR_ID / E2E_ASM_ID /
 * E2E_CLIENT_ID for staging).
 */
const API_URL = process.env.E2E_API_URL || 'http://localhost:4000';
const VENDOR_ID = process.env.E2E_VENDOR_ID || 'cmtcrifhh0002fcih7btytu5d'; // VENDA — fielda's vendor
const ASM_ID = process.env.E2E_ASM_ID || 'cmtcrifhn0004fcihzjzv3z3w'; // asm@kwality.in
const LAT = 19.07;
const LNG = 72.87;

// Resolved from the suite's cwd (platform/ — where `npm run e2e` runs).
const RECCE_PNG = resolve(process.cwd(), 'public/kwality-walls-logo.png');
const INSTALL_PNG = resolve(process.cwd(), 'public/icons/icon-192.png'); // DISTINCT from the recce photo

// A unique run tag so codes/Outlet IDs never collide across runs.
const RUN = Date.now().toString().slice(-7);

async function uploadPhoto(ctx: APIRequestContext, token: string, file: string, name: string, uniq: string): Promise<string> {
  // Byte-unique per upload (marker after IEND) so the app's exact-byte identical-photo guard
  // (image_hashes unique) never rejects a photo whose bytes a prior run already registered — and so
  // the install photo is never an exact-hash duplicate (a HARD block on the money path). Trailing
  // bytes don't affect the magic-byte sniff or rendering.
  const buffer = Buffer.concat([readFileSync(file), Buffer.from(`\n<<e2e:${uniq}>>`)]);
  const res = await ctx.post('/v1/media/upload', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name, mimeType: 'image/png', buffer } },
  });
  expect(res.ok(), `upload ${name}: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data.key as string;
}

/** One recce POSM line — identical shape to the app recce (compulsory markup included). */
function posmLine(posmTypeId: string, key: string) {
  return {
    posmTypeId,
    dimensions: { width: 30, height: 40, unit: 'cm' },
    photo: { key, geo: { lat: LAT, lng: LNG, accuracy: 8 } },
    markup: { version: 1, shapes: [{ type: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.25 }] },
  };
}

/** Submit a MANUAL recce over the API; returns the created recce's response `data`. */
async function submitManualRecce(
  api: APIRequestContext,
  fieldTok: string,
  posmTypeId: string,
  body: { outletName: string; outletId?: string; outletAddress?: string; outletPhone?: string },
  uniq: string,
) {
  const key = await uploadPhoto(api, fieldTok, RECCE_PNG, 'recce.png', uniq);
  const res = await api.post('/v1/recce/manual', {
    headers: { Authorization: `Bearer ${fieldTok}` },
    data: { ...body, posms: [posmLine(posmTypeId, key)] },
  });
  expect(res.ok(), `submit manual recce: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as {
    id: string;
    recceMode: string;
    status: string;
    hoReviewStatus: string;
    site: { id: string; code: string };
    posms: { id: string }[];
  };
}

/** Approve the open HO recce detail (manual) in the browser: fill Outlet ID → Approve → confirm. */
async function hoApproveManual(page: Page, outletId: string) {
  await page.getByTestId('recce-ho-review-outlet-id').fill(outletId);
  await page.getByTestId('recce-ho-review-approve').click(); // opens ConfirmDialog
  // The ConfirmDialog adds a second "Approve" button on top — click the last one (mirrors pipeline).
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
}

/** Click a confirm-dialog Approve: the trigger button opens the dialog, then its confirm button. */
async function approveWithConfirm(page: Page) {
  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();
}

// The HO recce queue, NOT a /admin/recce-ho-review/<id> detail — a success redirect lands here.
const queueRegex = /\/admin\/recce-ho-review(\?.*)?$/;

test.describe.serial('manual recce pipeline (field manual → HO approve → install → audit)', () => {
  let api: APIRequestContext;
  let adminTok = '';
  let fieldTok = '';
  let posmTypeId = '';

  // The main manual-recce flow (steps 1–6).
  let manualSiteId = '';
  let manualRecceId = '';
  let reccePosmId = '';
  let installId = '';
  const assignedOutletId = `E2E-MR-OUT-${RUN}`; // the NEW Outlet ID HO assigns at step 3

  // A pre-seeded DIFFERENT outlet, for the HO Outlet-ID collision guard (step 7).
  let otherSiteId = '';
  const otherOutletId = `E2E-MR-OTHER-${RUN}`;
  const otherOutletName = `E2E Manual Other ${RUN}`;

  // The app-recce-still-unique guard (step 8).
  let appSiteId = '';

  // Every site this spec creates (incl. provisional manual outlets) — soft-deleted at the end.
  const createdSiteIds = new Set<string>();

  test.beforeAll(async () => {
    api = await pwRequest.newContext({ baseURL: API_URL });
    adminTok = await apiToken(api, ROLES.admin);
    fieldTok = await apiToken(api, ROLES.field);

    const typesRes = await api.get('/v1/posm-types', { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(typesRes.ok()).toBeTruthy();
    const types = (await typesRes.json()).data.filter((t: { isActive: boolean }) => t.isActive);
    expect(types.length, 'need at least one active POSM type seeded').toBeGreaterThan(0);
    posmTypeId = types[0].id;

    // A DIFFERENT seeded outlet whose Outlet ID (code) the HO collision test will try to reuse.
    // Created via the app-path site-create, which now REQUIRES rsCode + beatName (durable sweep).
    const otherRes = await api.post('/v1/sites', {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: {
        code: otherOutletId, name: otherOutletName, vendorId: VENDOR_ID, asmUserId: ASM_ID,
        lat: LAT, lng: LNG, rsCode: 'RS001', beatName: 'Beat 1',
      },
    });
    expect(otherRes.ok(), `create other outlet: ${await otherRes.text()}`).toBeTruthy();
    otherSiteId = (await otherRes.json()).data.id;
    createdSiteIds.add(otherSiteId);

    // A dedicated outlet for the app-recce uniqueness guard (step 8).
    const appRes = await api.post('/v1/sites', {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: {
        code: `E2E-MR-APP-${RUN}`, name: `E2E Manual App ${RUN}`, vendorId: VENDOR_ID, asmUserId: ASM_ID,
        lat: LAT, lng: LNG, rsCode: 'RS001', beatName: 'Beat 1',
      },
    });
    expect(appRes.ok(), `create app-recce outlet: ${await appRes.text()}`).toBeTruthy();
    appSiteId = (await appRes.json()).data.id;
    createdSiteIds.add(appSiteId);
  });

  test.afterAll(async () => {
    // Soft-delete every dedicated site (no hard-delete API); recces/installs stay attached but hidden.
    for (const s of createdSiteIds) {
      if (s && adminTok) {
        await api.patch(`/v1/sites/${s}/deactivate`, { headers: { Authorization: `Bearer ${adminTok}` } }).catch(() => undefined);
      }
    }
    await api.dispose();
  });

  test('1 · field submits a MANUAL recce (API) — no outletId, lands SUBMITTED/MANUAL', async () => {
    const data = await submitManualRecce(
      api, fieldTok, posmTypeId,
      { outletName: `E2E Manual ${RUN}`, outletAddress: '12 Market Rd', outletPhone: '9800011111' },
      `${RUN}-manual-1`,
    );
    manualRecceId = data.id;
    manualSiteId = data.site.id;
    reccePosmId = data.posms[0].id;
    createdSiteIds.add(manualSiteId);

    expect(data.recceMode).toBe('MANUAL');
    expect(data.status).toBe('SUBMITTED');
    expect(data.hoReviewStatus).toBe('PENDING'); // straight to HO, no ASM
    expect(reccePosmId).toBeTruthy();
  });

  test('2 · it skips ASM — appears directly in the HO manual queue (outletId null)', async () => {
    const res = await api.get('/v1/recce-ho-review/recces?mode=manual&limit=200', {
      headers: { Authorization: `Bearer ${adminTok}` },
    });
    expect(res.ok(), `HO manual queue: ${await res.text()}`).toBeTruthy();
    const items = (await res.json()).data.items as { id: string; recceMode: string; outletId: string | null }[];
    const mine = items.find((i) => i.id === manualRecceId);
    expect(mine, 'the manual recce must be in the HO manual queue').toBeTruthy();
    expect(mine!.recceMode).toBe('MANUAL');
    expect(mine!.outletId, 'a provisional manual outlet has no Outlet ID yet').toBeNull();
  });

  test('3 · HO approves with a new Outlet ID (browser) — recce APPROVED + outletId written', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto(`/admin/recce-ho-review/${manualRecceId}`);
    await expect(page.getByTestId('recce-ho-review-outlet-id')).toBeVisible();

    await hoApproveManual(page, assignedOutletId);
    await page.waitForURL(queueRegex, { timeout: 20_000 }); // success redirects back to the queue

    const res = await api.get(`/v1/recce-ho-review/recces/${manualRecceId}`, {
      headers: { Authorization: `Bearer ${adminTok}` },
    });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.status).toBe('APPROVED');
    expect(d.hoReviewStatus).toBe('APPROVED');
    expect(d.outletId).toBe(assignedOutletId); // the real Outlet ID is now written
    expect(d.site.code).toBe(assignedOutletId);
  });

  test('4 · field installs the approved manual recce (API, recce-keyed)', async () => {
    // The field picker lists the outlet's installable recces — our approved manual recce must be there.
    const listRes = await api.get(`/v1/installation/installable?siteId=${manualSiteId}`, {
      headers: { Authorization: `Bearer ${fieldTok}` },
    });
    expect(listRes.ok(), `installable: ${await listRes.text()}`).toBeTruthy();
    const recces = (await listRes.json()).data.recces as { id: string; recceMode: string }[];
    const target = recces.find((r) => r.id === manualRecceId);
    expect(target, 'the approved manual recce must be installable').toBeTruthy();
    expect(target!.recceMode).toBe('MANUAL');

    // Install against THAT recce (recce-keyed — R1); distinct byte-unique photo.
    const key = await uploadPhoto(api, fieldTok, INSTALL_PNG, 'install.png', `${RUN}-manual-install`);
    const res = await api.post('/v1/installation', {
      headers: { Authorization: `Bearer ${fieldTok}` },
      data: { siteId: manualSiteId, recceId: manualRecceId, posms: [{ reccePosmId, photo: { key, geo: { lat: LAT, lng: LNG, accuracy: 8 } } }] },
    });
    expect(res.ok(), `submit installation: ${await res.text()}`).toBeTruthy();
    installId = (await res.json()).data.id;
    expect(installId).toBeTruthy();
  });

  test('5 · auditor approves the installation (browser) → AUDIT_APPROVED', async ({ page }) => {
    await login(page, ROLES.auditor);
    await page.goto(`/audit/installations/${installId}`);
    await approveWithConfirm(page);
    await expect(page.getByText(/approved/i)).toBeVisible();

    const res = await api.get(`/v1/audit/installations/${installId}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.status).toBe('AUDIT_APPROVED');
  });

  test('6 · attach-to-existing — a 2nd manual recce with that Outlet ID joins the SAME outlet', async () => {
    const data = await submitManualRecce(
      api, fieldTok, posmTypeId,
      { outletName: `E2E Manual ${RUN} again`, outletId: assignedOutletId },
      `${RUN}-manual-2`,
    );
    // Unlimited manual recces per outlet: this attaches to the SAME site (no duplicate outlet row).
    expect(data.recceMode).toBe('MANUAL');
    expect(data.status).toBe('SUBMITTED');
    expect(data.site.id, 'the 2nd manual recce must attach to the existing outlet').toBe(manualSiteId);
    expect(data.site.code).toBe(assignedOutletId);
  });

  test('7 · HO duplicate-Outlet-ID collision — console surfaces the 409 naming the other outlet', async ({ page }) => {
    // A fresh provisional manual recce to approve-collide against the pre-seeded `otherOutletId`.
    const data = await submitManualRecce(
      api, fieldTok, posmTypeId,
      { outletName: `E2E Manual ${RUN} collide` },
      `${RUN}-manual-collide`,
    );
    createdSiteIds.add(data.site.id);

    await login(page, ROLES.admin);
    await page.goto(`/admin/recce-ho-review/${data.id}`);
    await expect(page.getByTestId('recce-ho-review-outlet-id')).toBeVisible();

    // Assign an Outlet ID that already belongs to a DIFFERENT outlet → the backend 409, surfaced by
    // the console's collision banner naming the other outlet (the admin stays on the page to fix it).
    await hoApproveManual(page, otherOutletId);
    const collision = page.getByTestId('recce-ho-review-outlet-id-collision');
    await expect(collision).toBeVisible();
    await expect(collision).toContainText(otherOutletName);

    // And it did NOT promote — still PENDING HO review.
    const res = await api.get(`/v1/recce-ho-review/recces/${data.id}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.hoReviewStatus).toBe('PENDING');
  });

  test('8 · app-recce invariant holds — a 2nd app recce on one outlet is rejected (409)', async () => {
    const auth = { headers: { Authorization: `Bearer ${fieldTok}` } };

    const key1 = await uploadPhoto(api, fieldTok, RECCE_PNG, 'recce.png', `${RUN}-app-1`);
    const first = await api.post('/v1/recce', { ...auth, data: { siteId: appSiteId, posms: [posmLine(posmTypeId, key1)] } });
    expect(first.ok(), `first app recce: ${await first.text()}`).toBeTruthy();

    // The partial-unique index still caps app recces at one per outlet → a 2nd app recce is a 409.
    const key2 = await uploadPhoto(api, fieldTok, RECCE_PNG, 'recce.png', `${RUN}-app-2`);
    const second = await api.post('/v1/recce', { ...auth, data: { siteId: appSiteId, posms: [posmLine(posmTypeId, key2)] } });
    expect(second.ok(), 'a 2nd app recce on the same outlet must be rejected').toBeFalsy();
    expect(second.status()).toBe(409);
  });

  test('9 · HO attach-to-existing — collision → "Attach to <name>" re-parents the recce onto that outlet', async ({ page }) => {
    // A dedicated EXISTING outlet serviced by the field exec's vendor (E2E_VENDOR_ID), with a known
    // unique Outlet ID (code) + the now-required rsCode/beatName. Attach is same-fleet only, so the
    // target MUST be on VENDOR_ID (fielda's vendor) for the attach to be allowed.
    const existingCode = `E2E-MR-ATTACH-${RUN}`;
    const existingName = `E2E Manual Attach ${RUN}`;
    const existRes = await api.post('/v1/sites', {
      headers: { Authorization: `Bearer ${adminTok}` },
      data: {
        code: existingCode, name: existingName, vendorId: VENDOR_ID, asmUserId: ASM_ID,
        lat: LAT, lng: LNG, rsCode: 'RS001', beatName: 'Beat 1',
      },
    });
    expect(existRes.ok(), `create attach-target outlet: ${await existRes.text()}`).toBeTruthy();
    const existingSiteId = (await existRes.json()).data.id as string;
    createdSiteIds.add(existingSiteId);

    // A fresh provisional MANUAL recce (field, no outletId) → its own provisional (MAN-) outlet.
    const data = await submitManualRecce(
      api, fieldTok, posmTypeId,
      { outletName: `E2E Manual ${RUN} attach` },
      `${RUN}-manual-attach`,
    );
    const provisionalCode = data.site.code; // the MAN- provisional code we must NOT end up on
    createdSiteIds.add(data.site.id);

    await login(page, ROLES.admin);
    await page.goto(`/admin/recce-ho-review/${data.id}`);
    await expect(page.getByTestId('recce-ho-review-outlet-id')).toBeVisible();

    // Enter the EXISTING outlet's Outlet ID → the plain approve collides (409) and the console
    // surfaces the collision banner naming the existing outlet.
    await hoApproveManual(page, existingCode);
    const collision = page.getByTestId('recce-ho-review-outlet-id-collision');
    await expect(collision).toBeVisible();
    await expect(collision).toContainText(existingName);

    // Click "Attach to <name>" → confirm the attach dialog. Attach IS an approval → same success
    // redirect back to the HO queue.
    await page.getByTestId('recce-ho-review-attach').click();
    await page.getByTestId('recce-ho-review-attach-confirm').click();
    await page.waitForURL(queueRegex, { timeout: 20_000 });

    // The recce is now APPROVED + HO APPROVED AND re-parented onto the EXISTING outlet (its code,
    // NOT the provisional MAN- outlet it was captured on — no duplicate, no rename).
    const res = await api.get(`/v1/recce-ho-review/recces/${data.id}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.status).toBe('APPROVED');
    expect(d.hoReviewStatus).toBe('APPROVED');
    expect(d.site.id).toBe(existingSiteId);        // re-parented onto the existing outlet
    expect(d.site.code).toBe(existingCode);        // its master Outlet ID, not a new one
    expect(d.site.code).not.toBe(provisionalCode); // NOT the provisional MAN- outlet
  });
});
