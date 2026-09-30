import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope } from '../common/tenant-scope';
import { readMediaValue } from '../capture/visibility-types';
import { ListHoQueueDto } from './dto/list-ho-queue.dto';
import { HoRejectDto } from './dto/ho-reject.dto';

/** JSON-safe snapshot for AuditLog. */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/**
 * The HO review shape — the auditor's before/after compare PLUS the auditor's rejection reason
 * (so HO understands WHY it was rejected) and the current HO decision state.
 */
const HO_INCLUDE = {
  site: { select: { id: true, code: true, name: true, town: true, lat: true, lng: true } },
  submittedBy: { select: { id: true, name: true } },
  auditedBy: { select: { id: true, name: true } },
  hoReviewedBy: { select: { id: true, name: true } },
  recce: {
    select: { id: true, captureLat: true, captureLng: true, captureAccuracy: true, geoFenceOk: true },
  },
  posms: {
    include: {
      reccePosm: { include: { posmType: { select: { id: true, code: true, name: true } } } },
    },
  },
} satisfies Prisma.InstallationInclude;

type HoRow = Prisma.InstallationGetPayload<{ include: typeof HO_INCLUDE }>;

export interface MediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/**
 * HoReviewService — the HO/Admin escalation stage (owner decision 2026-09-30).
 *
 * When the Auditor REJECTS an installation it does not close: the row is stamped
 * `hoReviewStatus = PENDING` and lands in this queue. HO/Admin then makes a TERMINAL call:
 *   - approve → hoReviewStatus = APPROVED (overrides the audit reject; the installation is
 *     effectively accepted). The auditor's `AUDIT_REJECTED` status is left intact so the audit
 *     trail — and the report's "Audit Status" column — stays truthful; "HO Approval Status"
 *     carries the override.
 *   - reject  → hoReviewStatus = REJECTED (HO upholds the auditor; terminal rejection).
 *
 * SCOPING mirrors the auditor console: CLIENT_ADMIN is tenant-wide; an un-assumed GIFSY_ADMIN is
 * platform-wide, an assumed operator is pinned to the assumed tenant. Enforced on every read AND
 * every transition (a cross-tenant id → 404). A row no longer PENDING → 409 (idempotent guard).
 */
