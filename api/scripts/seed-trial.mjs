// Seed a CLIENT TRIAL login set into an existing tenant: one placeholder vendor (so the
// vendor-scoped roles are valid) + one user per role. Idempotent (skips existing emails).
// NO sites / Element types / recces — the client builds operational data themselves.
//   DATABASE_URL=... SEED_CLIENT_ID=kwality SEED_PASSWORD='Kwality@123' node scripts/seed-trial.mjs
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const cid = (process.env.SEED_CLIENT_ID || 'kwality').trim();
const PW = process.env.SEED_PASSWORD || 'Kwality@123';
const DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'kwality.in';
const PWHASH = bcrypt.hashSync(PW, 10);
const E = (n) => `${n}@${DOMAIN}`;

async function ensureUser(data) {
  const existing = await prisma.user.findFirst({ where: { clientId: cid, email: data.email } });
  if (existing) return { email: existing.email, role: existing.role, status: 'exists' };
  const u = await prisma.user.create({ data: { clientId: cid, passwordHash: PWHASH, ...data } });
  return { email: u.email, role: u.role, status: 'created' };
}

async function main() {
  // A placeholder vendor — VENDOR_FIELD / VENDOR_HO logins require a vendorId (FK).
  let vendor = await prisma.vendor.findFirst({ where: { clientId: cid, code: 'TRIAL' } });
  if (!vendor) vendor = await prisma.vendor.create({ data: { clientId: cid, code: 'TRIAL', name: 'Trial Vendor' } });

  const users = [];
  users.push(await ensureUser({ email: E('admin'), name: 'Kwality Admin', role: 'CLIENT_ADMIN' }));
  users.push(await ensureUser({ email: E('asm'), name: 'Kwality ASM', role: 'ASM' }));
  users.push(await ensureUser({ email: E('auditor'), name: 'Kwality Auditor', role: 'AUDITOR' }));
  users.push(await ensureUser({ email: E('field'), name: 'Kwality Field', role: 'VENDOR_FIELD', vendorId: vendor.id }));
  users.push(await ensureUser({ email: E('vendorho'), name: 'Kwality Vendor HO', role: 'VENDOR_HO', vendorId: vendor.id }));

  console.log('SEED_TRIAL ' + JSON.stringify({
    clientId: cid, password: PW, vendor: { code: vendor.code, name: vendor.name }, users,
  }, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('SEED_TRIAL_ERROR', e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
