import * as XLSX from 'xlsx';
import { UsersService } from './users.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';

/**
 * Bulk-deactivate-by-upload proof (email + password logins). An ACTIVE user is deactivated via the
 * SAME path as the single endpoint — isActive=false + immediate session eviction (the effect the
 * single-deactivate spec asserts) — with the self and last-active-admin guards preserved as per-row
 * errors, evaluated against the LIVE admin count that each committed deactivation decrements. An
 * already-inactive email is a no-op SUCCESS; an unknown email is an ERROR row.
 */

function buildXlsxBuffer(emails: string[], header = 'email'): Buffer {
  const aoa = [[header], ...emails.map((e) => [e])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Users');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function readSheet(base64: string): string[][] {
  const buf = Buffer.from(base64, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false }) as string[][];
}

const admin: JwtPayload = { sub: 'admin1', role: 'CLIENT_ADMIN', clientId: 'c1', name: 'Admin' };

type UserRow = {
  id: string; email: string; name: string; role: string; isActive: boolean;
};

function makePrisma(seed: UserRow[], opts: { activeAdmins?: number } = {}) {
  const withClient = (u: UserRow) => ({ ...u, clientId: 'c1' });
  const findMany = jest.fn().mockImplementation(({ where }: any) => {
    const emails: string[] = where?.email?.in ?? [];
    return Promise.resolve(seed.filter((u) => emails.includes(u.email)).map(withClient));
  });
  const update = jest.fn().mockImplementation(({ where, data }: any) => {
    const u = seed.find((x) => x.id === where.id)!;
    return Promise.resolve({ ...withClient(u), ...data });
  });
  const count = jest.fn().mockResolvedValue(opts.activeAdmins ?? 5);
  const auditCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    user: { findMany, update, count },
    auditLog: { create: auditCreate },
  } as unknown as PrismaService;
  const auth = { invalidateAllSessions: jest.fn().mockResolvedValue(1) } as unknown as AuthService;
  return { prisma, auth, findMany, update, count, auditCreate };
}

