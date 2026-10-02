// ──────────────────────────────────────────────────────────────────────────────
// seed-prod.mjs — minimal, idempotent PRODUCTION bootstrap for a fresh POSM DB.
//
// A freshly-migrated prod/staging DB is EMPTY — nobody can log in. This creates the
// two things the app can't start without, and NOTHING else (no test/demo data):
//   1. the tenant `Client` row, with a STABLE id so the frontend build's
//      NEXT_PUBLIC_CLIENT_ID matches it (DEPLOY-CONTRACT uses `kwality`); and
//   2. ONE CLIENT_ADMIN login (email + password you supply), hashed EXACTLY like
//      the app's login path (reuses dist/common/password.js), so it can sign in.
//
// Everything else (vendors, sites, field users) is loaded afterwards via the admin
// UI / bulk upload. Safe to re-run: existing rows are left unchanged (it never
// resets an existing admin's password or role — use the admin UI for that).
//
// Run (one-time, e.g. a Cloud Run job or locally against the target DB):
//   DATABASE_URL=... \
//   SEED_ADMIN_EMAIL=admin@kwality.in SEED_ADMIN_PASSWORD='<strong>' \
//   node scripts/seed-prod.mjs
// Optional: CLIENT_ID=kwality  CLIENT_SLUG=kwality  CLIENT_NAME=Kwality  SEED_ADMIN_NAME=Administrator
// ──────────────────────────────────────────────────────────────────────────────
import { NestFactory } from '@nestjs/core';

const CLIENT_ID = (process.env.CLIENT_ID || 'kwality').trim();
const CLIENT_SLUG = (process.env.CLIENT_SLUG || CLIENT_ID).trim();
const CLIENT_NAME = (process.env.CLIENT_NAME || 'Kwality').trim();
const ADMIN_EMAIL_RAW = (process.env.SEED_ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || '';
const ADMIN_NAME = (process.env.SEED_ADMIN_NAME || 'Administrator').trim();

function die(msg) { console.error(`\n[seed-prod] ERROR: ${msg}`); process.exit(1); }

// ── Validate inputs BEFORE touching the DB (prod-safe: no weak/empty defaults) ──
const { hashPassword, normalizeEmail, MIN_PASSWORD_LENGTH } = await import('../dist/common/password.js');
if (!ADMIN_EMAIL_RAW || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL_RAW)) {
  die('SEED_ADMIN_EMAIL is required and must be a valid email.');
}
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
  die(`SEED_ADMIN_PASSWORD is required and must be at least ${MIN_PASSWORD_LENGTH} characters.`);
}
const adminEmail = normalizeEmail(ADMIN_EMAIL_RAW);

const { AppModule } = await import('../dist/app.module.js');
const { PrismaService } = await import('../dist/prisma/prisma.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);

try {
  // ── 1. Tenant Client (stable id). Idempotent: create if missing, never clobber an existing one. ──
  const client = await prisma.client.upsert({
    where: { id: CLIENT_ID },
    update: {}, // leave an existing tenant (name/slug/settings) untouched
    create: { id: CLIENT_ID, slug: CLIENT_SLUG, name: CLIENT_NAME },
  });
  console.log(`[seed-prod] Client "${client.name}" (id=${client.id}, slug=${client.slug}) ready.`);

  // ── 2. One CLIENT_ADMIN login. Idempotent: if this email already exists in the tenant, leave it
  //        AS-IS (never silently reset its password/role — that would be a surprising prod side-effect). ──
  const existing = await prisma.user.findUnique({
    where: { clientId_email: { clientId: CLIENT_ID, email: adminEmail } },
    select: { id: true, role: true, isActive: true, passwordHash: true },
  });
  if (existing) {
    console.log(`[seed-prod] Admin ${adminEmail} already exists (role=${existing.role}, active=${existing.isActive}, hasPassword=${!!existing.passwordHash}) — left unchanged.`);
  } else {
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    const admin = await prisma.user.create({
      data: { clientId: CLIENT_ID, email: adminEmail, name: ADMIN_NAME, role: 'CLIENT_ADMIN', passwordHash, isActive: true },
    });
    console.log(`[seed-prod] Created CLIENT_ADMIN ${adminEmail} (id=${admin.id}).`);
  }

  console.log('\n[seed-prod] Done. The tenant can now sign in; load vendors/sites/users via the admin UI / bulk upload.');
  await app.close();
  process.exit(0);
} catch (e) {
  console.error('\n[seed-prod] FAILED:', e?.message ?? e);
  await app.close();
  process.exit(2);
}
