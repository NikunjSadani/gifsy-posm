import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope } from '../common/tenant-scope';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';

/** JSON-safe snapshot for AuditLog (Dates → ISO strings; strips undefined). */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/**
 * Vendor master CRUD.
 *
 * Tenancy contract (cross-tenant boundary hardening):
 *  - WRITES pin `clientId` to the CALLER's token clientId — a caller can never create/mutate a
 *    row under another tenant.
 *  - READS scope by tenantScope(user): an un-assumed GIFSY_ADMIN is platform-wide (no filter);
 *    everyone else (incl. an ASSUMED operator + CLIENT_ADMIN) is pinned to their clientId.
 *  - Every by-id read/mutate is looked up WITH the tenant filter, so a mismatched-tenant id 404s
 *    instead of leaking or mutating a sibling tenant's row.
 * Every mutation appends an immutable AuditLog row.
 */
@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reads ──────────────────────────────────────────────────────────────────────

  /** List vendors visible to the caller (tenant-scoped; platform-wide for un-assumed OWNER). */
  async list(user: JwtPayload) {
    const scope = tenantScope(user);
    return this.prisma.vendor.findMany({
      where: scope ? { clientId: scope } : {},
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  /** Get one vendor by id, confined to the caller's tenant scope. */
  async get(user: JwtPayload, id: string) {
    const vendor = await this.findScopedOrThrow(user, id);
    return vendor;
  }

  // ── Writes ─────────────────────────────────────────────────────────────────────

  async create(user: JwtPayload, dto: CreateVendorDto) {
    const clientId = user.clientId; // writes pin to the caller's tenant
    try {
      const vendor = await this.prisma.vendor.create({
        data: { clientId, code: dto.code, name: dto.name },
      });
      await this.audit(user, 'CREATE', vendor.id, undefined, vendor);
      return vendor;
    } catch (e) {
      this.rethrowDuplicate(e, dto.code);
    }
  }

  async update(user: JwtPayload, id: string, dto: UpdateVendorDto) {
    const existing = await this.findScopedOrThrow(user, id);
    try {
      const vendor = await this.prisma.vendor.update({
        where: { id: existing.id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit(user, 'UPDATE', vendor.id, existing, vendor);
      return vendor;
    } catch (e) {
      this.rethrowDuplicate(e, dto.code);
    }
  }

  /** Soft-deactivate (never a hard delete — audit trail + FK integrity preserved). */
  async deactivate(user: JwtPayload, id: string) {
    const existing = await this.findScopedOrThrow(user, id);
    const vendor = await this.prisma.vendor.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
    await this.audit(user, 'DELETE', vendor.id, existing, vendor);
    return vendor;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Find a vendor by id constrained to the caller's tenant scope, or 404. */
  private async findScopedOrThrow(user: JwtPayload, id: string) {
    const scope = tenantScope(user);
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, ...(scope ? { clientId: scope } : {}) },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  private rethrowDuplicate(e: unknown, code?: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException(
        `A vendor with code "${code ?? ''}" already exists for this tenant.`,
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
        entityType: 'VENDOR',
        entityId,
        ...(oldValues !== undefined ? { oldValues: toJson(oldValues) } : {}),
        ...(newValues !== undefined ? { newValues: toJson(newValues) } : {}),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
