import * as XLSX from 'xlsx';
import { UsersService } from './users.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';

/**
 * User bulk-upload proof (email + password login). Bad rows are rejected with a correct,
 * CSV-injection-safe error file (which NEVER echoes a password); good rows are upserted inside a
 * transaction with an ingestion audit entry; and the auth-safety rule holds — an EXISTING email
 * updates only name / phone / promoter / password (never role / vendor).
 */

const HEADERS = ['email', 'name', 'role', 'phone', 'vendor_code', 'promoter_code', 'password'];

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
  sub: 'admin1', role: 'CLIENT_ADMIN', clientId: 'c1', name: 'Admin',
};

function makePrisma(opts: {
  vendors?: { id: string; code: string; isActive: boolean }[];
  existing?: { email: string | null; phone: string | null; promoterCode: string | null }[];
  gifsyAdmins?: { email: string }[];
} = {}) {
  const upsert = jest.fn().mockImplementation((args) => ({ __upsert: args }));
  const auditCreate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn().mockResolvedValue([]);
  const vendorFindMany = jest.fn().mockResolvedValue(
    opts.vendors ?? [{ id: 'v1', code: 'VC1', isActive: true }],
  );
  const userFindMany = jest.fn().mockImplementation(({ where }: any) => {
    if (where?.role === 'GIFSY_ADMIN') return Promise.resolve(opts.gifsyAdmins ?? []); // operator accounts in-tenant
    if (where?.email?.in) return Promise.resolve((where.email.in as string[]).map((e, i) => ({ id: `u${i}` }))); // post-reset eviction lookup
    return Promise.resolve(opts.existing ?? []); // the existing-logins preload
  });
  const prisma = {
    user: { upsert, findMany: userFindMany },
    vendor: { findMany: vendorFindMany },
    auditLog: { create: auditCreate },
    $transaction,
  } as unknown as PrismaService;
  const auth = { invalidateAllSessions: jest.fn() } as unknown as AuthService;
  return { prisma, auth, upsert, auditCreate, $transaction };
}

