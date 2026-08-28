import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, SiteStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope, platformWide } from '../common/tenant-scope';
import { normalizeIndianPhone } from '../common/phone';
import { aoaToSheetSafe } from '../common/xlsx';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { ListSitesDto } from './dto/list-sites.dto';
import {
  SITE_UPLOAD_REQUIRED_HEADERS,
  SITE_ERROR_HEADERS,
} from './sites.constants';

/** A rejected upload row — echoes the source cell values plus the reason. */
interface SiteErrorRow {
  rowNumber: number;
  code: string;
  name: string;
  phone: string;
  lat: string;
  lng: string;
  town: string;
  rs_code: string;
  vendor_code: string;
  asm_phone: string;
  status: string;
  error_remarks: string;
}

/**
 * A validated, resolved upload row ready to upsert.
 *
 * `present` records which SOURCE CELLS were non-empty (F3). On the upsert UPDATE branch a
 * column is written ONLY when its source cell was non-empty, so a blank cell LEAVES the
 * existing value unchanged (never null-outs vendorId/asmUserId/lat/lng/phone/town/rsCode/
 * status). The CREATE branch always writes the resolved values (blank → null / default).
 */
interface SiteSuccessRow {
  code: string;
  name: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  town: string | null;
  rsCode: string | null;
  vendorId: string | null;
  asmUserId: string | null;
  status: SiteStatus;
  present: {
    phone: boolean;
    latlng: boolean;
    town: boolean;
    rsCode: boolean;
    vendor: boolean;
    asm: boolean;
    status: boolean;
  };
}

/** F2: hard cap on data rows per bulk upload — bounds per-request work on an untrusted file. */
const MAX_UPLOAD_ROWS = 5000;

/**
 * Wave-1 Site master service — CRUD + Excel bulk-ingestion + role-scoped listing.
 *
 * SCOPING (the Wave-1 security concern) is centralised in {@link scopedWhere}: every
 * read/write funnels through it so a vendor-role login can NEVER see or touch another
 * vendor's (or tenant's) sites. A vendor role with no resolvable vendor FAILS CLOSED
 * (returns nothing / 404) — never an unscoped read.
 */
