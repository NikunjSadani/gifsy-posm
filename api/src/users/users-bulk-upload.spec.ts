import * as XLSX from 'xlsx';
import { UsersService } from './users.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';

/**
 * User bulk-upload proof: bad rows are rejected with a correct, CSV-injection-safe error file;
 * good rows are upserted inside a transaction with an ingestion audit entry; and the auth-safety
 * rule holds — an EXISTING phone updates ONLY name + promoter code (never role / vendor).
 */

const HEADERS = ['phone', 'name', 'role', 'vendor_code', 'promoter_code'];

function buildXlsxBuffer(dataRows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Users');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function readErrorFile(base64: string): string[][] {
  const buf = Buffer.from(base64, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false }) as string[][];
}

const admin: JwtPayload = {
  sub: 'admin1', role: 'CLIENT_ADMIN', clientId: 'c1', phone: '9800000000', name: 'Admin',
};

function makePrisma(opts: {
  vendors?: { id: string; code: string; isActive: boolean }[];
  existing?: { phone: string; promoterCode: string | null }[];
} = {}) {
  const upsert = jest.fn().mockImplementation((args) => ({ __upsert: args }));
  const auditCreate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn().mockResolvedValue([]);
  const vendorFindMany = jest.fn().mockResolvedValue(
    opts.vendors ?? [{ id: 'v1', code: 'VC1', isActive: true }],
  );
  const userFindMany = jest.fn().mockResolvedValue(opts.existing ?? []);
  const prisma = {
    user: { upsert, findMany: userFindMany },
    vendor: { findMany: vendorFindMany },
    auditLog: { create: auditCreate },
    $transaction,
  } as unknown as PrismaService;
  const auth = { invalidateAllSessions: jest.fn() } as unknown as AuthService;
  return { prisma, auth, upsert, auditCreate, $transaction };
}

describe('UsersService.bulkUpload', () => {
  it('creates a new vendor-field login, rejects bad rows, returns a sanitised error file', async () => {
    const { prisma, auth, upsert, $transaction } = makePrisma();
    const svc = new UsersService(prisma, auth);

    const buffer = buildXlsxBuffer([
      ['9811111111', 'Field One', 'VENDOR_FIELD', 'VC1', 'P100'], // good
      ['', 'No Phone', 'ASM', '', ''],                            // bad: missing phone
      ['12345', 'Bad Phone', 'ASM', '', ''],                      // bad: not a mobile
      ['9822222222', 'Bad Role', 'WIZARD', '', ''],               // bad: unknown role
      ['9833333333', 'No Vendor', 'VENDOR_FIELD', '', ''],        // bad: vendor role w/o vendor_code
      ['9844444444', "=cmd|'/c calc'!A1", 'ASM', 'VC1', ''],      // bad: ASM must not have vendor_code + malicious name
    ]);

    const res = await svc.bulkUpload(admin, { originalname: 'users.xlsx', buffer } as Express.Multer.File);

    expect(res.rowCount).toBe(6);
    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(5);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][0]).toHaveLength(2); // 1 upsert + 1 audit

    // The good row → create with full role/vendor/promoter payload, keyed by E.164 phone.
    const c = upsert.mock.calls[0][0];
    expect(c.where).toEqual({ clientId_phone: { clientId: 'c1', phone: '+919811111111' } });
    expect(c.create).toMatchObject({ clientId: 'c1', role: 'VENDOR_FIELD', vendorId: 'v1', promoterCode: 'P100' });

    const rows = readErrorFile(res.errorFileBase64 as string);
    expect(rows[0]).toEqual([
      'row_number', 'phone', 'name', 'role', 'vendor_code', 'promoter_code', 'error_remarks',
    ]);
    const remarks = rows.slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/phone is required/i);
    expect(remarks[1]).toMatch(/Invalid phone/i);
    expect(remarks[2]).toMatch(/Invalid role/i);
    expect(remarks[3]).toMatch(/requires vendor_code/i);
    expect(remarks[4]).toMatch(/must not have a vendor_code/i);
    // CSV-injection neutralisation on the echoed malicious name.
    const badNameRow = rows.find((r) => r[3] === 'ASM' && r[4] === 'VC1');
    expect(badNameRow?.[2]).toBe("'=cmd|'/c calc'!A1");
  });

  it('AUTH-SAFETY: an existing phone updates ONLY name + promoterCode (never role/vendor)', async () => {
    const { prisma, auth, upsert } = makePrisma({
      existing: [{ phone: '+919811111111', promoterCode: null }],
    });
    const svc = new UsersService(prisma, auth);
    // Even though the row says VENDOR_FIELD + VC1, the existing user's role/vendor must NOT change.
    const buffer = buildXlsxBuffer([['9811111111', 'Renamed', 'VENDOR_FIELD', 'VC1', 'P999']]);
    await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(upsert.mock.calls[0][0].update).toEqual({ name: 'Renamed', promoterCode: 'P999' });
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty('role');
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty('vendorId');
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty('isActive');
  });

  it('a blank promoter_code on an existing user PRESERVES the current code (not written)', async () => {
    const { prisma, auth, upsert } = makePrisma({
      existing: [{ phone: '+919811111111', promoterCode: 'KEEP' }],
    });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([['9811111111', 'Renamed', 'ASM', '', '']]);
    await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(upsert.mock.calls[0][0].update).toEqual({ name: 'Renamed' }); // no promoterCode key
  });

  it('rejects a promoter code already held by a DIFFERENT existing user', async () => {
    const { prisma, auth } = makePrisma({
      existing: [{ phone: '+919800000009', promoterCode: 'P100' }],
    });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([['9811111111', 'New', 'ASM', '', 'P100']]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/already assigned to another user/i);
  });

  it('rejects within-file duplicate phone and duplicate promoter_code', async () => {
    const { prisma, auth } = makePrisma();
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([
      ['9811111111', 'A', 'ASM', '', 'PX'],
      ['9811111111', 'B', 'ASM', '', ''],   // dup phone
      ['9822222222', 'C', 'ASM', '', 'PX'], // dup promoter
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks.some((m) => /Duplicate phone/i.test(m))).toBe(true);
    expect(remarks.some((m) => /Duplicate promoter_code/i.test(m))).toBe(true);
  });

  it('rejects an unknown / inactive vendor code', async () => {
    const { prisma, auth } = makePrisma({ vendors: [{ id: 'v1', code: 'VC1', isActive: false }] });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([
      ['9811111111', 'A', 'VENDOR_FIELD', 'NOPE', ''], // unknown
      ['9822222222', 'B', 'VENDOR_FIELD', 'VC1', ''],  // inactive
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/not found/i);
    expect(remarks[1]).toMatch(/inactive/i);
  });

  it('throws when a required column is missing', async () => {
    const { prisma, auth } = makePrisma();
    const svc = new UsersService(prisma, auth);
    const ws = XLSX.utils.aoa_to_sheet([['phone', 'name'], ['9811111111', 'A']]); // no role
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await expect(
      svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Missing required columns/i);
  });

  it('F8: an un-assumed GIFSY_ADMIN is refused (400), no parsing/DB work', async () => {
    const { prisma, auth, upsert } = makePrisma();
    const svc = new UsersService(prisma, auth);
    const gifsy = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '9', name: 'Op' } as unknown as JwtPayload;
    const buffer = buildXlsxBuffer([['9811111111', 'A', 'ASM', '', '']]);
    await expect(
      svc.bulkUpload(gifsy, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Assume a tenant/i);
    expect(upsert).not.toHaveBeenCalled();
  });
});