describe('UsersService.bulkUpload (email + password)', () => {
  it('creates a new vendor-field login, rejects bad rows, returns a sanitised error file', async () => {
    const { prisma, auth, upsert, $transaction } = makePrisma();
    const svc = new UsersService(prisma, auth);

    const buffer = buildXlsxBuffer([
      ['field1@kw.in', 'Field One', 'VENDOR_FIELD', '9811111111', 'VC1', 'P100', 'secretpass'], // good
      ['', 'No Email', 'ASM', '', '', '', ''],                           // bad: missing email
      ['not-an-email', 'Bad Email', 'ASM', '', '', '', ''],              // bad: invalid email
      ['role@kw.in', 'Bad Role', 'WIZARD', '', '', '', ''],              // bad: unknown role
      ['nov@kw.in', 'No Vendor', 'VENDOR_FIELD', '', '', '', ''],        // bad: vendor role w/o vendor_code
      ['ven@kw.in', "=cmd|'/c calc'!A1", 'ASM', '', 'VC1', '', ''],      // bad: ASM must not have vendor_code + malicious name
      ['short@kw.in', 'Short Pw', 'ASM', '', '', '', 'abc'],             // bad: password too short
    ]);

    const res = await svc.bulkUpload(admin, { originalname: 'users.xlsx', buffer } as Express.Multer.File);

    expect(res.rowCount).toBe(7);
    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(6);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][0]).toHaveLength(2); // 1 upsert + 1 audit

    // Good row → create keyed on (clientId, email), full payload incl a bcrypt hash.
    const c = upsert.mock.calls[0][0];
    expect(c.where).toEqual({ clientId_email: { clientId: 'c1', email: 'field1@kw.in' } });
    expect(c.create).toMatchObject({ clientId: 'c1', email: 'field1@kw.in', role: 'VENDOR_FIELD', vendorId: 'v1', promoterCode: 'P100' });
    expect(typeof c.create.passwordHash).toBe('string');
    expect(c.create.passwordHash).not.toContain('secretpass'); // hashed, not plaintext

    const rows = readErrorFile(res.errorFileBase64 as string);
    expect(rows[0]).toEqual([
      'row_number', 'email', 'name', 'role', 'phone', 'vendor_code', 'promoter_code', 'error_remarks',
    ]);
    // The error report has NO password column (a plaintext password is never echoed back).
    expect(rows[0]).not.toContain('password');
    const remarks = rows.slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/email is required/i);
    expect(remarks[1]).toMatch(/Invalid email/i);
    expect(remarks[2]).toMatch(/Invalid role/i);
    expect(remarks[3]).toMatch(/requires vendor_code/i);
    expect(remarks[4]).toMatch(/must not have a vendor_code/i);
    expect(remarks[5]).toMatch(/at least/i); // password too short
    // CSV-injection neutralisation on the echoed malicious name.
    const badNameRow = rows.find((r) => r[3] === 'ASM' && r[5] === 'VC1');
    expect(badNameRow?.[2]).toBe("'=cmd|'/c calc'!A1");
  });

  it('AUTH-SAFETY: an existing email updates name/phone/promoter/password ONLY (never role/vendor)', async () => {
    const { prisma, auth, upsert } = makePrisma({
      existing: [{ email: 'field1@kw.in', phone: null, promoterCode: null }],
    });
    const svc = new UsersService(prisma, auth);
    // The row says VENDOR_FIELD + VC1, but the existing user's role/vendor must NOT change.
    const buffer = buildXlsxBuffer([['field1@kw.in', 'Renamed', 'VENDOR_FIELD', '', 'VC1', 'P999', 'newsecret1']]);
    await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    const update = upsert.mock.calls[0][0].update;
    expect(update.name).toBe('Renamed');
    expect(update.promoterCode).toBe('P999');
    expect(typeof update.passwordHash).toBe('string');
    expect(update.failedLoginAttempts).toBe(0); // password reset clears lockout
    expect(update).not.toHaveProperty('role');
    expect(update).not.toHaveProperty('vendorId');
    expect(update).not.toHaveProperty('isActive');
  });

  it('a blank password/promoter on an existing user PRESERVES current values (not written)', async () => {
    const { prisma, auth, upsert } = makePrisma({
      existing: [{ email: 'a@kw.in', phone: null, promoterCode: 'KEEP' }],
    });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([['a@kw.in', 'Renamed', 'ASM', '', '', '', '']]);
    await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(upsert.mock.calls[0][0].update).toEqual({ name: 'Renamed' }); // no password/promoter/phone keys
  });

  it('rejects a within-file duplicate email', async () => {
    const { prisma, auth } = makePrisma();
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([
      ['dup@kw.in', 'A', 'ASM', '', '', '', ''],
      ['DUP@kw.in', 'B', 'ASM', '', '', '', ''], // same email, different case
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/Duplicate email/i);
  });

  it('rejects a promoter code held by a DIFFERENT existing user', async () => {
    const { prisma, auth } = makePrisma({
      existing: [{ email: 'other@kw.in', phone: null, promoterCode: 'P100' }],
    });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([['new@kw.in', 'New', 'ASM', '', '', 'P100', '']]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/already assigned to another user/i);
  });

  it('rejects an unknown / inactive vendor code', async () => {
    const { prisma, auth } = makePrisma({ vendors: [{ id: 'v1', code: 'VC1', isActive: false }] });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([
      ['a@kw.in', 'A', 'VENDOR_FIELD', '', 'NOPE', '', ''], // unknown
      ['b@kw.in', 'B', 'VENDOR_FIELD', '', 'VC1', '', ''],  // inactive
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/not found/i);
    expect(remarks[1]).toMatch(/inactive/i);
  });

  it('rejects a row whose email is a platform-operator (GIFSY_ADMIN) account — no overwrite', async () => {
    const { prisma, auth, upsert } = makePrisma({ gifsyAdmins: [{ email: 'op@kw.in' }] });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([['op@kw.in', 'Takeover', 'CLIENT_ADMIN', '', '', '', 'hacked12345']]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/platform operator/i);
  });

  it('a bulk password reset on an EXISTING email evicts that user’s sessions', async () => {
    const { prisma, auth } = makePrisma({ existing: [{ email: 'field1@kw.in', phone: null, promoterCode: null }] });
    const svc = new UsersService(prisma, auth);
    const buffer = buildXlsxBuffer([['field1@kw.in', 'Field One', 'ASM', '', '', '', 'resetpass123']]);
    await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(auth.invalidateAllSessions as unknown as jest.Mock).toHaveBeenCalledWith('u0'); // eviction lookup returns id u0
  });

  it('throws when a required column (email) is missing', async () => {
    const { prisma, auth } = makePrisma();
    const svc = new UsersService(prisma, auth);
    const ws = XLSX.utils.aoa_to_sheet([['name', 'role'], ['A', 'ASM']]); // no email
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await expect(
      svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Missing required columns/i);
  });

  it('buildUploadTemplate returns a valid .xlsx whose only row is the header contract', () => {
    const { prisma, auth } = makePrisma();
    const svc = new UsersService(prisma, auth);
    const buf = svc.buildUploadTemplate();
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }) as string[][];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['email', 'name', 'role', 'phone', 'vendor_code', 'promoter_code', 'password']);
  });

  it('F8: an un-assumed GIFSY_ADMIN is refused (400), no parsing/DB work', async () => {
    const { prisma, auth, upsert } = makePrisma();
    const svc = new UsersService(prisma, auth);
    const gifsy = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', name: 'Op' } as unknown as JwtPayload;
    const buffer = buildXlsxBuffer([['a@kw.in', 'A', 'ASM', '', '', '', '']]);
    await expect(
      svc.bulkUpload(gifsy, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Assume a tenant/i);
    expect(upsert).not.toHaveBeenCalled();
  });
});
