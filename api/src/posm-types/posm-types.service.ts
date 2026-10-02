import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, platformWide } from '../common/tenant-scope';
import { CreatePosmTypeDto } from './dto/create-posm-type.dto';
import { UpdatePosmTypeDto } from './dto/update-posm-type.dto';

/** JSON-safe snapshot for AuditLog (Dates → ISO strings; strips undefined). */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/**
 * PosmType master CRUD. Same tenancy + audit contract as VendorsService:
 * writes pin clientId to the caller; reads + by-id lookups scope by tenantScope(user)
 * (un-assumed GIFSY_ADMIN = platform-wide); every mutation appends an AuditLog row.
 */
@Injectable()
export class PosmTypesService {
  private readonly logger = new Logger(PosmTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reads ──────────────────────────────────────────────────────────────────────

  async list(user: JwtPayload) {
    const scope = tenantScope(user);
    return this.prisma.posmType.findMany({
      where: scope ? { clientId: scope } : {},
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  async get(user: JwtPayload, id: string) {
    return this.findScopedOrThrow(user, id);
  }

  // ── Writes ─────────────────────────────────────────────────────────────────────

  async create(user: JwtPayload, dto: CreatePosmTypeDto) {
    // F8: an un-assumed GIFSY_ADMIN has no tenant context — refuse tenant-data writes.
    if (platformWide(user)) {
      throw new BadRequestException('Assume a tenant before creating tenant data.');
    }
    const clientId = user.clientId; // writes pin to the caller's tenant
    try {
      const posmType = await this.prisma.posmType.create({
        data: {
          clientId,
          code: dto.code,
          name: dto.name,
          ...(dto.defaultDimensions !== undefined
            ? { defaultDimensions: toJson(dto.defaultDimensions) }
            : {}),
          // Empty string clears the image; a non-empty key sets it.
          ...(dto.imageKey !== undefined ? { imageKey: dto.imageKey || null } : {}),
        },
      });
      await this.audit(user, 'CREATE', posmType.id, undefined, posmType);
      return posmType;
    } catch (e) {
      this.rethrowDuplicate(e, dto.code);
    }
  }

  async update(user: JwtPayload, id: string, dto: UpdatePosmTypeDto) {
    const existing = await this.findScopedOrThrow(user, id);
    try {
      const posmType = await this.prisma.posmType.update({
        where: { id: existing.id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.defaultDimensions !== undefined
            ? { defaultDimensions: toJson(dto.defaultDimensions) }
            : {}),
          // Empty string clears the image; a non-empty key sets it.
          ...(dto.imageKey !== undefined ? { imageKey: dto.imageKey || null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit(user, 'UPDATE', posmType.id, existing, posmType);
      return posmType;
    } catch (e) {
      this.rethrowDuplicate(e, dto.code);
    }
  }

  /** Soft-deactivate (isActive=false). Not a hard delete. */
  async deactivate(user: JwtPayload, id: string) {
    const existing = await this.findScopedOrThrow(user, id);
    const posmType = await this.prisma.posmType.update({
      where: { id: existing.id },
      data: { isActive: false },
    });
    await this.audit(user, 'DELETE', posmType.id, existing, posmType);
    return posmType;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async findScopedOrThrow(user: JwtPayload, id: string) {
    const scope = tenantScope(user);
    const posmType = await this.prisma.posmType.findFirst({
      where: { id, ...(scope ? { clientId: scope } : {}) },
    });
    if (!posmType) throw new NotFoundException('POSM type not found');
    return posmType;
  }

  private rethrowDuplicate(e: unknown, code?: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException(
        `A POSM type with code "${code ?? ''}" already exists for this tenant.`,
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
        entityType: 'POSM_TYPE',
        entityId,
        ...(oldValues !== undefined ? { oldValues: toJson(oldValues) } : {}),
        ...(newValues !== undefined ? { newValues: toJson(newValues) } : {}),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
