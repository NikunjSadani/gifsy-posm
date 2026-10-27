import * as XLSX from 'xlsx';
import { SitesService } from './sites.service';
import { SITE_UPLOAD_HEADERS } from './sites.constants';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Wave-1 bulk-upload proof: bad rows are rejected with a correct, CSV-injection-safe
 * error file; good rows are upserted inside a transaction with an ingestion audit entry.
 *
 * Rows are built from a partial record keyed by column name (so a template re-order never
 * breaks a positional array) and emitted in the canonical SITE_UPLOAD_HEADERS order. The
 * template dropped `phone` + `asm_phone` and gained `rs_name`, `pincode`, `asm_email`,
 * `gsb_allowed` — the specs below exercise the new contract.
 */

type Row = Record<string, string | number>;

function buildXlsxBuffer(dataRows: Row[], headers: readonly string[] = SITE_UPLOAD_HEADERS): Buffer {
  const aoa = [
    [...headers],
    ...dataRows.map((r) => headers.map((h) => (r[h] ?? '') as string | number)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
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

/**
 * `existingCodes` controls the create-vs-update classification (the mandatory-RS/Beat rule only
 * applies to rows whose code does NOT already exist). Default 'all' makes every uploaded code an
 * EXISTING outlet (an UPDATE), so the blank-preserve update path is exercised unchanged; pass `[]`
 * (or a subset) to treat rows as NEW.
 */
function makePrisma(opts: { existingCodes?: string[] | 'all' } = {}) {
  const existingCodes = opts.existingCodes ?? 'all';
  const upsert = jest.fn().mockImplementation((args) => ({ __upsert: args }));
  const auditCreate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn().mockResolvedValue([]);
  // Reflects which of the queried codes already exist in the tenant (the create-vs-update probe).
  const siteFindMany = jest.fn().mockImplementation(({ where }) => {
    const queried: string[] = where?.code?.in ?? [];
    const exist = existingCodes === 'all' ? queried : existingCodes;
    return Promise.resolve(queried.filter((c) => exist.includes(c)).map((code) => ({ code })));
  });
  const vendorFindUnique = jest.fn().mockImplementation(({ where }) =>
    where.clientId_code.code === 'VC1' ? Promise.resolve({ id: 'v1' }) : Promise.resolve(null),
  );
  // Users are stored with a normalized (trim + lower-cased) email; the service normalizes the
  // sheet's asm_email cell before this lookup. 'asm@kw.in' → an ASM; 'field@kw.in' → a non-ASM.
  const userFindUnique = jest.fn().mockImplementation(({ where }) => {
    const email = where.clientId_email.email;
    if (email === 'asm@kw.in') return Promise.resolve({ id: 'asm1', role: 'ASM' });
    if (email === 'field@kw.in') return Promise.resolve({ id: 'u2', role: 'VENDOR_FIELD' });
    return Promise.resolve(null);
  });
  const prisma = {
    site: { upsert, findMany: siteFindMany },
    vendor: { findUnique: vendorFindUnique },
    user: { findUnique: userFindUnique },
    auditLog: { create: auditCreate },
    $transaction,
  } as unknown as PrismaService;
  return { prisma, upsert, auditCreate, $transaction, siteFindMany, userFindUnique };
}

describe('SitesService.bulkUpload', () => {
  it('accepts a good row, rejects bad rows, and returns a sanitised error file', async () => {
    const { prisma, upsert, $transaction } = makePrisma();
    const svc = new SitesService(prisma);

    const buffer = buildXlsxBuffer([
      // good: resolves vendor VC1 + ASM email (an existing code → UPDATE, so RS/Beat not required)
      { code: 'A1', name: 'Alpha', lat: 12.9, lng: 77.6, town: 'Town1', rs_code: 'RS1', vendor_code: 'VC1', asm_email: 'asm@kw.in', status: 'ACTIVE' },
      // bad: missing code
      { name: 'NoCode' },
      // bad: lat out of range
      { code: 'A2', name: 'Beta', lat: 999, lng: 77 },
      // bad: invalid status; malicious name must be neutralised in the error echo
      { code: 'A3', name: "=cmd|'/c calc'!A1", status: 'BOGUS' },
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
    // header + 3 error rows — mirrors the NEW template columns.
    expect(rows[0]).toEqual([
      'row_number', 'code', 'name', 'lat', 'lng',
      'region', 'state', 'cluster', 'town', 'rs_code', 'rs_name',
      'beat_name', 'channel', 'address', 'pincode',
      'vendor_code', 'asm_email', 'gsb_allowed', 'status', 'error_remarks',
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

  it('success file: a mixed batch lists each imported row with its Created / Updated action', async () => {
    // UPD1 already exists (→ Updated); NEW1 does not (→ Created, so it must carry rs_code + beat_name).
    const { prisma, upsert } = makePrisma({ existingCodes: ['UPD1'] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'UPD1', name: 'Updated Outlet' },
      { code: 'NEW1', name: 'New Outlet', rs_code: 'RS1', beat_name: 'Beat 1' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(2);
    expect(res.errorCount).toBe(0);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(res.successFileBase64).toBeTruthy();

    const rows = readErrorFile(res.successFileBase64 as string);
    expect(rows[0]).toEqual(['code', 'name', 'action']);
    const byCode = new Map(rows.slice(1).map((r) => [r[0], r[2]]));
    expect(byCode.get('UPD1')).toBe('Updated');
    expect(byCode.get('NEW1')).toBe('Created');
  });

  it('success file: an all-error batch yields successFileBase64: null', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([{ name: 'NoCode' }]); // missing code → rejected
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    expect(res.successFileBase64).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown vendor code with a per-row error', async () => {
    const { prisma } = makePrisma();
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([{ code: 'B1', name: 'Beta', vendor_code: 'NOPE' }]);
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
      { code: 'DUP', name: 'First' },
      { code: 'dup', name: 'Second' },
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

  // ── F2 — row cap ───────────────────────────────────────────────────────────────
  it('F2: rejects an upload exceeding the 5000-row cap (before any per-row work)', async () => {
    const { prisma, upsert } = makePrisma();
    const svc = new SitesService(prisma);
    const many = Array.from({ length: 5001 }, (_, i) => ({ code: `C${i}`, name: `N${i}` }));
    const buffer = buildXlsxBuffer(many);
    await expect(
      svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Too many rows/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  // ── F3 — a blank cell must PRESERVE the existing value on UPDATE ─────────────────
  it('F3: a blank cell leaves the existing value unchanged on UPDATE (only name written)', async () => {
    const { prisma, upsert } = makePrisma();
    const svc = new SitesService(prisma);
    // code + name present; every optional cell blank.
    const buffer = buildXlsxBuffer([{ code: 'EXIST', name: 'New Name' }]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    // UPDATE writes ONLY name — no lat/lng/town/rsCode/rsName/pincode/vendorId/asmUserId/gsbAllowed/
    // status keys, so a blank cell can never null-out (or flip) an existing value.
    expect(upsert.mock.calls[0][0].update).toEqual({ name: 'New Name' });
    // CREATE (first-insert branch) carries the full nullable payload + defaults (gsbAllowed false).
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      code: 'EXIST', name: 'New Name', lat: null, lng: null,
      town: null, rsCode: null, rsName: null, pincode: null,
      vendorId: null, asmUserId: null, gsbAllowed: false, status: 'ACTIVE',
    });
    // `phone` is no longer written by the parser (it is not part of the template).
    expect(upsert.mock.calls[0][0].create).not.toHaveProperty('phone');
  });

  it('F3: a NON-empty cell IS written on UPDATE (incl. rsName/pincode/gsbAllowed/asmUserId-from-email)', async () => {
    const { prisma, upsert } = makePrisma();
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([{
      code: 'EXIST', name: 'N', lat: 12.9, lng: 77.6, town: 'T',
      rs_code: 'RS', rs_name: 'Distributor X', pincode: '560001',
      vendor_code: 'VC1', asm_email: 'asm@kw.in', gsb_allowed: 'Yes', status: 'INACTIVE',
    }]);
    await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(upsert.mock.calls[0][0].update).toMatchObject({
      name: 'N', lat: 12.9, lng: 77.6, town: 'T',
      rsCode: 'RS', rsName: 'Distributor X', pincode: '560001',
      vendorId: 'v1', asmUserId: 'asm1', gsbAllowed: true, status: 'INACTIVE',
    });
  });

  // ── F8 — an un-assumed GIFSY_ADMIN cannot ingest tenant data ─────────────────────
  it('F8: an un-assumed GIFSY_ADMIN is refused (400), no parsing/DB work', async () => {
    const { prisma, upsert } = makePrisma();
    const svc = new SitesService(prisma);
    const gifsy = { sub: 'op1', role: 'GIFSY_ADMIN', clientId: 'gifsy', phone: '9', name: 'Op' } as unknown as JwtPayload;
    const buffer = buildXlsxBuffer([{ code: 'A1', name: 'Alpha' }]);
    await expect(
      svc.bulkUpload(gifsy, { originalname: 'x.xlsx', buffer } as Express.Multer.File),
    ).rejects.toThrow(/Assume a tenant/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  // ── Mandatory RS/Beat on NEW outlets (create rows) ──────────────────────────────
  it('rejects a NEW-site row missing rs_code or beat_name (no outlet created)', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: [] }); // nothing exists → both NEW
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      // NEW1: has rs_code but blank beat_name → rejected
      { code: 'NEW1', name: 'New Outlet', rs_code: 'RS1' },
      // NEW2: blank rs_code → rejected
      { code: 'NEW2', name: 'New Outlet 2' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(2);
    expect(upsert).not.toHaveBeenCalled();
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/beat name is required for a new outlet/i);
    expect(remarks[1]).toMatch(/rs code is required for a new outlet/i);
  });

  it('allows a NEW-site row that carries BOTH rs_code and beat_name', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'NEW3', name: 'New Outlet 3', rs_code: 'RS1', beat_name: 'Beat 1' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(0);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ code: 'NEW3', rsCode: 'RS1', beatName: 'Beat 1' });
  });

  it('allows an UPDATE row (existing code) with BLANK rs/beat (blank-preserve unchanged)', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: ['UPD1'] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([{ code: 'UPD1', name: 'Updated Name' }]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    expect(res.errorCount).toBe(0);
    // Blank rs/beat on an existing outlet are preserved — only name is written on UPDATE.
    expect(upsert.mock.calls[0][0].update).toEqual({ name: 'Updated Name' });
  });

  // ── asm_email resolution (replaces the old asm_phone lookup) ─────────────────────
  it('resolves asm_email → asmUserId for an ASM user in the tenant', async () => {
    const { prisma, upsert, userFindUnique } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    // Mixed case + surrounding space → still resolves (normalizeEmail trims + lower-cases).
    const buffer = buildXlsxBuffer([
      { code: 'N1', name: 'Alpha', rs_code: 'RS1', beat_name: 'B1', asm_email: '  ASM@KW.in ' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    expect(userFindUnique.mock.calls[0][0].where).toEqual({ clientId_email: { clientId: 'c1', email: 'asm@kw.in' } });
    expect(upsert.mock.calls[0][0].create).toMatchObject({ asmUserId: 'asm1' });
  });

  it('rejects an asm_email that belongs to a NON-ASM user (per-row error)', async () => {
    const { prisma } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'N1', name: 'Alpha', rs_code: 'RS1', beat_name: 'B1', asm_email: 'field@kw.in' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/belongs to a non-ASM user/i);
  });

  it('rejects an asm_email not found in the tenant (per-row error)', async () => {
    const { prisma } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'N1', name: 'Alpha', rs_code: 'RS1', beat_name: 'B1', asm_email: 'ghost@kw.in' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/ASM email .* not found/i);
  });

  // ── gsb_allowed Yes/No parsing ───────────────────────────────────────────────────
  it('gsb_allowed: Yes/true/1 → gsbAllowed true on CREATE', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'G1', name: 'A', rs_code: 'RS1', beat_name: 'B1', gsb_allowed: 'Yes' },
      { code: 'G2', name: 'B', rs_code: 'RS1', beat_name: 'B1', gsb_allowed: 'TRUE' },
      { code: 'G3', name: 'C', rs_code: 'RS1', beat_name: 'B1', gsb_allowed: '1' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(3);
    expect(res.errorCount).toBe(0);
    for (const call of upsert.mock.calls) expect(call[0].create.gsbAllowed).toBe(true);
  });

  it('gsb_allowed: No/false/0/blank → gsbAllowed false on CREATE', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'G1', name: 'A', rs_code: 'RS1', beat_name: 'B1', gsb_allowed: 'No' },
      { code: 'G2', name: 'B', rs_code: 'RS1', beat_name: 'B1', gsb_allowed: 'false' },
      { code: 'G3', name: 'C', rs_code: 'RS1', beat_name: 'B1', gsb_allowed: '0' },
      { code: 'G4', name: 'D', rs_code: 'RS1', beat_name: 'B1' }, // blank → false
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(4);
    expect(res.errorCount).toBe(0);
    for (const call of upsert.mock.calls) expect(call[0].create.gsbAllowed).toBe(false);
  });

  it('gsb_allowed: a garbage value is a per-row error (no outlet upserted)', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'G1', name: 'A', rs_code: 'RS1', beat_name: 'B1', gsb_allowed: 'maybe' },
    ]);
    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(0);
    expect(res.errorCount).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
    const remarks = readErrorFile(res.errorFileBase64 as string).slice(1).map((r) => r[r.length - 1]);
    expect(remarks[0]).toMatch(/invalid gsb allowed value/i);
  });

  it('gsb_allowed updates on UPDATE only when the cell is non-blank (blank preserves)', async () => {
    const { prisma, upsert } = makePrisma({ existingCodes: ['U1', 'U2'] });
    const svc = new SitesService(prisma);
    const buffer = buildXlsxBuffer([
      { code: 'U1', name: 'A', gsb_allowed: 'Yes' }, // non-blank → written
      { code: 'U2', name: 'B' }, // blank → preserved (not written)
    ]);
    await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(upsert.mock.calls[0][0].update).toMatchObject({ name: 'A', gsbAllowed: true });
    expect(upsert.mock.calls[1][0].update).toEqual({ name: 'B' });
    expect(upsert.mock.calls[1][0].update).not.toHaveProperty('gsbAllowed');
  });

  // ── Removed columns: a stray phone / asm_phone column is simply ignored ───────────
  it('ignores stray phone / asm_phone columns (no longer parsed; phone stays unwritten)', async () => {
    const { prisma, upsert, userFindUnique } = makePrisma({ existingCodes: [] });
    const svc = new SitesService(prisma);
    // A file that still carries the OLD phone + asm_phone columns alongside the required ones.
    const headers = ['code', 'name', 'rs_code', 'beat_name', 'phone', 'asm_phone'];
    const ws = XLSX.utils.aoa_to_sheet([
      headers,
      ['N1', 'Alpha', 'RS1', 'B1', '9876500000', '9811111111'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sites');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const res = await svc.bulkUpload(admin, { originalname: 'x.xlsx', buffer } as Express.Multer.File);
    expect(res.successCount).toBe(1);
    // phone is NOT written by the parser, and asm_phone is NOT resolved (no user lookup by phone).
    expect(upsert.mock.calls[0][0].create).not.toHaveProperty('phone');
    expect(upsert.mock.calls[0][0].create).toMatchObject({ asmUserId: null });
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});
