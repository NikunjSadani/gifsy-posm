// Idempotently ensure a tenant (Client) row exists with a STABLE id — used to bootstrap the
// disposable E2E test tenant (id `e2e`) that the e2e-staging gate seeds/wipes, so the real client
// tenant is never touched. Safe to re-run. Reads DATABASE_URL (the confined runtime role can INSERT
// a Client row — CRUD on the env's own database).
//   DATABASE_URL=... CLIENT_ID=e2e CLIENT_SLUG=e2e CLIENT_NAME="E2E Test" node scripts/ensure-client.mjs
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const id = (process.env.CLIENT_ID || 'e2e').trim();
const slug = (process.env.CLIENT_SLUG || id).trim();
const name = (process.env.CLIENT_NAME || 'E2E Test').trim();

async function main() {
  const c = await prisma.client.upsert({
    where: { id },
    update: {}, // never clobber an existing tenant's config
    create: { id, slug, name, features: {}, branding: {}, settings: {} },
  });
  console.log('CLIENT_READY ' + JSON.stringify({ id: c.id, slug: c.slug, name: c.name }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('ENSURE_CLIENT_ERROR', e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