describe('UsersService.bulkDeactivate', () => {
  it('found + active → deactivated via the shared path (isActive=false + sessions evicted)', async () => {
    const { prisma, auth, update } = makePrisma([
      { id: 'u1', email: 'f1@kw.in', name: 'Field One', role: 'ASM', isActive: true },
    ]);
    const svc = new UsersService(prisma, auth);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['f1@kw.in']) } as Express.Multer.File);

    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(0);
    // Same effect the single-deactivate spec asserts: isActive=false + immediate session eviction.
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: 'u1' }, data: { isActive: false } });
    expect(auth.invalidateAllSessions as unknown as jest.Mock).toHaveBeenCalledWith('u1');

    const rows = readSheet(res.successFileBase64 as string);
    expect(rows[0]).toEqual(['email', 'name', 'action']);
    expect(rows[1]).toEqual(['f1@kw.in', 'Field One', 'Deactivated']);
  });

  it('self (caller’s own email in the list) → an error row, no update', async () => {
    const { prisma, auth, update } = makePrisma([
      { id: 'admin1', email: 'me@kw.in', name: 'Admin', role: 'CLIENT_ADMIN', isActive: true },
    ]);
    const svc = new UsersService(prisma, auth);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['me@kw.in']) } as Express.Multer.File);

    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(auth.invalidateAllSessions as unknown as jest.Mock).not.toHaveBeenCalled();
    const rows = readSheet(res.errorFileBase64 as string);
    expect(rows[1][rows[1].length - 1]).toMatch(/your own account/i);
  });

  it('last active CLIENT_ADMIN → an error row (lockout guard preserved), no update', async () => {
    const { prisma, auth, update } = makePrisma(
      [{ id: 'ca2', email: 'ca2@kw.in', name: 'CA2', role: 'CLIENT_ADMIN', isActive: true }],
      { activeAdmins: 1 },
    );
    const svc = new UsersService(prisma, auth);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['ca2@kw.in']) } as Express.Multer.File);

    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    expect(update).not.toHaveBeenCalled();
    const rows = readSheet(res.errorFileBase64 as string);
    expect(rows[1][rows[1].length - 1]).toMatch(/last active CLIENT_ADMIN/i);
  });

  it('last-admin guard reads the LIVE count: in a sheet of 2 admins, the first deactivates and the second is blocked', async () => {
    // Two active CLIENT_ADMINs listed together. The guard must see the count DROP after each
    // committed deactivation (sequential), so the first succeeds (2 remain) and the second is the
    // last one → error row. A regression that cached the count at 2 would (wrongly) deactivate BOTH.
    const seed: UserRow[] = [
      { id: 'ca2', email: 'ca2@kw.in', name: 'CA2', role: 'CLIENT_ADMIN', isActive: true },
      { id: 'ca3', email: 'ca3@kw.in', name: 'CA3', role: 'CLIENT_ADMIN', isActive: true },
    ];
    const withClient = (u: UserRow) => ({ ...u, clientId: 'c1' });
    const findMany = jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(seed.filter((u) => (where?.email?.in ?? []).includes(u.email)).map(withClient)),
    );
    const update = jest.fn().mockImplementation(({ where, data }: any) =>
      Promise.resolve({ ...withClient(seed.find((x) => x.id === where.id)!), ...data }),
    );
    // Live count = 2 minus however many admin deactivations have already committed (one update each).
    const count = jest.fn().mockImplementation(() => Promise.resolve(2 - update.mock.calls.length));
    const prisma = { user: { findMany, update, count }, auditLog: { create: jest.fn().mockResolvedValue({}) } } as unknown as PrismaService;
    const auth = { invalidateAllSessions: jest.fn().mockResolvedValue(1) } as unknown as AuthService;

    const svc = new UsersService(prisma, auth);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['ca2@kw.in', 'ca3@kw.in']) } as Express.Multer.File);

    expect(res.successCount).toBe(1); // ca2 deactivated
    expect(res.errorCount).toBe(1); // ca3 blocked as the last active admin
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 'ca2' });
    const errRows = readSheet(res.errorFileBase64 as string);
    expect(errRows[1][1]).toBe('ca3@kw.in');
    expect(errRows[1][errRows[1].length - 1]).toMatch(/last active CLIENT_ADMIN/i);
  });

  it('not-found email → an error row', async () => {
    const { prisma, auth, update } = makePrisma([]);
    const svc = new UsersService(prisma, auth);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['ghost@kw.in']) } as Express.Multer.File);

    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    expect(update).not.toHaveBeenCalled();
    const rows = readSheet(res.errorFileBase64 as string);
    expect(rows[0]).toEqual(['row_number', 'email', 'error_remarks']);
    expect(rows[1][rows[1].length - 1]).toMatch(/not found/i);
  });

  it('already-inactive email → a no-op SUCCESS (no update / no eviction)', async () => {
    const { prisma, auth, update } = makePrisma([
      { id: 'u3', email: 'x@kw.in', name: 'X', role: 'ASM', isActive: false },
    ]);
    const svc = new UsersService(prisma, auth);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['x@kw.in']) } as Express.Multer.File);

    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(auth.invalidateAllSessions as unknown as jest.Mock).not.toHaveBeenCalled();
    const rows = readSheet(res.successFileBase64 as string);
    expect(rows[1]).toEqual(['x@kw.in', 'X', 'Already inactive']);
  });

  it('normalizes the email cell (trim + lower-case) before resolving', async () => {
    const { prisma, auth, update } = makePrisma([
      { id: 'u1', email: 'f1@kw.in', name: 'Field One', role: 'ASM', isActive: true },
    ]);
    const svc = new UsersService(prisma, auth);
    const res = await svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['  F1@KW.in ']) } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: 'u1' });
  });

  it('enforces the 5000-row cap before any DB work', async () => {
    const { prisma, auth, update, findMany } = makePrisma([]);
    const svc = new UsersService(prisma, auth);
    const many = Array.from({ length: 5001 }, (_, i) => `u${i}@kw.in`);
    await expect(
      svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(many) } as Express.Multer.File),
    ).rejects.toThrow(/Too many rows/i);
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when the required `email` column is missing', async () => {
    const { prisma, auth } = makePrisma([]);
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer(['x@kw.in'], 'mail'); // wrong header
    await expect(
      svc.bulkDeactivate(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Missing required columns/i);
  });

  it('F8: an un-assumed GIFSY_ADMIN is refused (400), no DB work', async () => {
    const { prisma, auth, findMany } = makePrisma([]);
    const svc = new UsersService(prisma, auth);
    const gifsy = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', name: 'Op' } as unknown as JwtPayload;
    await expect(
      svc.bulkDeactivate(gifsy, { originalname: 'x.xlsx', buffer: buildXlsxBuffer(['x@kw.in']) } as Express.Multer.File),
    ).rejects.toThrow(/Assume a tenant/i);
    expect(findMany).not.toHaveBeenCalled();
  });
});