@Injectable()
export class HoReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant confinement for the caller (undefined only for an un-assumed GIFSY_ADMIN). */
  private installWhere(user: JwtPayload): Prisma.InstallationWhereInput {
    const where: Prisma.InstallationWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    return where;
  }

  // ── Queue ──────────────────────────────────────────────────────────────────────

  /**
   * The HO escalation queue: installations the auditor rejected that still await HO review
   * (status AUDIT_REJECTED AND hoReviewStatus PENDING). Tenant-scoped, FIFO by audit time.
   */
  async listQueue(user: JwtPayload, q: ListHoQueueDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.InstallationWhereInput = {
      ...this.installWhere(user),
      status: 'AUDIT_REJECTED',
      hoReviewStatus: 'PENDING',
    };
    const siteFilter: Prisma.SiteWhereInput = {};
    if (q.siteCode) siteFilter.code = { contains: q.siteCode, mode: 'insensitive' };
    if (q.town) siteFilter.town = { contains: q.town, mode: 'insensitive' };
    if (Object.keys(siteFilter).length > 0) where.site = siteFilter;

    const [installs, total] = await Promise.all([
      this.prisma.installation.findMany({
        where,
        orderBy: [{ auditedAt: 'asc' }],
        skip,
        take: limit,
        include: HO_INCLUDE,
      }),
      this.prisma.installation.count({ where }),
    ]);

    return { items: installs.map((i) => this.mapItem(i)), total, page, limit };
  }

  /**
   * One installation the caller may review, by id (any hoReviewStatus so the console can open an
   * already-decided record and one past the queue's page cap). Cross-tenant id → 404.
   */
  async getInstallation(user: JwtPayload, id: string) {
    const inst = await this.prisma.installation.findFirst({
      where: { ...this.installWhere(user), id },
      include: HO_INCLUDE,
    });
    if (!inst) throw new NotFoundException('Installation not found');
    return this.mapItem(inst);
  }

  private mapItem(inst: HoRow) {
    return {
      id: inst.id,
      status: inst.status,
      hoReviewStatus: inst.hoReviewStatus,
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
      auditedBy: inst.auditedBy,
      hoReviewedBy: inst.hoReviewedBy,
      capturedAt: inst.capturedAt,
      receivedAt: inst.receivedAt,
      auditedAt: inst.auditedAt,
      hoReviewedAt: inst.hoReviewedAt,
      // The auditor's controlled reason + note — WHY this escalated.
      auditRejection: {
        reasonCode: inst.rejectionReasonCode,
        reason: inst.rejectionReason,
      },
      hoRejectionReason: inst.hoRejectionReason,
      recceGeo: {
        lat: this.dec(inst.recce.captureLat),
        lng: this.dec(inst.recce.captureLng),
        accuracy: inst.recce.captureAccuracy,
        geoFenceOk: inst.recce.geoFenceOk,
      },
      compare: inst.posms.map((p) => ({
        installPosmId: p.id,
        reccePosmId: p.reccePosmId,
        posmType: p.reccePosm.posmType,
        dimensions: p.reccePosm.dimensions,
        reccePhoto: this.mediaRef(p.reccePosm.photo),
        installPhoto: this.mediaRef(p.photo),
        recceMarkup: p.reccePosm.markup ?? null,
        installGeo: { lat: this.dec(p.captureLat), lng: this.dec(p.captureLng) },
        geoFenceOk: p.geoFenceOk,
        distanceFromRecce: this.dec(p.distanceFromRecce),
        beforeAfterDiffOk: p.beforeAfterDiffOk,
        qualityFlags: p.qualityFlags ?? null,
      })),
    };
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  /** HO approve: hoReviewStatus PENDING → APPROVED (overrides the audit reject). */
  async approve(user: JwtPayload, id: string) {
    const inst = await this.loadForMutation(user, id);
    this.assertPending(inst.hoReviewStatus);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.installation
        .update({
          // The `hoReviewStatus: 'PENDING'` predicate closes the load→write window: two concurrent
          // HO decisions both pass the pre-read, but only the row STILL PENDING transitions; the
          // loser matches 0 rows (P2025) → 409, so no second audit row is appended.
          where: { id, hoReviewStatus: 'PENDING' },
          data: { hoReviewStatus: 'APPROVED', hoReviewedById: user.sub, hoReviewedAt: new Date(), hoRejectionReason: null },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(tx, user, 'APPROVE', id, { hoReviewStatus: inst.hoReviewStatus }, { hoReviewStatus: 'APPROVED' });
      return updated;
    });
  }

  /** HO reject: hoReviewStatus PENDING → REJECTED (upholds the auditor; terminal). */
  async reject(user: JwtPayload, id: string, dto: HoRejectDto) {
    const inst = await this.loadForMutation(user, id);
    this.assertPending(inst.hoReviewStatus);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.installation
        .update({
          where: { id, hoReviewStatus: 'PENDING' },
          data: { hoReviewStatus: 'REJECTED', hoReviewedById: user.sub, hoReviewedAt: new Date(), hoRejectionReason: dto.reason ?? null },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(
        tx,
        user,
        'REJECT',
        id,
        { hoReviewStatus: inst.hoReviewStatus },
        { hoReviewStatus: 'REJECTED', reason: dto.reason ?? null },
      );
      return updated;
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Load an installation for a transition, tenant-scoped (cross-tenant / missing → 404). */
  private async loadForMutation(user: JwtPayload, id: string) {
    const scope = tenantScope(user);
    const inst = await this.prisma.installation.findFirst({
      where: { id, ...(scope !== undefined ? { clientId: scope } : {}) },
      select: { id: true, status: true, hoReviewStatus: true },
    });
    if (!inst) throw new NotFoundException('Installation not found');
    return inst;
  }

  /** Only an installation currently escalated to HO (PENDING) may be decided here. */
  private assertPending(hoReviewStatus: string) {
    if (hoReviewStatus !== 'PENDING') {
      throw new ConflictException(
        `This installation is not awaiting HO review (HO status: ${hoReviewStatus}).`,
      );
    }
  }

  private conflictOnLostRace(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new ConflictException(
        'This installation was already decided by a concurrent HO review.',
      );
    }
    throw e;
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
    client: Prisma.TransactionClient,
    user: JwtPayload,
    action: 'APPROVE' | 'REJECT',
    entityId: string,
    oldValues: unknown,
    newValues: unknown,
  ) {
    return client.auditLog.create({
      data: {
        actorId: user.sub,
        action,
        entityType: 'INSTALLATION_HO_REVIEW',
        entityId,
        oldValues: toJson(oldValues),
        newValues: toJson(newValues),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
