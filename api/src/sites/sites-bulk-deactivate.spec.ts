import * as XLSX from 'xlsx';
import { SitesService } from './sites.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Bulk-deactivate-by-upload proof: an ACTIVE outlet is soft-deleted via the SAME mechanism as the
 * single endpoint (status→INACTIVE + a DEACTIVATE audit entry); an already-inactive code is a no-op
 * SUCCESS; an unknown code is an ERROR row; and the 5000-row cap is enforced before any DB work.
 */

function buildXlsxBuffer(codes: (string | number)[], header = 'code'): Buffer {
  const aoa = [[header], ...codes.map((c) => [c])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Outlets');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function readSheet(base64: string): string[][] {
  const buf = Buffer.from(base64, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false }) as string[][];
}

const admin: JwtPayload = {
  sub: 'admin1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'Admin',
};

type SiteRow = { id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE' };

function makePrisma(seed: SiteRow[]) {
  const full = (s: SiteRow) => ({
    ...s, clientId: 'c1', phone: null, lat: null, lng: null, town: null,
    rsCode: null, vendorId: null, asmUserId: null,
  });
  const findMany = jest.fn().mockImplementation(({ where }: any) => {
    const queried: string[] = where?.code?.in ?? [];
    return Promise.resolve(seed.filter((s) => queried.includes(s.code)).map(full));
  });
  const update = jest.fn().mockImplementation(({ where, data }: any) => {
    const s = seed.find((x) => x.id === where.id)!;
    return Promise.resolve({ ...full(s), ...data });
  });
  const auditCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    site: { findMany, update },
    auditLog: { create: auditCreate },
  } as unknown as PrismaService;
  return { prisma, findMany, update, auditCreate };
}

describe('SitesService.bulkDeactivate', () => {
  it('found + ACTIVE → deactivated (status INACTIVE) and a DEACTIVATE audit is written', async () => {
    const { prisma, update, auditCreate } = makePrisma([
      { id: 's1', code: 'A1', name: 'Alpha', status: 'ACTIVE' },
    ]);
    const svc = new SitesService(prisma);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['A1']) } as Express.Multer.File);

    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: 's1' }, data: { status: 'INACTIVE' } });

    // A per-site DEACTIVATE audit entry was written (plus the batch-level IMPORT audit).
    const events = auditCreate.mock.calls.map((c) => (c[0].data.metadata as any)?.event);
    expect(events).toContain('DEACTIVATE');
    expect(events).toContain('SITE_BULK_DEACTIVATE');

    const rows = readSheet(res.successFileBase64 as string);
    expect(rows[0]).toEqual(['code', 'name', 'action']);
    expect(rows[1]).toEqual(['A1', 'Alpha', 'Deactivated']);
  });

  it('not-found code → an error row, no update', async () => {
    const { prisma, update } = makePrisma([]);
    const svc = new SitesService(prisma);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['GHOST']) } as Express.Multer.File);

    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(res.successFileBase64).toBeNull();
    const rows = readSheet(res.errorFileBase64 as string);
    expect(rows[0]).toEqual(['row_number', 'code', 'error_remarks']);
    expect(rows[1][rows[1].length - 1]).toMatch(/outlet code not found/i);
  });

  it('already-INACTIVE code → a no-op SUCCESS (no update), labelled Already inactive', async () => {
    const { prisma, update } = makePrisma([
      { id: 's2', code: 'B1', name: 'Beta', status: 'INACTIVE' },
    ]);
    const svc = new SitesService(prisma);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['B1']) } as Express.Multer.File);

    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(0);
    expect(update).not.toHaveBeenCalled();
    const rows = readSheet(res.successFileBase64 as string);
    expect(rows[1]).toEqual(['B1', 'Beta', 'Already inactive']);
  });

  it('a transient per-row failure becomes an error row — the batch completes and still reports the rest', async () => {
    const { prisma, update } = makePrisma([
      { id: 's1', code: 'A1', name: 'Alpha', status: 'ACTIVE' },
      { id: 's2', code: 'A2', name: 'Able', status: 'ACTIVE' },
    ]);
    // The FIRST deactivation's update throws (e.g. a transient DB blip); the second must still run.
    update.mockImplementationOnce(() => Promise.reject(new Error('db blip')));
    const svc = new SitesService(prisma);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['A1', 'A2']) } as Express.Multer.File);

    expect(res.successCount).toBe(1); // A2 still deactivated
    expect(res.errorCount).toBe(1); // A1 reported as an error, not a 500
    const errRows = readSheet(res.errorFileBase64 as string);
    expect(errRows[1][1]).toBe('A1');
    expect(errRows[1][errRows[1].length - 1]).toMatch(/db blip/i);
    const okRows = readSheet(res.successFileBase64 as string);
    expect(okRows[1]).toEqual(['A2', 'Able', 'Deactivated']);
  });

  it('two codes differing only in case are two DISTINCT outlets → both deactivated (de-dup is exact)', async () => {
    const { prisma, update } = makePrisma([
      { id: 's1', code: 'shop1', name: 'Lower', status: 'ACTIVE' },
      { id: 's2', code: 'SHOP1', name: 'Upper', status: 'ACTIVE' },
    ]);
    const svc = new SitesService(prisma);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['shop1', 'SHOP1']) } as Express.Multer.File);

    expect(res.successCount).toBe(2);
    expect(res.errorCount).toBe(0);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('enforces the 5000-row cap before any DB work', async () => {
    const { prisma, update, findMany } = makePrisma([]);
    const svc = new SitesService(prisma);
    const many = Array.from({ length: 5001 }, (_, i) => `C${i}`);
    await expect(
      svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(many) } as Express.Multer.File),
    ).rejects.toThrow(/Too many rows/i);
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when the required `code` column is missing', async () => {
    const { prisma } = makePrisma([]);
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer(['X'], 'outlet'); // wrong header
    await expect(
      svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Missing required columns/i);
  });

  it('F8: an un-assumed GIFSY_ADMIN is refused (400)', async () => {
    const { prisma, findMany } = makePrisma([]);
    const svc = new SitesService(prisma);
    const gifsy = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '9', name: 'Op' } as unknown as JwtPayload;
    await expect(
      svc.bulkDeactivate(gifsy, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['A1']) } as Express.Multer.File),
    ).rejects.toThrow(/Assume a tenant/i);
    expect(findMany).not.toHaveBeenCalled();
  });
});
