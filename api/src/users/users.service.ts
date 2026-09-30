import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, platformWide } from '../common/tenant-scope';
import { normalizeIndianPhone } from '../common/phone';
import { aoaToSheetSafe } from '../common/xlsx';
import { CreateUserDto, ManagedRole, MANAGED_ROLES } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { USER_UPLOAD_REQUIRED_HEADERS, USER_ERROR_HEADERS } from './users.constants';

/** A rejected bulk-upload row — echoes the source cells plus the reason. */
interface UserErrorRow {
  rowNumber: number;
  phone: string;
  name: string;
  role: string;
  vendor_code: string;
  promoter_code: string;
  error_remarks: string;
}

/** F2: hard cap on data rows per bulk upload — bounds per-request work on an untrusted file. */
const MAX_USER_UPLOAD_ROWS = 5000;

const VENDOR_ROLES: ReadonlySet<string> = new Set(['VENDOR_FIELD', 'VENDOR_HO']);
const isVendorRole = (role: string) => VENDOR_ROLES.has(role);

/** JSON-safe snapshot for AuditLog (Dates → ISO strings; strips undefined). */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** Never leak the session kill-switch / internal columns to an admin client. */
const PUBLIC_SELECT = {
  id: true,
  clientId: true,
  phone: true,
  name: true,
  role: true,
  vendorId: true,
  promoterCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/**
 * Admin management of all human logins (CLIENT_ADMIN / ASM / AUDITOR / VENDOR_HO / VENDOR_FIELD).
 *
 * Invariants enforced HERE (so create AND update share them — not just DTO shape):
 *  - a VENDOR_FIELD / VENDOR_HO user MUST be tied to a vendorId that exists in the same tenant;
 *  - a non-vendor role MUST NOT carry a vendorId;
 *  - (clientId, phone) is unique → a duplicate is a friendly 409.
 *
 * Tenancy: writes pin clientId to the caller; reads + by-id lookups scope by tenantScope(user)
 * (un-assumed GIFSY_ADMIN = platform-wide). Deactivate flips isActive=false AND immediately
 * evicts every live session via AuthService.invalidateAllSessions (re-audit-required eviction).
 * Every mutation appends an AuditLog row.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────────

  async list(user: JwtPayload) {
    const scope = tenantScope(user);
    return this.prisma.user.findMany({
      where: {
        ...(scope ? { clientId: scope } : {}),
        // This admin surface manages tenant logins only — the platform operator is not listed.
        role: { not: 'GIFSY_ADMIN' },
      },
      select: PUBLIC_SELECT,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async get(user: JwtPayload, id: string) {
    return this.findScopedOrThrow(user, id);
  }

  // ── Writes ─────────────────────────────────────────────────────────────────────

  async create(user: JwtPayload, dto: CreateUserDto) {
    // F8: an un-assumed GIFSY_ADMIN has no tenant context — refuse tenant-data writes.
    this.assertTenantContext(user);
    const clientId = user.clientId; // writes pin to the caller's tenant
    // F5: canonicalise to E.164 BEFORE the uniqueness check + store so the two typed forms
    // (`9830011252` / `+919830011252`) collapse to one identity.
    const phone = normalizeIndianPhone(dto.phone);
    await this.assertVendorLinkage(clientId, dto.role, dto.vendorId ?? null);

    try {
      const created = await this.prisma.user.create({
        data: {
          clientId,
          phone,
          name: dto.name,
          role: dto.role,
          vendorId: dto.vendorId ?? null,
          promoterCode: this.cleanPromoterCode(dto.promoterCode),
        },
        select: PUBLIC_SELECT,
      });
      await this.audit(user, 'CREATE', created.id, undefined, created);
      return created;
    } catch (e) {
      this.rethrowDuplicate(e, phone, this.cleanPromoterCode(dto.promoterCode));
    }
  }

  async update(user: JwtPayload, id: string, dto: UpdateUserDto) {
    const existing = await this.findScopedOrThrow(user, id);

    // Effective role/vendor AFTER the patch — the invariant is checked against the RESULT.
    const nextRole: ManagedRole = (dto.role ?? existing.role) as ManagedRole;
    const nextVendorId: string | null =
      dto.vendorId === undefined ? existing.vendorId : dto.vendorId;
    await this.assertVendorLinkage(existing.clientId, nextRole, nextVendorId);

    // F5: canonicalise a supplied phone to E.164 before the uniqueness check + store.
    const nextPhone =
      dto.phone !== undefined ? normalizeIndianPhone(dto.phone) : undefined;

    // F6: an update that DEACTIVATES or DEMOTES-away-from-CLIENT_ADMIN must not lock the
    // tenant out — block self-target and last-active-admin removal BEFORE mutating.
    const deactivating = dto.isActive === false && existing.isActive;
    const demotingFromAdmin =
      existing.role === 'CLIENT_ADMIN' && nextRole !== 'CLIENT_ADMIN';
    if (deactivating || demotingFromAdmin) {
      await this.assertNotTenantLockout(user, existing);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(nextPhone !== undefined ? { phone: nextPhone } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId } : {}),
          ...(dto.promoterCode !== undefined
            ? { promoterCode: this.cleanPromoterCode(dto.promoterCode) }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: PUBLIC_SELECT,
      });
      await this.audit(user, 'UPDATE', updated.id, existing, updated);

      // Session-eviction triggers (immediate enforcement, not merely within the access-token
      // TTL). A reactivation (false→true) needs no eviction; otherwise evict when:
      //  - the update DEACTIVATES (isActive true→false), OR
      //  - the effective role OR vendorId ACTUALLY CHANGES (F4) — a demotion / vendor
      //    re-scope must bite now, so a stale token can't keep acting under the old grant.
      const roleOrVendorChanged =
        nextRole !== existing.role || nextVendorId !== existing.vendorId;
      if (deactivating || roleOrVendorChanged) {
        await this.authService.invalidateAllSessions(updated.id);
      }
      return updated;
    } catch (e) {
      this.rethrowDuplicate(e, nextPhone ?? existing.phone, this.cleanPromoterCode(dto.promoterCode));
    }
  }

  /**
   * Soft-deactivate: isActive=false AND invalidate ALL sessions so the disabled login is evicted
   * immediately (not merely within the access-token TTL). Never a hard delete.
   */
  async deactivate(user: JwtPayload, id: string) {
    const existing = await this.findScopedOrThrow(user, id);
    // F6: never let a caller deactivate themselves, nor strip the tenant's last active admin.
    await this.assertNotTenantLockout(user, existing);
    const updated = await this.prisma.user.update({
      where: { id: existing.id },
      data: { isActive: false },
      select: PUBLIC_SELECT,
    });
    await this.audit(user, 'DELETE', updated.id, existing, updated);
    // Eviction wiring — stamp sessionsInvalidBefore + revoke live sessions.
    const revoked = await this.authService.invalidateAllSessions(updated.id);
    this.logger.log(`Deactivated user ${updated.id} — ${revoked} live session(s) revoked`);
    return updated;
  }

  // ── Bulk upload (Excel) ────────────────────────────────────────────────────────

  /**
   * Excel bulk-ingestion of logins. Mirrors the sites bulk-upload (case-insensitive headers,
   * per-row validation, base64 rejection report, 5 MB / 5000-row caps, one $transaction).
   *
   * KEY SAFETY DIFFERENCE (auth-sensitive path): this is an UPSERT by (clientId, phone), but for an
   * EXISTING phone it writes ONLY `name` + `promoterCode` — role, vendor and active-state are NEVER
   * changed by upload. That avoids the mass session-eviction / last-admin-lockout hazards the
   * single-record update guards against (WoW: find WHERE a bulk guard must live). New phones are
   * created with the full role/vendor/promoter payload.
   */
  async bulkUpload(user: JwtPayload, file: Express.Multer.File | undefined) {
    // F8: an un-assumed GIFSY_ADMIN has no tenant context — refuse tenant-data writes.
    this.assertTenantContext(user);
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
    const missing = USER_UPLOAD_REQUIRED_HEADERS.filter((h) => !fileKeys.includes(h));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missing.join(', ')}. Please use the downloaded template.`,
      );
    }
    if (rows.length > MAX_USER_UPLOAD_ROWS) {
      throw new BadRequestException(
        `Too many rows (${rows.length}). The maximum per upload is ${MAX_USER_UPLOAD_ROWS}. ` +
          'Please split the file and upload in batches.',
      );
    }

    // Preload the tenant's vendors + existing logins ONCE — so per-row resolution and the
    // phone/promoter-code collision checks are in-memory (not N queries), and we can tell a
    // create from an update.
    const [vendors, existingUsers] = await Promise.all([
      this.prisma.vendor.findMany({ where: { clientId }, select: { id: true, code: true, isActive: true } }),
      this.prisma.user.findMany({
        where: { clientId, role: { not: 'GIFSY_ADMIN' } },
        select: { phone: true, promoterCode: true },
      }),
    ]);
    const vendorByCode = new Map(vendors.map((v) => [v.code.toLowerCase(), v]));
    const existingPhones = new Set(existingUsers.map((u) => u.phone));
    const promoterOwner = new Map<string, string>(); // promoterCode(lower) → phone
    for (const u of existingUsers) if (u.promoterCode) promoterOwner.set(u.promoterCode.toLowerCase(), u.phone);

    interface Ok {
      phone: string; name: string; role: ManagedRole; vendorId: string | null;
      promoterCode: string | null; promoterPresent: boolean;
    }
    const successRows: Ok[] = [];
    const errorRows: UserErrorRow[] = [];
    const seenPhones = new Set<string>();
    const seenPromoters = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // row 1 = header
      const lower: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rows[i])) lower[k.trim().toLowerCase()] = v;
      const get = (key: string): string => String(lower[key] ?? '').trim();

      const phoneRaw = get('phone');
      const name = get('name');
      const roleRaw = get('role');
      const vendorCode = get('vendor_code');
      const promoterCode = get('promoter_code');

      const addError = (reason: string) =>
        errorRows.push({
          rowNumber, phone: phoneRaw, name, role: roleRaw,
          vendor_code: vendorCode, promoter_code: promoterCode, error_remarks: reason,
        });

      if (!phoneRaw) { addError('phone is required'); continue; }
      // Validate as a 10-digit Indian mobile (mirrors the DTO's @IsMobilePhone('en-IN')), then
      // canonicalise to E.164 exactly as normalizeIndianPhone does.
      const digits = phoneRaw.replace(/\D/g, '');
      const last10 = digits.length > 10 ? digits.slice(-10) : digits;
      if (last10.length !== 10 || !/^[6-9]/.test(last10)) {
        addError(`Invalid phone "${phoneRaw}" (must be a 10-digit Indian mobile)`); continue;
      }
      const phone = normalizeIndianPhone(phoneRaw);
      if (!name) { addError('name is required'); continue; }
      if (!roleRaw) { addError('role is required'); continue; }
      const role = roleRaw.toUpperCase();
      if (!(MANAGED_ROLES as readonly string[]).includes(role)) {
        addError(`Invalid role "${roleRaw}" (allowed: ${MANAGED_ROLES.join(', ')})`); continue;
      }

      if (seenPhones.has(phone)) {
        addError(`Duplicate phone "${phoneRaw}" appears more than once in this file`); continue;
      }

      // Vendor-linkage invariant: vendor roles REQUIRE an active tenant vendor; others must not.
      const isVendor = role === 'VENDOR_FIELD' || role === 'VENDOR_HO';
      let vendorId: string | null = null;
      if (isVendor) {
        if (!vendorCode) { addError(`A ${role} user requires vendor_code`); continue; }
        const v = vendorByCode.get(vendorCode.toLowerCase());
        if (!v) { addError(`Vendor code "${vendorCode}" not found in this tenant`); continue; }
        if (!v.isActive) { addError(`Vendor code "${vendorCode}" is inactive`); continue; }
        vendorId = v.id;
      } else if (vendorCode) {
        addError(`A ${role} user must not have a vendor_code`); continue;
      }

      // Promoter code: within-file de-dup + collision with a DIFFERENT existing user.
      let promoter: string | null = null;
      if (promoterCode) {
        const key = promoterCode.toLowerCase();
        if (seenPromoters.has(key)) {
          addError(`Duplicate promoter_code "${promoterCode}" appears more than once in this file`); continue;
        }
        const owner = promoterOwner.get(key);
        if (owner && owner !== phone) {
          addError(`Promoter code "${promoterCode}" is already assigned to another user in this tenant`); continue;
        }
        promoter = promoterCode;
      }

      seenPhones.add(phone);
      if (promoter) seenPromoters.add(promoter.toLowerCase());
      successRows.push({
        phone, name, role: role as ManagedRole, vendorId,
        promoterCode: promoter, promoterPresent: promoterCode !== '',
      });
    }

    const batchId = randomUUID();
    const auditData: Prisma.AuditLogCreateInput = {
      action: 'IMPORT', entityType: 'USER', entityId: batchId, actorId: user.sub,
      metadata: {
        event: 'USER_BULK_UPLOAD', clientId, fileName: file.originalname,
        rowCount: rows.length, successCount: successRows.length, errorCount: errorRows.length,
      } as Prisma.InputJsonValue,
    };

    if (successRows.length > 0) {
      const ops: Prisma.PrismaPromise<unknown>[] = successRows.map((r) =>
        this.prisma.user.upsert({
          where: { clientId_phone: { clientId, phone: r.phone } },
          create: {
            clientId, phone: r.phone, name: r.name, role: r.role,
            vendorId: r.vendorId, promoterCode: r.promoterCode,
          },
          // SAFETY: an existing login is updated for name + promoter code ONLY (promoter is
          // present-gated so a blank cell preserves the current code). role / vendor / isActive
          // are intentionally never written here.
          update: { name: r.name, ...(r.promoterPresent ? { promoterCode: r.promoterCode } : {}) },
        }),
      );
      ops.push(this.prisma.auditLog.create({ data: auditData }));
      await this.prisma.$transaction(ops);
    } else {
      await this.prisma.auditLog.create({ data: auditData });
    }

    return {
      batchId,
      rowCount: rows.length,
      successCount: successRows.length,
      errorCount: errorRows.length,
      errorFileBase64: errorRows.length > 0 ? this.buildUserErrorFile(errorRows) : null,
    };
  }

  /** Build the base64 rejection report — CSV-injection-safe via aoaToSheetSafe. */
  private buildUserErrorFile(errorRows: UserErrorRow[]): string {
    const headers = [...USER_ERROR_HEADERS];
    const data = errorRows.map((r) => [
      r.rowNumber, r.phone, r.name, r.role, r.vendor_code, r.promoter_code, r.error_remarks,
    ]);
    const ws = aoaToSheetSafe([headers, ...data]);
    ws['!cols'] = headers.map((h) => ({ wch: h === 'error_remarks' ? 60 : h.length + 6 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Errors');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return buf.toString('base64');
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Enforce the vendor-linkage invariant:
   *  - vendor role  → vendorId REQUIRED and must resolve to a vendor in `clientId`;
   *  - non-vendor   → vendorId must be null/absent.
   */
  private async assertVendorLinkage(
    clientId: string,
    role: string,
    vendorId: string | null,
  ): Promise<void> {
    if (isVendorRole(role)) {
      if (!vendorId) {
        throw new BadRequestException(
          `A ${role} user must be linked to a vendor (vendorId is required).`,
        );
      }
      // F7: an inactive (soft-deleted) vendor must not accept new logins — require isActive.
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: vendorId, clientId, isActive: true },
        select: { id: true },
      });
      if (!vendor) {
        throw new BadRequestException('vendorId does not match an active vendor in this tenant.');
      }
    } else if (vendorId) {
      throw new BadRequestException(
        `A ${role} user must not be linked to a vendor (remove vendorId).`,
      );
    }
  }

  /**
   * F8: refuse a tenant-data WRITE from an un-assumed GIFSY_ADMIN (no tenant context — its
   * clientId is the platform tenant). Reads stay platform-wide; only writes are gated. An
   * ASSUMED operator (working inside a brand) and every tenant admin pass.
   */
  private assertTenantContext(user: JwtPayload): void {
    if (platformWide(user)) {
      throw new BadRequestException('Assume a tenant before creating tenant data.');
    }
  }

  /**
   * F6 tenant lock-out guards — for an operation that DEACTIVATES or DEMOTES-away-from
   * CLIENT_ADMIN a target user:
   *  (a) a caller may not deactivate/demote THEMSELVES (compare target id to `user.sub`);
   *  (b) the LAST active CLIENT_ADMIN of the tenant may not be removed (count active admins
   *      in the tenant; the target counts itself, so <= 1 means it is the last).
   */
  private async assertNotTenantLockout(
    user: JwtPayload,
    existing: { id: string; clientId: string; role: string; isActive: boolean },
  ): Promise<void> {
    if (existing.id === user.sub) {
      throw new BadRequestException('You cannot deactivate or demote your own account.');
    }
    if (existing.role === 'CLIENT_ADMIN' && existing.isActive) {
      const activeAdmins = await this.prisma.user.count({
        where: { clientId: existing.clientId, role: 'CLIENT_ADMIN', isActive: true },
      });
      if (activeAdmins <= 1) {
        throw new BadRequestException(
          'Cannot deactivate or demote the last active CLIENT_ADMIN of this tenant.',
        );
      }
    }
  }

  private async findScopedOrThrow(user: JwtPayload, id: string) {
    const scope = tenantScope(user);
    const target = await this.prisma.user.findFirst({
      where: {
        id,
        ...(scope ? { clientId: scope } : {}),
        role: { not: 'GIFSY_ADMIN' },
      },
      select: PUBLIC_SELECT,
    });
    if (!target) throw new NotFoundException('User not found');
    return target;
  }

  /**
   * Normalise a promoter code: trim, and treat an empty string as "cleared" (null). Keeping empty
   * → null means a blank field never trips the (clientId, promoterCode) unique against another
   * blank (Postgres NULLs are distinct) and the column stays truly absent rather than "".
   */
  private cleanPromoterCode(raw: string | undefined): string | null {
    if (raw === undefined) return null;
    const t = raw.trim();
    return t === '' ? null : t;
  }

  /**
   * Map a Prisma P2002 to a friendly 409. There are TWO tenant-unique constraints on User —
   * (clientId, phone) and (clientId, promoterCode) — so disambiguate by the violated target and
   * name the right field (a promoter-code clash must not be reported as a phone clash).
   */
  private rethrowDuplicate(e: unknown, phone: string, promoterCode: string | null): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = e.meta?.target;
      const hitPromoter = Array.isArray(target)
        ? target.includes('promoterCode')
        : typeof target === 'string' && target.includes('promoterCode');
      if (hitPromoter) {
        throw new ConflictException(
          `Promoter code "${promoterCode ?? ''}" is already assigned to another user in this tenant.`,
        );
      }
      throw new ConflictException(
        `A user with phone ${phone} already exists in this tenant.`,
      );
    }
    throw e;
  }

  private async audit(
    user: JwtPayload,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    entityId: string,
    oldValues?: unknown,
    newValues?: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action,
        entityType: 'USER',
        entityId,
        ...(oldValues !== undefined ? { oldValues: toJson(oldValues) } : {}),
        ...(newValues !== undefined ? { newValues: toJson(newValues) } : {}),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
