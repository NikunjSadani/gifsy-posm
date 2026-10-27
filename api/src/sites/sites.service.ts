import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, Site, SiteStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope, platformWide } from '../common/tenant-scope';
import { normalizeEmail } from '../common/password';
import { aoaToSheetSafe } from '../common/xlsx';
import { BulkUploadResult } from '../common/bulk-result';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { ListSitesDto } from './dto/list-sites.dto';
import {
  SITE_UPLOAD_HEADERS,
  SITE_UPLOAD_REQUIRED_HEADERS,
  SITE_ERROR_HEADERS,
  SITE_SUCCESS_HEADERS,
  SITE_DEACTIVATE_HEADERS,
  SITE_DEACTIVATE_REQUIRED_HEADERS,
  SITE_DEACTIVATE_ERROR_HEADERS,
  SITE_DEACTIVATE_SUCCESS_HEADERS,
} from './sites.constants';

/** A row of the bulk-deactivate rejection report — a bad / missing / unknown code + reason. */
interface SiteDeactivateErrorRow {
  rowNumber: number;
  code: string;
  reason: string;
}

/** A row of the bulk-deactivate success report — code, name, and the action taken. */
interface SiteDeactivateSuccessRow {
  code: string;
  name: string;
  action: 'Deactivated' | 'Already inactive';
}

/** A rejected upload row — echoes the source cell values plus the reason. */
interface SiteErrorRow {
  rowNumber: number;
  code: string;
  name: string;
  lat: string;
  lng: string;
  region: string;
  state: string;
  cluster: string;
  town: string;
  rs_code: string;
  rs_name: string;
  beat_name: string;
  channel: string;
  address: string;
  pincode: string;
  vendor_code: string;
  asm_email: string;
  gsb_allowed: string;
  status: string;
  error_remarks: string;
}

/**
 * A validated, resolved upload row ready to upsert.
 *
 * `present` records which SOURCE CELLS were non-empty (F3). On the upsert UPDATE branch a
 * column is written ONLY when its source cell was non-empty, so a blank cell LEAVES the
 * existing value unchanged (never null-outs vendorId/asmUserId/lat/lng/town/rsCode/rsName/
 * pincode/gsbAllowed/status). The CREATE branch always writes the resolved values (blank →
 * null / default; gsbAllowed defaults false). `phone` is no longer part of the upload.
 */
