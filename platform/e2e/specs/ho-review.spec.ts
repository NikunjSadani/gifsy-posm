import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROLES, login, apiToken } from '../support/roles';

/**
 * HO/Admin escalation stage, end-to-end (owner decision 2026-09-30).
 *
 * An auditor REJECT is not terminal: it stamps the installation AUDIT_REJECTED + hoReviewStatus
 * PENDING and lands it in the HO queue, where HO/Admin makes the terminal call — APPROVE (override
 * the audit reject) or UPHOLD (final REJECTED). The happy-path pipeline spec never exercises this
 * branch, so this covers it: both HO decisions are driven through the REAL console.
 *
 * Setup (recce → ASM-approve → install → auditor-reject) runs over the backend API; the two HO
 * decisions — the regression-prone bit — run through the browser. Two dedicated sites (one per
 * branch), distinct byte-unique photos (identical-photo guard), a geo fix on each site (geo-fence),
 * soft-deleted at the end. Mirrors pipeline.spec's determinism.
 *
 * Needs the API at E2E_API_URL and the seeded vendor/ASM (override with E2E_VENDOR_ID / E2E_ASM_ID /
 * E2E_CLIENT_ID for staging).
 */
const API_URL = process.env.E2E_API_URL || 'http://localhost:4000';
const VENDOR_ID = process.env.E2E_VENDOR_ID || 'cmtcrifhh0002fcih7btytu5d'; // VENDA — fielda's vendor
const ASM_ID = process.env.E2E_ASM_ID || 'cmtcrifhn0004fcihzjzv3z3w'; // asm@kwality.in
const LAT = 19.07;
const LNG = 72.87;

const RECCE_PNG = resolve(process.cwd(), 'public/kwality-walls-logo.png');
const INSTALL_PNG = resolve(process.cwd(), 'public/icons/icon-192.png'); // DISTINCT from the recce photo

const queueRegex = /\/admin\/ho-review(\?.*)?$/; // the queue, NOT a /admin/ho-review/<id> detail

