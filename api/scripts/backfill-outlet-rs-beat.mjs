// Report / backfill outlets missing rsCode or beatName (the new mandatory field-filter dimensions).
// REPORT (default): per tenant, counts total sites + sites missing rsCode/beatName, lists codes.
// APPLY: set a value ONLY where the field is null/empty, scoped to one tenant — use for TEST tenants
//        or when the owner supplies real values; real outlets need real RS/Beat, not placeholders.
//   Report: DATABASE_URL=... node scripts/backfill-outlet-rs-beat.mjs
//   Apply : DATABASE_URL=... SEED_CLIENT_ID=<tenant> APPLY=1 RS_VALUE='RS000' BEAT_VALUE='Beat 0' node scripts/backfill-outlet-rs-beat.mjs
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const blank = { OR: [{ equals: null }, { equals: '' }] };

async function main() {
  const apply = process.env.APPLY === '1';
  const cid = (process.env.SEED_CLIENT_ID || '').trim();

  if (!apply) {
    // Report across all tenants (or one if SEED_CLIENT_ID set).
    const where = cid ? { clientId: cid } : {};
    const sites = await prisma.site.findMany({
      where, select: { clientId: true, code: true, rsCode: true, beatName: true },
    });
    const byTenant = {};
    for (const s of sites) {
      const t = (byTenant[s.clientId] ??= { total: 0, missing: [] });
      t.total++;
      const miss = !s.rsCode || !s.beatName;
      if (miss) t.missing.push(s.code);
    }
    for (const [t, v] of Object.entries(byTenant)) {
      console.log(`TENANT ${t}: ${v.total} sites, ${v.missing.length} missing rs/beat` +
        (v.missing.length ? ` → [${v.missing.slice(0, 20).join(', ')}${v.missing.length > 20 ? ', …' : ''}]` : ''));
    }
    if (!sites.length) console.log('NO SITES FOUND' + (cid ? ` for tenant ${cid}` : ''));
    return;
  }

  if (!cid) throw new Error('APPLY requires SEED_CLIENT_ID');
  const rs = (process.env.RS_VALUE || '').trim();
  const beat = (process.env.BEAT_VALUE || '').trim();
  if (!rs || !beat) throw new Error('APPLY requires RS_VALUE and BEAT_VALUE');
  const r1 = await prisma.site.updateMany({ where: { clientId: cid, rsCode: blank }, data: { rsCode: rs } });
  const r2 = await prisma.site.updateMany({ where: { clientId: cid, beatName: blank }, data: { beatName: beat } });
  console.log(`APPLIED tenant ${cid}: rsCode set on ${r1.count}, beatName set on ${r2.count}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error('BACKFILL_ERROR', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
