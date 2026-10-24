/**
 * pptx-boot-smoke.mjs — boot + write smoke for the Recce Report PowerPoint export.
 *
 * WHY THIS EXISTS: a new dependency/import (here `pptxgenjs`, plus the `jimp` decode path) passes
 * tsc + jest but can CRASH AT BOOT if it is not actually installed / not require-resolvable in the
 * compiled CommonJS app. jest ALSO cannot run pptxgenjs's `write()` (its media encoder `import()`s
 * node built-ins, which the CommonJS Jest VM rejects). So this script, run under REAL Node against
 * the COMPILED dist:
 *   1. imports the compiled ReportsService — proving `pptxgenjs` + `jimp` resolve at load (no
 *      missing-module boot crash), and
 *   2. drives the real end-to-end export (decode a photo → plan the slide → embed the image + draw
 *      the markup box → write the .pptx), proving the full write path works outside jest.
 *
 * Run (after `npx nest build`):  node scripts/pptx-boot-smoke.mjs
 * Exits 0 on success, 1 on any failure.
 */

import assert from 'node:assert';
import { ReportsService } from '../dist/reports/reports.service.js';

// A valid 8×4 PNG (jimp-generated) — a genuinely decodable photo for the embed path.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAG0lEQVR4AWP8z8DwnwEPYGIgAJgYCAAmBgIAAASgAgY+zGOXAAAAAElFTkSuQmCC',
  'base64',
);

const sampleSite = {
  id: 's1', code: 'A8', name: 'Kalyan Mega Mart', town: 'Kalyan', state: 'MH',
  rsCode: null, rsName: null, channel: 'GT', vendor: { name: 'Prime Fleet' },
  recces: [
    {
      id: 'r1', recceMode: 'APP', status: 'APPROVED', hoReviewStatus: 'APPROVED',
      capturedAt: new Date('2026-08-28T02:30:00Z'), receivedAt: new Date('2026-08-28T02:30:00Z'),
      captureLat: 19.24, captureLng: 73.13, reviewedAt: null, hoReviewedAt: null,
      submittedBy: { promoterCode: 'P1' }, approvedBy: null, hoReviewedBy: null,
      posms: [
        {
          id: 'rp1', slotNo: 1, posmType: { name: 'Standard Board' },
          dimensions: { width: 24, height: 12, unit: 'in' },
          photo: { key: 'posm-media/c1/x.jpg', geo: { lat: 19.2401, lng: 73.1301 } },
          markup: { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] },
        },
      ],
    },
  ],
};

// Minimal stubbed collaborators — no DB/network. (If the import above failed to resolve pptxgenjs or
// jimp, we'd never get here — that is itself the boot check.)
const prisma = { site: { findMany: async () => [sampleSite] } };
const msg91 = {};
const posmMedia = { viewMedia: async () => ({ bytes: PNG, contentType: 'image/png', inline: true }) };
const admin = { sub: 'u1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'T' };

const svc = new ReportsService(prisma, msg91, posmMedia);

try {
  const buf = await svc.outletExecutionPptx(admin, 'A8');
  assert(Buffer.isBuffer(buf), 'write() should return a Buffer');
  assert(buf.length > 1000, `pptx buffer looks too small (${buf.length} bytes)`);
  assert.strictEqual(buf.subarray(0, 2).toString('latin1'), 'PK', 'buffer is not a zip (no PK header)');

  const text = buf.toString('latin1');
  assert(/ppt\/slides\/slide1\.xml/.test(text), 'no slide1.xml in the archive');
  assert(/ppt\/media\/image[-0-9]*\.(jpe?g|png)/.test(text), 'embedded recce photo (ppt/media/image*) missing');

  // Validation path: 0 and 4 codes must 400 with the owner message.
  for (const bad of ['', 'A1,A2,A3,A4']) {
    let threw = false;
    try { await svc.outletExecutionPptx(admin, bad); } catch (e) { threw = true; assert(/1–3 outlets/.test(e.message), `wrong 400 message: ${e.message}`); }
    assert(threw, `expected a 400 for outletCodes="${bad}"`);
  }

  console.log(`PPTX BOOT SMOKE: PASS — ${buf.length} bytes, slide1.xml + embedded image present, validation 400s OK`);
  process.exit(0);
} catch (err) {
  console.error('PPTX BOOT SMOKE: FAIL —', err?.stack || err);
  process.exit(1);
}
