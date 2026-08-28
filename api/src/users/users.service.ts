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
import { tenantScope } from '../common/tenant-scope';
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
    const clientId = user.clientId; // writes pin to the caller's tenant
    await this.assertVendorLinkage(clientId, dto.role, dto.vendorId ?? null);

    try {
      const created = await this.prisma.user.create({
        data: {
          clientId,
          phone: dto.phone,
          name: dto.name,
          role: dto.role,
          vendorId: dto.vendorId ?? null,
        },
        select: PUBLIC_SELECT,
      });
      await this.audit(user, 'CREATE', created.id, undefined, created);
      return created;
    } catch (e) {
      this.rethrowDuplicate(e, dto.phone);
    }
  }

  async update(user: JwtPayload, id: string, dto: UpdateUserDto) {
    const existing = await this.findScopedOrThrow(user, id);

    // Effective role/vendor AFTER the patch — the invariant is checked against the RESULT.
    const nextRole: ManagedRole = (dto.role ?? existing.role) as ManagedRole;
    const nextVendorId: string | null =
      dto.vendorId === undefined ? existing.vendorId : dto.vendorId;
    await this.assertVendorLinkage(existing.clientId, nextRole, nextVendorId);

    try {
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: PUBLIC_SELECT,
      });
      await this.audit(user, 'UPDATE', updated.id, existing, updated);

      // A reactivation (false→true) needs no eviction; a deactivation via update MUST still
      // evict live sessions, exactly like the DELETE path.
      if (dto.isActive === false && existing.isActive) {
        await this.authService.invalidateAllSessions(updated.id);
      }
      return updated;
    } catch (e) {
      this.rethrowDuplicate(e, dto.phone ?? existing.phone);
    }
  }

  /**
   * Soft-deactivate: isActive=false AND invalidate ALL sessions so the disabled login is evicted
   * immediately (not merely within the access-token TTL). Never a hard delete.
   */
  async deactivate(user: JwtPayload, id: string) {
    const existing = await this.findScopedOrThrow(user, id);
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
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: vendorId, clientId },
        select: { id: true },
      });
      if (!vendor) {
        throw new BadRequestException('vendorId does not match a vendor in this tenant.');
      }
    } else if (vendorId) {
      throw new BadRequestException(
        `A ${role} user must not be linked to a vendor (remove vendorId).`,
      );
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

  private rethrowDuplicate(e: unknown, phone: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
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