async function uploadPhoto(ctx: APIRequestContext, token: string, file: string, name: string, uniq: string): Promise<string> {
  // Byte-unique per upload (marker after IEND) so the exact-byte identical-photo guard never
  // collides across runs; trailing bytes don't affect the magic-byte sniff or rendering.
  const buffer = Buffer.concat([readFileSync(file), Buffer.from(`\n<<e2e:${uniq}>>`)]);
  const res = await ctx.post('/v1/media/upload', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name, mimeType: 'image/png', buffer } },
  });
  expect(res.ok(), `upload ${name}: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data.key as string;
}

/** Build one installation escalated to HO (AUDIT_REJECTED + hoReviewStatus PENDING). Returns its id. */
async function buildEscalatedInstall(
  api: APIRequestContext,
  tokens: { admin: string; field: string; asm: string; auditor: string },
  posmTypeId: string,
  tag: string,
): Promise<{ siteId: string; installId: string }> {
  const code = `E2E-HO-${tag}-${Date.now().toString().slice(-7)}`;
  const auth = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

  const siteRes = await api.post('/v1/sites', {
    ...auth(tokens.admin),
    data: { code, name: `E2E HO ${tag}`, vendorId: VENDOR_ID, asmUserId: ASM_ID, lat: LAT, lng: LNG },
  });
  expect(siteRes.ok(), `create site: ${await siteRes.text()}`).toBeTruthy();
  const siteId = (await siteRes.json()).data.id as string;

  const recceKey = await uploadPhoto(api, tokens.field, RECCE_PNG, 'recce.png', `${code}-recce`);
  const recceRes = await api.post('/v1/recce', {
    ...auth(tokens.field),
    data: { siteId, posms: [{ posmTypeId, dimensions: { width: 30, height: 40, unit: 'cm' }, photo: { key: recceKey, geo: { lat: LAT, lng: LNG, accuracy: 8 } } }] },
  });
  expect(recceRes.ok(), `submit recce: ${await recceRes.text()}`).toBeTruthy();
  const recceId = (await recceRes.json()).data.id as string;

  const approveRes = await api.post(`/v1/approval/recces/${recceId}/approve`, auth(tokens.asm));
  expect(approveRes.ok(), `ASM approve recce: ${await approveRes.text()}`).toBeTruthy();

  const recceGet = await api.get(`/v1/approval/recces/${recceId}`, auth(tokens.admin));
  expect(recceGet.ok()).toBeTruthy();
  const reccePosmId = (await recceGet.json()).data.posms[0].id as string;

  const installKey = await uploadPhoto(api, tokens.field, INSTALL_PNG, 'install.png', `${code}-install`);
  const installRes = await api.post('/v1/installation', {
    ...auth(tokens.field),
    data: { siteId, posms: [{ reccePosmId, photo: { key: installKey, geo: { lat: LAT, lng: LNG, accuracy: 8 } } }] },
  });
  expect(installRes.ok(), `submit installation: ${await installRes.text()}`).toBeTruthy();
  const installId = (await installRes.json()).data.id as string;

  // Auditor rejects → escalates to HO.
  const rejectRes = await api.post(`/v1/audit/installations/${installId}/reject`, {
    ...auth(tokens.auditor),
    data: { reasonCode: 'POSM_NOT_VISIBLE', reason: `E2E escalation (${tag})` },
  });
  expect(rejectRes.ok(), `auditor reject: ${await rejectRes.text()}`).toBeTruthy();

  return { siteId, installId };
}

test.describe.serial('HO escalation (auditor reject → HO approve / uphold)', () => {
  let api: APIRequestContext;
  let adminTok = '';
  let overrideSite = '';
  let upholdSite = '';
  let overrideInstall = ''; // HO will APPROVE (override) this one
  let upholdInstall = '';   // HO will UPHOLD (reject) this one

  test.beforeAll(async () => {
    api = await pwRequest.newContext({ baseURL: API_URL });
    adminTok = await apiToken(api, ROLES.admin);
    const field = await apiToken(api, ROLES.field);
    const asm = await apiToken(api, ROLES.asm);
    const auditor = await apiToken(api, ROLES.auditor);
    const tokens = { admin: adminTok, field, asm, auditor };

    const typesRes = await api.get('/v1/posm-types', { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(typesRes.ok()).toBeTruthy();
    const types = (await typesRes.json()).data.filter((t: { isActive: boolean }) => t.isActive);
    expect(types.length, 'need at least one active POSM type seeded').toBeGreaterThan(0);
    const posmTypeId = types[0].id;

    const a = await buildEscalatedInstall(api, tokens, posmTypeId, 'OVR');
    overrideSite = a.siteId;
    overrideInstall = a.installId;
    const b = await buildEscalatedInstall(api, tokens, posmTypeId, 'UPH');
    upholdSite = b.siteId;
    upholdInstall = b.installId;
  });

  test.afterAll(async () => {
    for (const s of [overrideSite, upholdSite]) {
      if (s && adminTok) {
        await api.patch(`/v1/sites/${s}/deactivate`, { headers: { Authorization: `Bearer ${adminTok}` } }).catch(() => undefined);
      }
    }
    await api.dispose();
  });

  test('both rejected installs sit AUDIT_REJECTED + hoReviewStatus PENDING, and appear in the HO queue', async () => {
    for (const id of [overrideInstall, upholdInstall]) {
      const res = await api.get(`/v1/ho-review/installations/${id}`, { headers: { Authorization: `Bearer ${adminTok}` } });
      expect(res.ok(), `HO get ${id}: ${await res.text()}`).toBeTruthy();
      const d = (await res.json()).data;
      expect(d.status).toBe('AUDIT_REJECTED');
      expect(d.hoReviewStatus).toBe('PENDING');
    }

    // The queue lists only AUDIT_REJECTED + PENDING; both ids must be present (page cap is 200, test data is tiny).
    const q = await api.get('/v1/ho-review/installations?limit=200', { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(q.ok()).toBeTruthy();
    const ids = ((await q.json()).data.items as { id: string }[]).map((i) => i.id);
    expect(ids).toContain(overrideInstall);
    expect(ids).toContain(upholdInstall);
  });

  test('HO APPROVE (override) through the console → hoReviewStatus APPROVED, audit status stays AUDIT_REJECTED', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto(`/admin/ho-review/${overrideInstall}`);

    await page.getByRole('button', { name: 'Approve (override)' }).click(); // sticky action → opens ConfirmDialog
    await page.getByRole('button', { name: 'Approve', exact: true }).click(); // dialog confirm
    await page.waitForURL(queueRegex, { timeout: 20_000 }); // success redirects back to the queue

    const res = await api.get(`/v1/ho-review/installations/${overrideInstall}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.hoReviewStatus).toBe('APPROVED');
    expect(d.status).toBe('AUDIT_REJECTED'); // audit trail stays truthful; HO carries the override
  });

  test('a decided installation is no longer actionable — the detail page shows the "no longer awaiting" state', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto(`/admin/ho-review/${overrideInstall}`);
    await expect(page.getByText(/no longer awaiting HO review/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve (override)' })).toHaveCount(0);
  });

  test('HO UPHOLD (reject) through the console → hoReviewStatus REJECTED', async ({ page }) => {
    await login(page, ROLES.admin);
    await page.goto(`/admin/ho-review/${upholdInstall}`);

    await page.getByRole('button', { name: 'Uphold rejection' }).first().click(); // sticky action → opens UpholdDialog
    await page.getByRole('button', { name: 'Uphold rejection' }).last().click();   // dialog submit (optional note left blank)
    await page.waitForURL(queueRegex, { timeout: 20_000 });

    const res = await api.get(`/v1/ho-review/installations/${upholdInstall}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.ok()).toBeTruthy();
    const d = (await res.json()).data;
    expect(d.hoReviewStatus).toBe('REJECTED');
    expect(d.status).toBe('AUDIT_REJECTED');
  });
});
