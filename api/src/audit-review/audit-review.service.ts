import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RejectReasonCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope } from '../common/tenant-scope';
import { readMediaValue } from '../capture/visibility-types';
import { ListInstallQueueDto } from './dto/list-install-queue.dto';
import { RejectInstallationDto } from './dto/reject-installation.dto';

/** JSON-safe snapshot for AuditLog. */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export interface MediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/**
 * AuditReviewService — the Auditor stage of the pipeline (Wave 2 REVIEW lane).
 *
 * Owns the Installation SUBMITTED → AUDIT_APPROVED / AUDIT_REJECTED transition. Review is
 * PER-IMAGE (the queue carries the recce-vs-install compare payload for each POSM) with NO
 * bulk action — an auditor confirms each install against its recce individually.
 *
 * SCOPING: the Auditor is tenant-wide (pinned to their token's clientId); CLIENT_ADMIN is
 * tenant-wide; an un-assumed GIFSY_ADMIN is platform-wide, an assumed operator is pinned to
 * the assumed tenant. Enforced on every read AND every state transition (a cross-tenant id
 * → 404). An illegal transition (already audited) → 409.
 */
@Injectable()
export class AuditReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** The base `where` on Installation the caller is confined to (tenant scope). */
  private installWhere(user: JwtPayload): Prisma.InstallationWhereInput {
    const where: Prisma.InstallationWhereInput = {};
    const scope = tenantScope(user); // undefined only for an un-assumed GIFSY_ADMIN
    if (scope !== undefined) where.clientId = scope;
    return where;
  }

  // ── Review queue ─────────────────────────────────────────────────────────────

  /**
   * The Auditor queue: SUBMITTED installations, each carrying the per-image compare payload
   * (recce photo + install photo view-paths, POSM type, both geo-locations + distanceFromRecce,
   * beforeAfterDiffOk, qualityFlags). Tenant-scoped.
   */
  async listQueue(user: JwtPayload, q: ListInstallQueueDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.InstallationWhereInput = {
      ...this.installWhere(user),
      status: 'SUBMITTED',
    };
    const siteFilter: Prisma.SiteWhereInput = {};
    if (q.siteCode) siteFilter.code = { contains: q.siteCode, mode: 'insensitive' };
    if (q.town) siteFilter.town = { contains: q.town, mode: 'insensitive' };
    if (Object.keys(siteFilter).length > 0) where.site = siteFilter;

    const [installs, total] = await Promise.all([
      this.prisma.installation.findMany({
        where,
        orderBy: [{ receivedAt: 'asc' }], // FIFO
        skip,
        take: limit,
        include: {
          site: { select: { id: true, code: true, name: true, town: true, lat: true, lng: true } },
          submittedBy: { select: { id: true, name: true } },
          recce: {
            select: {
              id: true,
              captureLat: true,
              captureLng: true,
              captureAccuracy: true,
              geoFenceOk: true,
            },
          },
          posms: {
            include: {
              reccePosm: {
                include: { posmType: { select: { id: true, code: true, name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.installation.count({ where }),
    ]);

    const items = installs.map((inst) => ({
      id: inst.id,
      status: inst.status,
      version: inst.version,
      site: {
        id: inst.site.id,
        code: inst.site.code,
        name: inst.site.name,
        town: inst.site.town,
        lat: this.dec(inst.site.lat),
        lng: this.dec(inst.site.lng),
      },
      submittedBy: inst.submittedBy,
      capturedAt: inst.capturedAt,
      receivedAt: inst.receivedAt,
      recceGeo: {
        lat: this.dec(inst.recce.captureLat),
        lng: this.dec(inst.recce.captureLng),
        accuracy: inst.recce.captureAccuracy,
        geoFenceOk: inst.recce.geoFenceOk,
      },
      // One compare row per installed POSM (the per-image review unit).
      compare: inst.posms.map((p) => ({
        installPosmId: p.id,
        reccePosmId: p.reccePosmId,
        posmType: p.reccePosm.posmType,
        dimensions: p.reccePosm.dimensions,
        reccePhoto: this.mediaRef(p.reccePosm.photo),
        installPhoto: this.mediaRef(p.photo),
        recceMarkup: p.reccePosm.markup ?? null,
        installGeo: {
          lat: this.dec(p.captureLat),
          lng: this.dec(p.captureLng),
        },
        geoFenceOk: p.geoFenceOk,
        distanceFromRecce: this.dec(p.distanceFromRecce),
        beforeAfterDiffOk: p.beforeAfterDiffOk,
        qualityFlags: p.qualityFlags ?? null,
      })),
    }));

    return { items, total, page, limit };
  }

  // ── State transitions ────────────────────────────────────────────────────────

  /** Installation SUBMITTED → AUDIT_APPROVED. Stamps auditedById + auditedAt. */
  async approve(user: JwtPayload, id: string) {
    const inst = await this.loadForMutation(user, id);
    this.assertSubmitted(inst.status);

    const updated = await this.prisma.installation.update({
      where: { id },
      data: {
        status: 'AUDIT_APPROVED',
        auditedById: user.sub,
        auditedAt: new Date(),
        rejectionReasonCode: null,
        rejectionReason: null,
      },
    });

    await this.audit(user, 'APPROVE', id, { status: inst.status }, { status: 'AUDIT_APPROVED' });
    return updated;
  }

  /** Installation SUBMITTED → AUDIT_REJECTED with a required reason code (+ optional note). */
  async reject(user: JwtPayload, id: string, dto: RejectInstallationDto) {
    const inst = await this.loadForMutation(user, id);
    this.assertSubmitted(inst.status);

    const updated = await this.prisma.installation.update({
      where: { id },
      data: {
        status: 'AUDIT_REJECTED',
        auditedById: user.sub,
        auditedAt: new Date(),
        rejectionReasonCode: dto.reasonCode as RejectReasonCode,
        rejectionReason: dto.reason ?? null,
      },
    });

    await this.audit(
      user,
      'REJECT',
      id,
      { status: inst.status },
      { status: 'AUDIT_REJECTED', reasonCode: dto.reasonCode, reason: dto.reason ?? null },
    );
    return updated;
  }

  // ── Internals ──────────────────────────────────────────────────────────────────

  /** Load an installation for a transition, tenant-scoped (cross-tenant / missing → 404). */
  private async loadForMutation(user: JwtPayload, id: string) {
    const scope = tenantScope(user);
    const inst = await this.prisma.installation.findFirst({
      where: { id, ...(scope !== undefined ? { clientId: scope } : {}) },
      select: { id: true, status: true },
    });
    if (!inst) throw new NotFoundException('Installation not found');
    return inst;
  }

  /** Only a SUBMITTED installation may be audited. */
  private assertSubmitted(status: string) {
    if (status !== 'SUBMITTED') {
      throw new ConflictException(`Installation is already ${status} and can no longer be audited`);
    }
  }

  private mediaRef(photo: unknown): MediaRef | null {
    const { key, geo } = readMediaValue(photo);
    if (!key) return null;
    return {
      key,
      viewPath: `/v1/media/view?key=${encodeURIComponent(key)}`,
      geo: geo ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : null,
    };
  }

  private dec(v: Prisma.Decimal | null): number | null {
    return v != null ? Number(v) : null;
  }

  private audit(
    user: JwtPayload,
    action: 'APPROVE' | 'REJECT',
    entityId: string,
    oldValues: unknown,
    newValues: unknown,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorId: user.sub,
        action,
        entityType: 'INSTALLATION',
        entityId,
        oldValues: toJson(oldValues),
        newValues: toJson(newValues),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