interface SiteSuccessRow {
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  region: string | null;
  state: string | null;
  cluster: string | null;
  town: string | null;
  rsCode: string | null;
  rsName: string | null;
  beatName: string | null;
  channel: string | null;
  address: string | null;
  pincode: string | null;
  vendorId: string | null;
  asmUserId: string | null;
  gsbAllowed: boolean;
  status: SiteStatus;
  present: {
    latlng: boolean;
    region: boolean;
    state: boolean;
    cluster: boolean;
    town: boolean;
    rsCode: boolean;
    rsName: boolean;
    beatName: boolean;
    channel: boolean;
    address: boolean;
    pincode: boolean;
    vendor: boolean;
    asm: boolean;
    gsbAllowed: boolean;
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
    // RS code + Beat are EXACT case-insensitive matches (the field app picks one value from
    // a dependent drop-down, not a substring). The field app is the only consumer passing
    // these; the admin list does not filter on rsCode, so no substring behaviour is lost.
    if (q.rsCode) where.rsCode = { equals: q.rsCode, mode: 'insensitive' };
    // Beat: a non-empty `beatNames` multi-select wins — matched CASE-INSENSITIVELY (an OR of
    // insensitive equals, AND-ed with the other top-level scalar pins). Bulk-uploaded beat data can
    // carry mixed casing ("MG Road" vs "mg road"); an exact `{ in }` would silently hide pending
    // recces under the other casing, so we mirror the legacy single-beat insensitive match.
    // Otherwise the legacy single `beatName` keeps its insensitive match (back-compat). Else: none.
    if (Array.isArray(q.beatNames) && q.beatNames.length > 0) {
      where.OR = q.beatNames.map((b) => ({ beatName: { equals: b, mode: 'insensitive' } }));
    } else if (q.beatName) {
      where.beatName = { equals: q.beatName, mode: 'insensitive' };
    }
    // Visibility by status: a DEACTIVATED (INACTIVE) outlet is ADMIN-ONLY. Field / ASM / vendor-HO
    // roles are hard-pinned to ACTIVE outlets — a `status` filter they pass is ignored, so a
    // deactivated outlet can never surface in the field list, the nearby map, or the recce picker.
    // Admins may filter by status (validated to a SiteStatus by the DTO) and see all by default.
    const isAdmin = user.role === 'CLIENT_ADMIN' || user.role === 'GIFSY_ADMIN';
    if (isAdmin) {
      if (q.status) where.status = q.status;
    } else {
      where.status = SiteStatus.ACTIVE;
    }
    // Apply the vendorId filter only when the caller is NOT already vendor-pinned —
    // otherwise it could override the security pin and leak a sibling vendor's fleet.
    if (q.vendorId && !this.isVendorRole(user)) where.vendorId = q.vendorId;
    // "Recce to do": outlets that still owe a recce. An outlet qualifies if it has NO recce at
    // all, OR its APP recce was REJECTED — a rejected recce is re-captured from this list (the
    // field "Recce to do" screen), not the Installation screen. Composed as an OR AND-ed onto the
    // scope. CRITICAL: a multi-beat `beatNames` filter above may already have set `where.OR`;
    // overwriting it would silently drop the beat filter. So both OR groups are pushed into
    // `where.AND` as their own `{ OR: [...] }` entries (AND-ed together), preserving the beat +
    // name + scope filters. Applied to both findMany and count.
    if (q.pendingRecce) {
      const pendingRecceOr: Prisma.SiteWhereInput[] = [
        { recces: { none: {} } },
        { recces: { some: { recceMode: 'APP', status: 'REJECTED' } } },
      ];
      const andClauses: Prisma.SiteWhereInput[] = Array.isArray(where.AND)
        ? [...where.AND]
        : where.AND
          ? [where.AND]
          : [];
      // Move an existing beat-OR into AND so the pendingRecce-OR below can't clobber it.
      if (where.OR) {
        andClauses.push({ OR: where.OR as Prisma.SiteWhereInput[] });
        delete where.OR;
      }
      andClauses.push({ OR: pendingRecceOr });
      where.AND = andClauses;
    }

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

  // ── Filter drop-down options (RS code → Beat, scoped like list) ─────────────────
  /**
   * Distinct, sorted RS codes — each WITH a representative RS name — among the caller's SCOPED
   * sites, the source for the field app's RS-code drop-down (which now shows code + name).
   * Scoped identically to {@link list} (vendor pin for a vendor role, tenant pin, ACTIVE-only
   * for non-admins) and FAILS CLOSED for a vendor with no scope (empty array, NO query).
   * Rows whose rsCode is null/empty/whitespace are dropped. `distinct: ['rsCode']` keeps ONE
   * row per code, so a code that appears with multiple names in dirty data contributes a single
   * accepted representative name. The orderBy must START with the distinct column.
   */
  async rsCodeOptions(
    user: JwtPayload,
  ): Promise<{ rsCodes: Array<{ code: string; name: string | null }> }> {
    const scope = this.scopedWhere(user);
    if (scope === null) return { rsCodes: [] }; // fail-closed: no scope → no query
    const where: Prisma.SiteWhereInput = { ...scope };
    const isAdmin = user.role === 'CLIENT_ADMIN' || user.role === 'GIFSY_ADMIN';
    if (!isAdmin) where.status = SiteStatus.ACTIVE;

    const rows = await this.prisma.site.findMany({
      where,
      distinct: ['rsCode'],
      select: { rsCode: true, rsName: true },
      orderBy: [{ rsCode: 'asc' }],
    });
    const rsCodes = rows
      .filter((r): r is { rsCode: string; rsName: string | null } =>
        !!r.rsCode && r.rsCode.trim() !== '')
      .map((r) => ({ code: r.rsCode, name: r.rsName ?? null }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return { rsCodes };
  }

  /**
   * Distinct, sorted Beat names among the caller's SCOPED sites whose `rsCode` EXACT-equals
   * the required `rsCode` query param (case-insensitive) — the dependent Beat drop-down.
   * Same scoping + fail-closed behaviour as {@link rsCodeOptions}; a missing rsCode is a 400.
   */
  async beatOptions(user: JwtPayload, rsCode?: string): Promise<{ beats: string[] }> {
    const code = (rsCode ?? '').trim();
    if (!code) throw new BadRequestException('rsCode query parameter is required.');
    const scope = this.scopedWhere(user);
    if (scope === null) return { beats: [] }; // fail-closed: no scope → no query
    const where: Prisma.SiteWhereInput = { ...scope };
    const isAdmin = user.role === 'CLIENT_ADMIN' || user.role === 'GIFSY_ADMIN';
    if (!isAdmin) where.status = SiteStatus.ACTIVE;
    where.rsCode = { equals: code, mode: 'insensitive' };

    const rows = await this.prisma.site.findMany({
      where,
      distinct: ['beatName'],
      select: { beatName: true },
    });
    // The DB `distinct` is case-sensitive, so "MG Road" and "mg road" would both appear. Collapse
    // them case/whitespace-insensitively to ONE representative chip (the field matches beats
    // insensitively too), so a rep can't miss outlets stored under a different casing.
    const seen = new Set<string>();
    const beats = rows
      .map((r) => r.beatName)
      .filter((v): v is string => !!v && v.trim() !== '')
      .filter((v) => {
        const key = v.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
    return { beats };
  }

  // ── Get one (scoped) ───────────────────────────────────────────────────────────
  async get(user: JwtPayload, id: string) {
    const scope = this.scopedWhere(user);
    if (scope === null) throw new NotFoundException('Outlet not found');
    const site = await this.prisma.site.findFirst({ where: { ...scope, id } });
    if (!site) throw new NotFoundException('Outlet not found');
    return site;
  }

  // ── Outlet-ID lookup (warn-and-prefill for the Manual Recce UX) ─────────────────
  /**
   * Resolve an exact Outlet ID (Site.code) within the caller's SCOPE for the Manual Recce
   * warn-and-prefill UX (D6). A VENDOR_FIELD is vendor-pinned (only their own fleet's outlets —
   * never leaking a sibling vendor's outlet name/address/phone); an admin (CLIENT_ADMIN /
   * GIFSY_ADMIN) sees the whole tenant master. Fails closed (`exists:false`) for a vendor with no
   * scope. Exact (case-sensitive) match, mirroring the (clientId, code) unique the attach/create
   * paths key on — so a lookup "exists" iff a submit would attach to that same outlet.
   */
  async lookup(user: JwtPayload, outletId?: string): Promise<{
    exists: boolean;
    site?: {
      id: string; code: string; name: string; address: string | null; phone: string | null;
      pincode: string | null; rsName: string | null; gsbAllowed: boolean;
    };
  }> {
    const code = (outletId ?? '').trim();
    if (!code) throw new BadRequestException('outletId query parameter is required.');
    const scope = this.scopedWhere(user);
    if (scope === null) return { exists: false }; // fail-closed: a vendor with no scope sees nothing
    const site = await this.prisma.site.findFirst({
      where: { ...scope, code },
      select: {
        id: true, code: true, name: true, address: true, phone: true,
        pincode: true, rsName: true, gsbAllowed: true,
      },
    });
    if (!site) return { exists: false };
    return { exists: true, site };
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
          region: dto.region ?? null,
          state: dto.state ?? null,
          cluster: dto.cluster ?? null,
          town: dto.town ?? null,
          rsCode: dto.rsCode ?? null,
          rsName: dto.rsName ?? null,
          beatName: dto.beatName ?? null,
          channel: dto.channel ?? null,
          address: dto.address ?? null,
          pincode: dto.pincode ?? null,
          vendorId: dto.vendorId ?? null,
          asmUserId: dto.asmUserId ?? null,
          gsbAllowed: dto.gsbAllowed ?? false,
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
    if (dto.region !== undefined) data.region = dto.region;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.cluster !== undefined) data.cluster = dto.cluster;
    if (dto.town !== undefined) data.town = dto.town;
    if (dto.rsCode !== undefined) data.rsCode = dto.rsCode;
    if (dto.rsName !== undefined) data.rsName = dto.rsName;
    if (dto.beatName !== undefined) data.beatName = dto.beatName;
    if (dto.channel !== undefined) data.channel = dto.channel;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.pincode !== undefined) data.pincode = dto.pincode;
    if (dto.gsbAllowed !== undefined) data.gsbAllowed = dto.gsbAllowed;
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
    return this.performDeactivate(user, existing);
  }

  /**
   * The SHARED soft-delete mechanism used by BOTH the single `deactivate()` and the bulk-deactivate
   * upload: flip status → INACTIVE and write the `DEACTIVATE` audit entry. Callers are responsible
   * for scoping (resolving `existing` within the caller's tenant/scope) before calling this. Never
   * inline a bare status update elsewhere — route through here so the audit trail is never skipped.
   */
  private async performDeactivate(user: JwtPayload, existing: Site) {
    const updated = await this.prisma.site.update({
      where: { id: existing.id },
      data: { status: SiteStatus.INACTIVE },
    });
    await this.writeAudit(
      user, 'UPDATE', existing.id, this.snapshot(existing), this.snapshot(updated),
      { event: 'DEACTIVATE' },
    );
    return updated;
  }

  // ── Bulk upload ────────────────────────────────────────────────────────────────
  async bulkUpload(
    user: JwtPayload,
    file: Express.Multer.File | undefined,
  ): Promise<BulkUploadResult> {
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

    // Which codes already exist in this tenant? A row whose code is NOT present would CREATE a
    // new outlet, and a new outlet MUST carry RS code + Beat (mandatory, mirroring CreateSiteDto).
    // An existing code is an UPDATE and keeps the blank-preserve behaviour. Matched EXACTLY — the
    // same equality the upsert `where` uses — and bounded by the sheet's own codes (≤ MAX rows).
    const fileCodes = new Set<string>();
    for (const row of rows) {
      const lower: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) lower[k.trim().toLowerCase()] = v;
      const code = String(lower['code'] ?? '').trim();
      if (code) fileCodes.add(code);
    }
    const existingCodes = new Set<string>(
      fileCodes.size > 0
        ? (
            await this.prisma.site.findMany({
              where: { clientId, code: { in: [...fileCodes] } },
              select: { code: true },
            })
          ).map((s) => s.code)
        : [],
    );

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
      const latRaw = get('lat');
      const lngRaw = get('lng');
      const region = get('region');
      const state = get('state');
      const cluster = get('cluster');
      const town = get('town');
      const rsCode = get('rs_code');
      const rsName = get('rs_name');
      const beatName = get('beat_name');
      const channel = get('channel');
      const address = get('address');
      const pincode = get('pincode');
      const vendorCode = get('vendor_code');
      const asmEmail = get('asm_email');
      const gsbRaw = get('gsb_allowed');
      const statusRaw = get('status');

      const addError = (reason: string) =>
        errorRows.push({
          rowNumber, code, name,
          lat: latRaw, lng: lngRaw,
          region, state, cluster, town, rs_code: rsCode, rs_name: rsName,
          beat_name: beatName, channel, address, pincode,
          vendor_code: vendorCode, asm_email: asmEmail, gsb_allowed: gsbRaw, status: statusRaw,
          error_remarks: reason,
        });

      if (!code) { addError('code is required'); continue; }
      const codeKey = code.toLowerCase();
      if (seenCodes.has(codeKey)) {
        addError(`Duplicate code "${code}" appears more than once in this file`);
        continue;
      }
      if (!name) { addError('name is required'); continue; }

      // A NEW outlet (code not already in the tenant) MUST carry RS code + Beat — both are
      // mandatory. An existing code is an UPDATE and keeps the blank-preserve behaviour below.
      if (!existingCodes.has(code)) {
        if (!rsCode) { addError('RS code is required for a new outlet'); continue; }
        if (!beatName) { addError('Beat name is required for a new outlet'); continue; }
      }

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

      // gsb_allowed (optional Yes/No flag; blank → false). Case-insensitive: yes/true/1 → true,
      // no/false/0/blank → false, anything else is a per-row error (never a silent default).
      let gsbAllowed = false;
      if (gsbRaw !== '') {
        const g = gsbRaw.toLowerCase();
        if (g === 'yes' || g === 'true' || g === '1') {
          gsbAllowed = true;
        } else if (g === 'no' || g === 'false' || g === '0') {
          gsbAllowed = false;
        } else {
          addError('Invalid GSB Allowed value (use Yes or No)'); continue;
        }
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

      // Resolve asm_email → asmUserId (must be an ASM in the tenant). Users are stored with a
      // normalized (trimmed + lower-cased) email — mirror that on lookup so case/whitespace in the
      // sheet still resolves the same identity the (clientId, email) unique keys on.
      let asmUserId: string | null = null;
      if (asmEmail !== '') {
        const asm = await this.prisma.user.findUnique({
          where: { clientId_email: { clientId, email: normalizeEmail(asmEmail) } },
          select: { id: true, role: true },
        });
        if (!asm) {
          addError(`ASM email "${asmEmail}" not found in this tenant`); continue;
        }
        if (asm.role !== 'ASM') {
          addError(`Email "${asmEmail}" belongs to a non-ASM user`); continue;
        }
        asmUserId = asm.id;
      }

      seenCodes.add(codeKey);
      successRows.push({
        code, name,
        lat, lng,
        region: region || null,
        state: state || null,
        cluster: cluster || null,
        town: town || null,
        rsCode: rsCode || null,
        rsName: rsName || null,
        beatName: beatName || null,
        channel: channel || null,
        address: address || null,
        pincode: pincode || null,
        vendorId, asmUserId, gsbAllowed, status,
        // F3: which source cells were non-empty — the UPDATE branch writes ONLY these, so a
        // blank cell leaves the existing value untouched (lat/lng are a paired unit; gsbAllowed
        // updates only when the cell was non-blank so a blank preserves the current allow-list).
        present: {
          latlng: lat !== null && lng !== null,
          region: region !== '',
          state: state !== '',
          cluster: cluster !== '',
          town: town !== '',
          rsCode: rsCode !== '',
          rsName: rsName !== '',
          beatName: beatName !== '',
          channel: channel !== '',
          address: address !== '',
          pincode: pincode !== '',
          vendor: vendorCode !== '',
          asm: asmEmail !== '',
          gsbAllowed: gsbRaw !== '',
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
            clientId, code: r.code, name: r.name,
            lat: r.lat, lng: r.lng,
            region: r.region, state: r.state, cluster: r.cluster,
            town: r.town, rsCode: r.rsCode, rsName: r.rsName,
            beatName: r.beatName, channel: r.channel, address: r.address, pincode: r.pincode,
            vendorId: r.vendorId, asmUserId: r.asmUserId, gsbAllowed: r.gsbAllowed, status: r.status,
          },
          // F3: UPDATE only the columns whose source cell was non-empty. `name` is required
          // (a blank name row is rejected upstream) so it is always written; every other
          // column is gated on `present.*` so a blank cell preserves the existing value.
          update: {
            name: r.name,
            ...(r.present.latlng ? { lat: r.lat, lng: r.lng } : {}),
            ...(r.present.region ? { region: r.region } : {}),
            ...(r.present.state ? { state: r.state } : {}),
            ...(r.present.cluster ? { cluster: r.cluster } : {}),
            ...(r.present.town ? { town: r.town } : {}),
            ...(r.present.rsCode ? { rsCode: r.rsCode } : {}),
            ...(r.present.rsName ? { rsName: r.rsName } : {}),
            ...(r.present.beatName ? { beatName: r.beatName } : {}),
            ...(r.present.channel ? { channel: r.channel } : {}),
            ...(r.present.address ? { address: r.address } : {}),
            ...(r.present.pincode ? { pincode: r.pincode } : {}),
            ...(r.present.vendor ? { vendorId: r.vendorId } : {}),
            ...(r.present.asm ? { asmUserId: r.asmUserId } : {}),
            ...(r.present.gsbAllowed ? { gsbAllowed: r.gsbAllowed } : {}),
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
      // The imported rows + Created/Updated label. A row's code present in `existingCodes` (the
      // pre-batch snapshot taken above) was an UPDATE; otherwise the upsert CREATED a new outlet.
      successFileBase64:
        successRows.length > 0 ? this.buildSuccessFile(successRows, existingCodes) : null,
    };
  }

  // ── Bulk deactivate ──────────────────────────────────────────────────────────
  /**
   * Bulk soft-delete by upload: an .xlsx whose only required column is `code`. For each code
   * (tenant-scoped): an ACTIVE site is deactivated via the SAME {@link performDeactivate} the single
   * endpoint uses (status→INACTIVE + DEACTIVATE audit); an already-INACTIVE site is a no-op SUCCESS;
   * an unknown code is an ERROR row. Admin-only + tenant-pinned (the controller @Roles floor plus the
   * platformWide refusal below). Returns the shared {@link BulkUploadResult} shape.
   */
  async bulkDeactivate(
    user: JwtPayload,
    file: Express.Multer.File | undefined,
  ): Promise<BulkUploadResult> {
    // F8: an un-assumed GIFSY_ADMIN has no tenant context — refuse tenant-data writes.
    if (platformWide(user)) {
      throw new BadRequestException('Assume a tenant before deactivating tenant data.');
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

    const fileKeys = Object.keys(rows[0]).map((k) => k.trim().toLowerCase());
    const missing = SITE_DEACTIVATE_REQUIRED_HEADERS.filter((h) => !fileKeys.includes(h));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missing.join(', ')}. Please use the downloaded template.`,
      );
    }
    // F2: reject an oversized sheet BEFORE the per-row loop (each row does DB work).
    if (rows.length > MAX_UPLOAD_ROWS) {
      throw new BadRequestException(
        `Too many rows (${rows.length}). The maximum per upload is ${MAX_UPLOAD_ROWS}. ` +
          'Please split the file and upload in batches.',
      );
    }

    // Preload the matching sites ONCE (by the sheet's own codes, tenant-scoped) so resolution is
    // in-memory, not N queries. Matched EXACTLY, the same equality the single path keys on.
    const fileCodes = new Set<string>();
    for (const row of rows) {
      const lower: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) lower[k.trim().toLowerCase()] = v;
      const code = String(lower['code'] ?? '').trim();
      if (code) fileCodes.add(code);
    }
    const sites =
      fileCodes.size > 0
        ? await this.prisma.site.findMany({
            where: { clientId, code: { in: [...fileCodes] } },
          })
        : [];
    const siteByCode = new Map(sites.map((s) => [s.code, s]));

    const successRows: SiteDeactivateSuccessRow[] = [];
    const errorRows: SiteDeactivateErrorRow[] = [];
    const seenCodes = new Set<string>(); // within-file de-dup

    // Process sequentially so each deactivation routes through the shared single-record mechanism
    // (status→INACTIVE + DEACTIVATE audit per site) exactly as the single endpoint does.
    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // row 1 = header
      const lower: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rows[i])) lower[k.trim().toLowerCase()] = v;
      const code = String(lower['code'] ?? '').trim();

      const addError = (reason: string) => errorRows.push({ rowNumber, code, reason });

      if (!code) { addError('code is required'); continue; }
      // De-dup on the EXACT code — the same equality `siteByCode`/the unique index key on, so two
      // genuinely distinct outlets that differ only in case ("shop1" vs "SHOP1") are both processed.
      if (seenCodes.has(code)) {
        addError(`Duplicate code "${code}" appears more than once in this file`);
        continue;
      }
      seenCodes.add(code);

      const site = siteByCode.get(code);
      if (!site) { addError('outlet code not found'); continue; }

      if (site.status === SiteStatus.INACTIVE) {
        successRows.push({ code: site.code, name: site.name, action: 'Already inactive' });
        continue;
      }
      // A transient per-row failure becomes an error row — never aborts the batch, so the rows
      // already committed are still reported (retry is idempotent: already-inactive = no-op success).
      try {
        await this.performDeactivate(user, site);
        successRows.push({ code: site.code, name: site.name, action: 'Deactivated' });
      } catch (e) {
        addError(e instanceof Error ? e.message : 'could not deactivate this outlet');
      }
    }

    const batchId = randomUUID();
    // Batch-level ingestion audit (the per-site DEACTIVATE entries are written by performDeactivate).
    await this.prisma.auditLog.create({
      data: {
        action: 'IMPORT',
        entityType: 'SITE',
        entityId: batchId,
        actorId: user.sub,
        metadata: {
          event: 'SITE_BULK_DEACTIVATE',
          clientId,
          fileName: file.originalname,
          rowCount: rows.length,
          successCount: successRows.length,
          errorCount: errorRows.length,
        },
      },
    });

    return {
      batchId,
      rowCount: rows.length,
      successCount: successRows.length,
      errorCount: errorRows.length,
      errorFileBase64: errorRows.length > 0 ? this.buildDeactivateErrorFile(errorRows) : null,
      successFileBase64:
        successRows.length > 0 ? this.buildDeactivateSuccessFile(successRows) : null,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  /** A blank single-sheet .xlsx (header row only) — the sites bulk-upload download template. */
  buildUploadTemplate(): Buffer {
    const headers = [...SITE_UPLOAD_HEADERS];
    const ws = aoaToSheetSafe([headers]);
    ws['!cols'] = headers.map((h) => ({ wch: h.length + 8 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Outlets');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /** Build the base64 rejection report — CSV-injection-safe via aoaToSheetSafe. */
  private buildErrorFile(errorRows: SiteErrorRow[]): string {
    const headers = [...SITE_ERROR_HEADERS];
    const data = errorRows.map((r) => [
      r.rowNumber, r.code, r.name, r.lat, r.lng,
      r.region, r.state, r.cluster, r.town, r.rs_code, r.rs_name,
      r.beat_name, r.channel, r.address, r.pincode,
      r.vendor_code, r.asm_email, r.gsb_allowed, r.status, r.error_remarks,
    ]);
    const ws = aoaToSheetSafe([headers, ...data]);
    ws['!cols'] = headers.map((h) => ({ wch: h === 'error_remarks' ? 60 : h.length + 4 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Errors');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return buf.toString('base64');
  }

  /**
   * Build the base64 SUCCESS report for a bulk upload — the imported rows + a Created/Updated label.
   * A code present in `existingCodes` (the pre-batch snapshot) was an UPDATE; otherwise a CREATE.
   * CSV-injection-safe via aoaToSheetSafe.
   */
  private buildSuccessFile(successRows: SiteSuccessRow[], existingCodes: Set<string>): string {
    const headers = [...SITE_SUCCESS_HEADERS];
    const data = successRows.map((r) => [
      r.code,
      r.name,
      existingCodes.has(r.code) ? 'Updated' : 'Created',
    ]);
    return this.buildBase64Sheet(headers, data, 'Imported');
  }

  /** The bulk-deactivate rejection report (bad / missing / unknown codes + reason). */
  private buildDeactivateErrorFile(errorRows: SiteDeactivateErrorRow[]): string {
    const headers = [...SITE_DEACTIVATE_ERROR_HEADERS];
    const data = errorRows.map((r) => [r.rowNumber, r.code, r.reason]);
    return this.buildBase64Sheet(headers, data, 'Errors');
  }

  /** The bulk-deactivate success report (code, name, Deactivated / Already inactive). */
  private buildDeactivateSuccessFile(successRows: SiteDeactivateSuccessRow[]): string {
    const headers = [...SITE_DEACTIVATE_SUCCESS_HEADERS];
    const data = successRows.map((r) => [r.code, r.name, r.action]);
    return this.buildBase64Sheet(headers, data, 'Deactivated');
  }

  /** A blank single-sheet .xlsx (header row only) — the bulk-deactivate download template. */
  buildDeactivateTemplate(): Buffer {
    const headers = [...SITE_DEACTIVATE_HEADERS];
    const ws = aoaToSheetSafe([headers]);
    ws['!cols'] = headers.map((h) => ({ wch: h.length + 8 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Outlets');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /** Shared single-sheet base64 .xlsx builder (CSV-injection-safe via aoaToSheetSafe). */
  private buildBase64Sheet(headers: string[], data: unknown[][], sheet: string): string {
    const ws = aoaToSheetSafe([headers, ...data]);
    ws['!cols'] = headers.map((h) => ({ wch: h === 'error_remarks' ? 60 : h.length + 6 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
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
      return new BadRequestException(`An outlet with code "${code}" already exists in this tenant`);
    }
    return e as Error;
  }

  /** Plain (Decimal-free) snapshot for the audit trail's old/new Json columns. */
  private snapshot(site: {
    id: string; code: string; name: string; phone: string | null;
    lat: Prisma.Decimal | null; lng: Prisma.Decimal | null;
    region?: string | null; state?: string | null; cluster?: string | null;
    town: string | null; rsCode: string | null; rsName?: string | null;
    beatName?: string | null; channel?: string | null; address?: string | null;
    pincode?: string | null; vendorId: string | null; asmUserId: string | null;
    gsbAllowed?: boolean; status: SiteStatus;
  }): Prisma.InputJsonValue {
    return {
      id: site.id, code: site.code, name: site.name, phone: site.phone,
      lat: site.lat != null ? site.lat.toString() : null,
      lng: site.lng != null ? site.lng.toString() : null,
      region: site.region ?? null, state: site.state ?? null, cluster: site.cluster ?? null,
      town: site.town, rsCode: site.rsCode, rsName: site.rsName ?? null,
      beatName: site.beatName ?? null, channel: site.channel ?? null, address: site.address ?? null,
      pincode: site.pincode ?? null,
      vendorId: site.vendorId, asmUserId: site.asmUserId,
      // gsbAllowed governs the GSB recce gate — capture it so toggles are auditable.
      gsbAllowed: site.gsbAllowed ?? false, status: site.status,
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