@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Scoping ────────────────────────────────────────────────────────────────────
  /**
   * The base `where` a caller is confined to, or `null` = FAIL-CLOSED (match nothing).
   *
   *  - VENDOR_FIELD / VENDOR_HO → tenant AND `vendorId = vendorScope(user)`; a vendor
   *    role whose token yields no vendorId returns `null` (deny) — never tenant-wide.
   *  - ASM → tenant AND `asmUserId = user.sub`.
   *  - CLIENT_ADMIN → tenant-wide (`tenantScope`).
   *  - GIFSY_ADMIN → platform-wide when un-assumed (`tenantScope` → undefined ⇒ no
   *    clientId filter), else the assumed tenant.
   */
  private scopedWhere(user: JwtPayload): Prisma.SiteWhereInput | null {
    const where: Prisma.SiteWhereInput = {};
    const scope = tenantScope(user); // undefined only for un-assumed GIFSY_ADMIN
    if (scope !== undefined) where.clientId = scope;

    if (user.role === 'VENDOR_FIELD' || user.role === 'VENDOR_HO') {
      const v = vendorScope(user);
      if (!v) return null; // fail-closed: a vendor role must never read unscoped
      where.vendorId = v;
    } else if (user.role === 'ASM') {
      where.asmUserId = user.sub;
    }
    return where;
  }

  /** Is this caller confined to a single vendor (so a vendorId filter can't widen it)? */
  private isVendorRole(user: JwtPayload): boolean {
    return user.role === 'VENDOR_FIELD' || user.role === 'VENDOR_HO';
  }

  // ── List / search / filter ───────────────────────────────────────────────────
  async list(user: JwtPayload, q: ListSitesDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const scope = this.scopedWhere(user);
    // Fail-closed: a vendor role with no vendor scope reads NOTHING (no query issued).
    if (scope === null) return { sites: [], total: 0, page, limit };

    const where: Prisma.SiteWhereInput = { ...scope };
    if (q.name) where.name = { contains: q.name, mode: 'insensitive' };
    if (q.code) where.code = { contains: q.code, mode: 'insensitive' };
    if (q.town) where.town = { contains: q.town, mode: 'insensitive' };
    if (q.rsCode) where.rsCode = { contains: q.rsCode, mode: 'insensitive' };
    // Apply the vendorId filter only when the caller is NOT already vendor-pinned —
    // otherwise it could override the security pin and leak a sibling vendor's fleet.
    if (q.vendorId && !this.isVendorRole(user)) where.vendorId = q.vendorId;

    const [sites, total] = await Promise.all([
      this.prisma.site.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.site.count({ where }),
    ]);
    return { sites, total, page, limit };
  }

  // ── Get one (scoped) ───────────────────────────────────────────────────────────
  async get(user: JwtPayload, id: string) {
    const scope = this.scopedWhere(user);
    if (scope === null) throw new NotFoundException('Site not found');
    const site = await this.prisma.site.findFirst({ where: { ...scope, id } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  // ── Create ─────────────────────────────────────────────────────────────────────
  async create(user: JwtPayload, dto: CreateSiteDto) {
    // F8: an un-assumed GIFSY_ADMIN has no tenant context — refuse tenant-data writes.
    if (platformWide(user)) {
      throw new BadRequestException('Assume a tenant before creating tenant data.');
    }
    const clientId = user.clientId;
    await this.assertRefsInTenant(clientId, dto.vendorId, dto.asmUserId);

    let site;
    try {
      site = await this.prisma.site.create({
        data: {
          clientId,
          code: dto.code,
          name: dto.name,
          phone: dto.phone ?? null,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          town: dto.town ?? null,
          rsCode: dto.rsCode ?? null,
          vendorId: dto.vendorId ?? null,
          asmUserId: dto.asmUserId ?? null,
          status: (dto.status as SiteStatus) ?? SiteStatus.ACTIVE,
        },
      });
    } catch (e) {
      throw this.mapUniqueError(e, dto.code);
    }

    await this.writeAudit(user, 'CREATE', site.id, null, this.snapshot(site));
    return site;
  }

  // ── Update (scoped) ──────────────────────────────────────────────────────────
  async update(user: JwtPayload, id: string, dto: UpdateSiteDto) {
    const existing = await this.get(user, id); // enforces scope → 404 if out of scope
    await this.assertRefsInTenant(existing.clientId, dto.vendorId, dto.asmUserId);

    const data: Prisma.SiteUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.town !== undefined) data.town = dto.town;
    if (dto.rsCode !== undefined) data.rsCode = dto.rsCode;
    if (dto.vendorId !== undefined) {
      data.vendor = dto.vendorId ? { connect: { id: dto.vendorId } } : { disconnect: true };
    }
    if (dto.asmUserId !== undefined) {
      data.asm = dto.asmUserId ? { connect: { id: dto.asmUserId } } : { disconnect: true };
    }
    if (dto.status !== undefined) data.status = dto.status as SiteStatus;

    let updated;
    try {
      updated = await this.prisma.site.update({ where: { id }, data });
    } catch (e) {
      throw this.mapUniqueError(e, dto.code ?? existing.code);
    }

    await this.writeAudit(user, 'UPDATE', id, this.snapshot(existing), this.snapshot(updated));
    return updated;
  }

  // ── Deactivate (scoped soft-delete) ──────────────────────────────────────────
  async deactivate(user: JwtPayload, id: string) {
    const existing = await this.get(user, id); // enforces scope
    const updated = await this.prisma.site.update({
      where: { id },
      data: { status: SiteStatus.INACTIVE },
    });
    await this.writeAudit(user, 'UPDATE', id, this.snapshot(existing), this.snapshot(updated), {
      event: 'DEACTIVATE',
    });
    return updated;
  }

  // ── Bulk upload ────────────────────────────────────────────────────────────────
  async bulkUpload(user: JwtPayload, file: Express.Multer.File | undefined) {
    // F8: an un-assumed GIFSY_ADMIN has no tenant context — refuse tenant-data writes.
    if (platformWide(user)) {
      throw new BadRequestException('Assume a tenant before creating tenant data.');
    }
    if (!file) {
      throw new BadRequestException(
        'No file provided. Attach an .xlsx or .xls file with the field name "file".',
      );
    }
    const clientId = user.clientId;
    const extension = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (!['xlsx', 'xls'].includes(extension)) {
      throw new BadRequestException(
        'Invalid file type. Please upload an .xlsx or .xls file using the downloaded template.',
      );
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: false });
    } catch {
      throw new BadRequestException('Could not parse the Excel file. Please use the template.');
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new BadRequestException('The Excel file appears to be empty.');

    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
      workbook.Sheets[sheetName],
      { raw: true, defval: '' },
    );
    if (rows.length === 0) {
      throw new BadRequestException('The Excel file has no data rows (only a header row found).');
    }

    // Required-column presence check (case-insensitive).
    const fileKeys = Object.keys(rows[0]).map((k) => k.trim().toLowerCase());
    const missing = SITE_UPLOAD_REQUIRED_HEADERS.filter((h) => !fileKeys.includes(h));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missing.join(', ')}. Please use the downloaded template.`,
      );
    }

    // F2: reject an oversized sheet BEFORE the per-row loop (each row does DB lookups).
    if (rows.length > MAX_UPLOAD_ROWS) {
      throw new BadRequestException(
        `Too many rows (${rows.length}). The maximum per upload is ${MAX_UPLOAD_ROWS}. ` +
          'Please split the file and upload in batches.',
      );
    }

    const successRows: SiteSuccessRow[] = [];
    const errorRows: SiteErrorRow[] = [];
    const seenCodes = new Set<string>(); // within-file de-dup

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // row 1 = header
      // Case-insensitive cell accessor.
      const lower: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) lower[k.trim().toLowerCase()] = v;
      const get = (key: string): string => String(lower[key] ?? '').trim();

      const code = get('code');
      const name = get('name');
      const phone = get('phone');
      const latRaw = get('lat');
      const lngRaw = get('lng');
      const town = get('town');
      const rsCode = get('rs_code');
      const vendorCode = get('vendor_code');
      const asmPhone = get('asm_phone');
      const statusRaw = get('status');

      const addError = (reason: string) =>
        errorRows.push({
          rowNumber, code, name, phone,
          lat: latRaw, lng: lngRaw, town, rs_code: rsCode,
          vendor_code: vendorCode, asm_phone: asmPhone, status: statusRaw,
          error_remarks: reason,
        });

      if (!code) { addError('code is required'); continue; }
      const codeKey = code.toLowerCase();
      if (seenCodes.has(codeKey)) {
        addError(`Duplicate code "${code}" appears more than once in this file`);
        continue;
      }
      if (!name) { addError('name is required'); continue; }

      // lat/lng: both-or-neither, each in valid Earth range.
      let lat: number | null = null;
      let lng: number | null = null;
      if (latRaw !== '' || lngRaw !== '') {
        if (latRaw === '' || lngRaw === '') {
          addError('lat and lng must both be provided together'); continue;
        }
        lat = Number(latRaw);
        lng = Number(lngRaw);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          addError(`Invalid lat "${latRaw}" (must be between -90 and 90)`); continue;
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          addError(`Invalid lng "${lngRaw}" (must be between -180 and 180)`); continue;
        }
      }

      // status (optional; default ACTIVE).
      let status: SiteStatus = SiteStatus.ACTIVE;
      if (statusRaw !== '') {
        const up = statusRaw.toUpperCase();
        if (up !== 'ACTIVE' && up !== 'INACTIVE') {
          addError(`Invalid status "${statusRaw}" (allowed: ACTIVE, INACTIVE)`); continue;
        }
        status = up as SiteStatus;
      }

      // Resolve vendor_code → vendorId within the tenant.
      let vendorId: string | null = null;
      if (vendorCode !== '') {
        const vendor = await this.prisma.vendor.findUnique({
          where: { clientId_code: { clientId, code: vendorCode } },
          select: { id: true },
        });
        if (!vendor) {
          addError(`Vendor code "${vendorCode}" not found in this tenant`); continue;
        }
        vendorId = vendor.id;
      }

      // Resolve asm_phone → asmUserId (must be an ASM in the tenant).
      let asmUserId: string | null = null;
      if (asmPhone !== '') {
        // Match the ASM User by canonical E.164 (users are stored normalized — F5).
        const asm = await this.prisma.user.findUnique({
          where: { clientId_phone: { clientId, phone: normalizeIndianPhone(asmPhone) } },
          select: { id: true, role: true },
        });
        if (!asm) {
          addError(`ASM phone "${asmPhone}" not found in this tenant`); continue;
        }
        if (asm.role !== 'ASM') {
          addError(`Phone "${asmPhone}" belongs to a non-ASM user`); continue;
        }
        asmUserId = asm.id;
      }

      seenCodes.add(codeKey);
      successRows.push({
        code, name,
        phone: phone || null,
        lat, lng,
        town: town || null,
        rsCode: rsCode || null,
        vendorId, asmUserId, status,
        // F3: which source cells were non-empty — the UPDATE branch writes ONLY these, so a
        // blank cell leaves the existing value untouched (lat/lng are a paired unit).
        present: {
          phone: phone !== '',
          latlng: lat !== null && lng !== null,
          town: town !== '',
          rsCode: rsCode !== '',
          vendor: vendorCode !== '',
          asm: asmPhone !== '',
          status: statusRaw !== '',
        },
      });
    }

    const batchId = randomUUID();

    // Upsert valid rows + the ingestion audit entry atomically.
    if (successRows.length > 0) {
      const ops: Prisma.PrismaPromise<unknown>[] = successRows.map((r) =>
        this.prisma.site.upsert({
          where: { clientId_code: { clientId, code: r.code } },
          create: {
            clientId, code: r.code, name: r.name, phone: r.phone,
            lat: r.lat, lng: r.lng, town: r.town, rsCode: r.rsCode,
            vendorId: r.vendorId, asmUserId: r.asmUserId, status: r.status,
          },
          // F3: UPDATE only the columns whose source cell was non-empty. `name` is required
          // (a blank name row is rejected upstream) so it is always written; every other
          // column is gated on `present.*` so a blank cell preserves the existing value.
          update: {
            name: r.name,
            ...(r.present.phone ? { phone: r.phone } : {}),
            ...(r.present.latlng ? { lat: r.lat, lng: r.lng } : {}),
            ...(r.present.town ? { town: r.town } : {}),
            ...(r.present.rsCode ? { rsCode: r.rsCode } : {}),
            ...(r.present.vendor ? { vendorId: r.vendorId } : {}),
            ...(r.present.asm ? { asmUserId: r.asmUserId } : {}),
            ...(r.present.status ? { status: r.status } : {}),
          },
        }),
      );
      ops.push(
        this.prisma.auditLog.create({
          data: {
            action: 'IMPORT',
            entityType: 'SITE',
            entityId: batchId,
            actorId: user.sub,
            metadata: {
              event: 'SITE_BULK_UPLOAD',
              clientId,
              fileName: file.originalname,
              rowCount: rows.length,
              successCount: successRows.length,
              errorCount: errorRows.length,
            },
          },
        }),
      );
      await this.prisma.$transaction(ops);
    } else {
      // Nothing to upsert, but still record the (all-rejected) ingestion attempt.
      await this.prisma.auditLog.create({
        data: {
          action: 'IMPORT',
          entityType: 'SITE',
          entityId: batchId,
          actorId: user.sub,
          metadata: {
            event: 'SITE_BULK_UPLOAD',
            clientId,
            fileName: file.originalname,
            rowCount: rows.length,
            successCount: 0,
            errorCount: errorRows.length,
          },
        },
      });
    }

    return {
      batchId,
      rowCount: rows.length,
      successCount: successRows.length,
      errorCount: errorRows.length,
      errorFileBase64: errorRows.length > 0 ? this.buildErrorFile(errorRows) : null,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  /** Build the base64 rejection report — CSV-injection-safe via aoaToSheetSafe. */
  private buildErrorFile(errorRows: SiteErrorRow[]): string {
    const headers = [...SITE_ERROR_HEADERS];
    const data = errorRows.map((r) => [
      r.rowNumber, r.code, r.name, r.phone, r.lat, r.lng, r.town,
      r.rs_code, r.vendor_code, r.asm_phone, r.status, r.error_remarks,
    ]);
    const ws = aoaToSheetSafe([headers, ...data]);
    ws['!cols'] = headers.map((h) => ({ wch: h === 'error_remarks' ? 60 : h.length + 4 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Errors');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return buf.toString('base64');
  }

  /** Assert a referenced vendor / ASM belongs to the same tenant (and ASM is an ASM). */
  private async assertRefsInTenant(
    clientId: string,
    vendorId?: string,
    asmUserId?: string,
  ): Promise<void> {
    if (vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: vendorId, clientId }, select: { id: true },
      });
      if (!vendor) throw new BadRequestException('vendorId is not a vendor in this tenant');
    }
    if (asmUserId) {
      const asm = await this.prisma.user.findFirst({
        where: { id: asmUserId, clientId }, select: { id: true, role: true },
      });
      if (!asm) throw new BadRequestException('asmUserId is not a user in this tenant');
      if (asm.role !== 'ASM') throw new BadRequestException('asmUserId must reference an ASM user');
    }
  }

  /** Map a Prisma unique-constraint violation on (clientId, code) to a clean 400. */
  private mapUniqueError(e: unknown, code: string): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BadRequestException(`A site with code "${code}" already exists in this tenant`);
    }
    return e as Error;
  }

  /** Plain (Decimal-free) snapshot for the audit trail's old/new Json columns. */
  private snapshot(site: {
    id: string; code: string; name: string; phone: string | null;
    lat: Prisma.Decimal | null; lng: Prisma.Decimal | null; town: string | null;
    rsCode: string | null; vendorId: string | null; asmUserId: string | null; status: SiteStatus;
  }): Prisma.InputJsonValue {
    return {
      id: site.id, code: site.code, name: site.name, phone: site.phone,
      lat: site.lat != null ? site.lat.toString() : null,
      lng: site.lng != null ? site.lng.toString() : null,
      town: site.town, rsCode: site.rsCode,
      vendorId: site.vendorId, asmUserId: site.asmUserId, status: site.status,
    };
  }

  /** Append-only audit write (chassis AuditLog pattern). */
  private writeAudit(
    user: JwtPayload,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    entityId: string,
    oldValues: Prisma.InputJsonValue | null,
    newValues: Prisma.InputJsonValue | null,
    extraMeta?: Record<string, unknown>,
  ) {
    return this.prisma.auditLog.create({
      data: {
        action,
        entityType: 'SITE',
        entityId,
        actorId: user.sub,
        oldValues: oldValues ?? Prisma.JsonNull,
        newValues: newValues ?? Prisma.JsonNull,
        metadata: { clientId: user.clientId, ...(extraMeta ?? {}) },
      },
    });
  }
}
