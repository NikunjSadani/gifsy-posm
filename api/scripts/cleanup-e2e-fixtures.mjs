// Remove E2E test fixtures from a TEST tenant (staging), keeping the Client row + the real admins.
// Used by the e2e-staging CI gate after a run (and runnable by hand). FK-safe order; deleting Sites
// cascades recces/installs/posms. ⚠️ Deletes ALL tenant data except KEEP_EMAILS — a TEST-env tool only.
//   DATABASE_URL=... SEED_CLIENT_ID=kwality KEEP_EMAILS="a@x.com,b@y.com" node scripts/cleanup-e2e-fixtures.mjs
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const cid = (process.env.SEED_CLIENT_ID || 'kwality').trim();
const KEEP = (process.env.KEEP_EMAILS || 'nikunj.sadani@gifsy.in,admin@kwality.com')
  .split(',').map((s) => s.trim()).filter(Boolean);
const out = {};
const del = async (label, fn) => {
  try { out[label] = (await fn()).count; } catch (e) { out[label] = 'ERR: ' + String(e.message || e).split('\n')[0]; }
};

async function main() {
  await del('sessions', () => prisma.userSession.deleteMany({ where: { user: { clientId: cid, email: { notIn: KEEP } } } }));
  await del('sites', () => prisma.site.deleteMany({ where: { clientId: cid } })); // cascades recces/installs/posms
  await del('imageHashes', () => prisma.imageHash.deleteMany({ where: { clientId: cid } }));
  await del('asmReminders', () => prisma.asmReminderLog.deleteMany({ where: { clientId: cid } }));
  await del('auditLogs', () => prisma.auditLog.deleteMany({ where: { metadata: { path: ['clientId'], equals: cid } } }));
  await del('users', () => prisma.user.deleteMany({ where: { clientId: cid, email: { notIn: KEEP } } }));
  await del('vendors', () => prisma.vendor.deleteMany({ where: { clientId: cid } }));
  await del('posmTypes', () => prisma.posmType.deleteMany({ where: { clientId: cid } }));

  const remUsers = (await prisma.user.findMany({ where: { clientId: cid }, select: { email: true } })).map((u) => u.email);
  console.log('CLEANUP_DELETED ' + JSON.stringify(out));
  console.log('CLEANUP_REMAINING ' + JSON.stringify({ users: remUsers, sites: await prisma.site.count({ where: { clientId: cid } }) }));
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error('CLEANUP_ERROR', e.message); await prisma.$disconnect(); process.exit(1); });
