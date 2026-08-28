import * as XLSX from 'xlsx';
import { SitesService } from './sites.service';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Wave-1 bulk-upload proof: bad rows are rejected with a correct, CSV-injection-safe
 * error file; good rows are upserted inside a transaction with an ingestion audit entry.
 */

const HEADERS = [
  'code', 'name', 'phone', 'lat', 'lng', 'town', 'rs_code', 'vendor_code', 'asm_phone', 'status',
];

function buildXlsxBuffer(dataRows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sites');
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

function makePrisma() {
  const upsert = jest.fn().mockImplementation((args) => ({ __upsert: args }));
  const auditCreate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn().mockResolvedValue([]);
  const vendorFindUnique = jest.fn().mockImplementation(({ where }) =>
    where.clientId_code.code === 'VC1' ? Promise.resolve({ id: 'v1' }) : Promise.resolve(null),
  );
  const userFindUnique = jest.fn().mockImplementation(({ where }) =>
    where.clientId_phone.phone === '9811111111'
      ? Promise.resolve({ id: 'asm1', role: 'ASM' })
      : Promise.resolve(null),
  );
  const prisma = {
    site: { upsert },
    vendor: { findUnique: vendorFindUnique },
    user: { findUnique: userFindUnique },
    auditLog: { create: auditCreate },
    $transaction,
  } as unknown as PrismaService;
  return { prisma, upsert, auditCreate, $transaction };
}

describe('SitesService.bulkUpload', () => {
  it('accepts a good row, rejects bad rows, and returns a sanitised error file', async () => {
    const { prisma, upsert, $transaction } = makePrisma();
    const svc = new SitesService(prisma);

    const buffer = buildXlsxBuffer([
      // good: resolves vendor VC1 + ASM phone
      ['A1', 'Alpha', '', 12.9, 77.6, 'Town1', 'RS1', 'VC1', '9811111111', 'ACTIVE'],
      // bad: missing code
      ['', 'NoCode', '', '', '', '', '', '', '', ''],
      // bad: lat out of range
      ['A2', 'Beta', '', 999, 77, '', '', '', '', ''],
      // bad: invalid status; malicious name must be neutralised in the error echo
      ['A3', "=cmd|'/c calc'!A1", '', '', '', '', '', '', '', 'BOGUS'],
    ]);

    const file = { originalname: 'sites.xlsx', buffer } as Express.Multer.File;
    const res = await svc.bulkUpload(admin, file);

    expect(res.rowCount).toBe(4);
    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(3);
    expect(res.batchId).toBeTruthy();
    expect(res.errorFileBase64).toBeTruthy();

    // One upsert (the good row) + one audit entry ran in the transaction.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].where).toEqual({ clientId_code: { clientId: 'c1', code: 'A1' } });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][0]).toHaveLength(2); // 1 upsert + 1 audit

    const rows = readErrorFile(res.errorFileBase64 as string);
    // header + 3 error rows
    expect(rows[0]).toEqual([
      'row_number', 'code', 'name', 'phone', 'lat', 'lng', 'town',
      'rs_code', 'vendor_code', 'asm_phone', 'status', 'error_remarks',
    ]);
    const remarks = rows.slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/code is required/i);
    expect(remarks[1]).toMatch(/lat/i);
    expect(remarks[2]).toMatch(/status/i);

    // Row numbers echo the spreadsheet rows (header = row 1).
    expect(rows[1][0]).toBe('3'); // missing-code row was the 2nd data row → sheet row 3
    expect(rows[3][0]).toBe('5'); // status row → sheet row 5

    // CSV-injection neutralisation: the malicious name is prefixed with an apostrophe.
    const statusRow = rows.find((r) => r[0] === '5')!;
    expect(statusRow[2]).toBe("'=cmd|'/c calc'!A1");
  });

  it('rejects an unknown vendor code with a per-row error', async () => {
    const { prisma } = makePrisma();
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      ['B1', 'Beta', '', '', '', '', '', 'NOPE', '', ''],
    ]);
    const res = await svc.bulkUpload(
      admin,
      { originalname: 'x.xlsx', buffer } as Express.Multer.File,
    );
    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/vendor code .* not found/i);
  });

  it('rejects a within-file duplicate code', async () => {
    const { prisma } = makePrisma();
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      ['DUP', 'First', '', '', '', '', '', '', '', ''],
      ['dup', 'Second', '', '', '', '', '', '', '', ''],
    ]);
    const res = await svc.bulkUpload(
      admin,
      { originalname: 'x.xlsx', buffer } as Express.Multer.File,
    );
    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(1);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/duplicate code/i);
  });

  it('throws when a required column is missing', async () => {
    const { prisma } = makePrisma();
    const svc = new SitesService(prisma);
    // No `name` column.
    const ws = XLSX.utils.aoa_to_sheet([['code'], ['A1']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sites');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await expect(
      svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Missing required columns/i);
  });
});
