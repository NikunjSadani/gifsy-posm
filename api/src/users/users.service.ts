import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, platformWide } from '../common/tenant-scope';
import { normalizeIndianPhone } from '../common/phone';
import { CreateUserDto, ManagedRole } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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
