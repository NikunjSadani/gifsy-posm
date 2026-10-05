// Temp runtime-verification seed. Creates one tenant, two vendors with a field
// login each, an ASM, an auditor, a client-admin, two POSM types, and one ACTIVE
// site per vendor. Prints the ids/phones the HTTP checks need. Run:
//   DATABASE_URL=... node scripts/seed-verify.mjs
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const P = (last) => `+9190000000${last}`; // E.164 (optional contact; login is email+password)
// Dev login: every seeded user shares this password. Email is the login id.
const DEV_PASSWORD = 'Password123';
const PWHASH = bcrypt.hashSync(DEV_PASSWORD, 10);
const E = (name) => `${name}@${process.env.SEED_EMAIL_DOMAIN || 'kwality.in'}`;

async function main() {
  // Seed into an EXISTING tenant when SEED_CLIENT_ID is set (e.g. loading E2E fixtures into a
  // deployed staging tenant without colliding on the unique 'kwality' slug); otherwise create a
  // fresh 'kwality' tenant (local-dev default).
  const cid =
    process.env.SEED_CLIENT_ID ||
    (await prisma.client.create({ data: { slug: 'kwality', name: 'Kwality', features: {}, branding: {}, settings: {} } })).id;

  const posm = await prisma.posmType.create({ data: { clientId: cid, code: 'STD', name: 'Standard Board' } });

  const vendorA = await prisma.vendor.create({ data: { clientId: cid, code: 'VENDA', name: 'Vendor A' } });
  const vendorB = await prisma.vendor.create({ data: { clientId: cid, code: 'VENDB', name: 'Vendor B' } });

  const asm = await prisma.user.create({ data: { clientId: cid, phone: P('01'), email: E('asm'), passwordHash: PWHASH, name: 'ASM One', role: 'ASM' } });
  await prisma.user.create({ data: { clientId: cid, phone: P('02'), email: E('auditor'), passwordHash: PWHASH, name: 'Auditor One', role: 'AUDITOR' } });
  await prisma.user.create({ data: { clientId: cid, phone: P('03'), email: E('admin'), passwordHash: PWHASH, name: 'Admin One', role: 'CLIENT_ADMIN' } });

  const fieldA = await prisma.user.create({ data: { clientId: cid, phone: P('10'), email: E('fielda'), passwordHash: PWHASH, name: 'Field A', role: 'VENDOR_FIELD', vendorId: vendorA.id } });
  const fieldB = await prisma.user.create({ data: { clientId: cid, phone: P('20'), email: E('fieldb'), passwordHash: PWHASH, name: 'Field B', role: 'VENDOR_FIELD', vendorId: vendorB.id } });
  // VENDOR_HO (vendor head office) scoped to vendor A's fleet — the E2E's `vendorho` role.
  const vendorHo = await prisma.user.create({ data: { clientId: cid, phone: P('11'), email: E('vendorho'), passwordHash: PWHASH, name: 'Vendor HO', role: 'VENDOR_HO', vendorId: vendorA.id } });

  const siteA = await prisma.site.create({ data: { clientId: cid, code: 'A1', name: 'Site A1', vendorId: vendorA.id, asmUserId: asm.id, lat: 19.07, lng: 72.87, town: 'Mumbai', status: 'ACTIVE' } });
  const siteB = await prisma.site.create({ data: { clientId: cid, code: 'B1', name: 'Site B1', vendorId: vendorB.id, asmUserId: asm.id, lat: 28.61, lng: 77.20, town: 'Delhi', status: 'ACTIVE' } });

  console.log(JSON.stringify({
    clientId: cid,
    loginPassword: DEV_PASSWORD, // every user; login id is the email below
    admin_email: E('admin'), asm_email: E('asm'), auditor_email: E('auditor'),
    fieldA_email: E('fielda'), fieldB_email: E('fieldb'), vendorho_email: E('vendorho'),
    asmId: asm.id, vendorHoId: vendorHo.id,
    posmTypeId: posm.id,
    vendorA: vendorA.id, vendorB: vendorB.id,
    fieldA_phone: fieldA.phone, fieldB_phone: fieldB.phone,
    siteA: { id: siteA.id, code: siteA.code }, siteB: { id: siteB.id, code: siteB.code },
  }, null, 2));
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error('SEED_ERROR', e); await prisma.$disconnect(); process.exit(1); });
