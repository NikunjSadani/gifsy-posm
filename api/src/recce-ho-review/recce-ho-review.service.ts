import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RejectReasonCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope } from '../common/tenant-scope';
import { readMediaValue } from '../capture/visibility-types';
import { ListRecceHoQueueDto } from './dto/list-recce-ho-queue.dto';
import { RecceHoRejectDto } from './dto/recce-ho-reject.dto';

/** JSON-safe snapshot for AuditLog. */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/**
 * The recce-HO review shape — the recce's site, submitter, the POSM lines + photo view-paths (so
 * the HO console can render what the ASM approved) PLUS the current HO decision state. Mirrors the
 * ASM review include (ApprovalService.RECCE_INCLUDE) with the HO reviewer relation added.
 */
const RECCE_HO_INCLUDE = {
  site: { select: { id: true, code: true, name: true, town: true, lat: true, lng: true } },
  submittedBy: { select: { id: true, name: true } },
  hoReviewedBy: { select: { id: true, name: true } },
  posms: {
    orderBy: { slotNo: 'asc' },
    include: { posmType: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.RecceInclude;

type RecceHoRow = Prisma.RecceGetPayload<{ include: typeof RECCE_HO_INCLUDE }>;

export interface MediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/**
 * RecceHoReviewService — the HO/Admin approval stage of the RECCE, inserted between ASM approval
 * and installation.
 *
 * When the ASM APPROVES a recce it no longer unlocks install: the row is stamped
 * `hoReviewStatus = PENDING` (status stays APPROVED) and lands in this queue. HO/Admin then makes
 * a TERMINAL call:
 *   - approve → hoReviewStatus = APPROVED (status stays APPROVED). THIS is what now unlocks
 *     installation for the site (InstallationService requires both APPROVED + HO-APPROVED).
 *   - reject  → hoReviewStatus = REJECTED AND status = REJECTED (the recce returns to the field
 *     for re-capture via resubmit, which clears the HO fields back to NONE).
 *
 * SCOPING mirrors the install-side HO console (HoReviewService): CLIENT_ADMIN is tenant-wide; an
 * un-assumed GIFSY_ADMIN is platform-wide, an assumed operator is pinned to the assumed tenant.
 * Enforced on every read AND every transition (a cross-tenant id → 404). A row no longer PENDING →
 * 409 (idempotent guard, race-safe via the status-guarded write).
 */
@Injectable()
export class RecceHoReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant confinement for the caller (undefined only for an un-assumed GIFSY_ADMIN). */
  private recceWhere(user: JwtPayload): Prisma.RecceWhereInput {
    const where: Prisma.RecceWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    return where;
  }

  // ── Queue ──────────────────────────────────────────────────────────────────────

  /**
   * The recce-HO queue: recces the ASM approved that still await HO review (status APPROVED AND
   * hoReviewStatus PENDING). Tenant-scoped, FIFO by `reviewedAt` (the ASM-approval time).
   */
  async listQueue(user: JwtPayload, q: ListRecceHoQueueDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.RecceWhereInput = {
      ...this.recceWhere(user),
      status: 'APPROVED',
      hoReviewStatus: 'PENDING',
    };
    const siteFilter: Prisma.SiteWhereInput = {};
    if (q.siteCode) siteFilter.code = { contains: q.siteCode, mode: 'insensitive' };
    if (q.town) siteFilter.town = { contains: q.town, mode: 'insensitive' };
    if (Object.keys(siteFilter).length > 0) where.site = siteFilter;

    const [recces, total] = await Promise.all([
      this.prisma.recce.findMany({
        where,
        orderBy: [{ reviewedAt: 'asc' }],
        skip,
        take: limit,
        include: RECCE_HO_INCLUDE,
      }),
      this.prisma.recce.count({ where }),
    ]);

    const dupRecceIds = await this.computeDuplicateRecceIds(recces);
    return { items: recces.map((r) => this.mapItem(r, dupRecceIds)), total, page, limit };
  }

  /**
   * One recce the caller may review, by id (ANY hoReviewStatus so the console can open an
   * already-decided recce and one past the queue's page cap). Cross-tenant id → 404.
   */
  async getRecce(user: JwtPayload, id: string) {
    const recce = await this.prisma.recce.findFirst({
      where: { ...this.recceWhere(user), id },
      include: RECCE_HO_INCLUDE,
    });
    if (!recce) throw new NotFoundException('Recce not found');
    const dupRecceIds = await this.computeDuplicateRecceIds([recce]);
    return this.mapItem(recce, dupRecceIds);
  }

  private mapItem(r: RecceHoRow, dupRecceIds: Set<string>) {
    return {
      id: r.id,
      status: r.status,
      hoReviewStatus: r.hoReviewStatus,
      version: r.version,
      site: {
        id: r.site.id,
        code: r.site.code,
        name: r.site.name,
        town: r.site.town,
        lat: this.dec(r.site.lat),
        lng: this.dec(r.site.lng),
      },
      submittedBy: r.submittedBy,
      hoReviewedBy: r.hoReviewedBy,
      capturedAt: r.capturedAt,
      receivedAt: r.receivedAt,
      reviewedAt: r.reviewedAt,
      hoReviewedAt: r.hoReviewedAt,
      hoRejectionReasonCode: r.hoRejectionReasonCode,
      hoRejectionReason: r.hoRejectionReason,
      // Integrity signals available at the recce stage (mirrors the ASM review item) — the HO
      // approver is a fraud gate, so the reused-photo signal MUST surface here exactly as it does
      // on the ASM console (otherwise a duplicate photo slips past the final reviewer).
      integrity: {
        geoFenceOk: r.geoFenceOk,
        distanceMeters: this.dec(r.distanceMeters),
        captureAccuracy: r.captureAccuracy,
        captureLat: this.dec(r.captureLat),
        captureLng: this.dec(r.captureLng),
        // Cross-submission duplicate-photo flag (reuses the shared ImageHash infra).
        duplicatePhoto: dupRecceIds.has(r.id),
      },
      posms: r.posms.map((p) => ({
        id: p.id,
        slotNo: p.slotNo,
        posmType: p.posmType,
        dimensions: p.dimensions,
        photo: this.mediaRef(p.photo),
        markup: p.markup ?? null,
        qualityFlags: p.qualityFlags ?? null,
      })),
    };
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  /** HO approve: hoReviewStatus PENDING → APPROVED (status stays APPROVED; unlocks install). */
  async approve(user: JwtPayload, id: string) {
    const recce = await this.loadForMutation(user, id);
    this.assertPending(recce.hoReviewStatus);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.recce
        .update({
          // The `hoReviewStatus: 'PENDING'` predicate closes the load→write window: two concurrent
          // HO decisions both pass the pre-read, but only the row STILL PENDING transitions; the
          // loser matches 0 rows (P2025) → 409, so no second audit row is appended.
          where: { id, hoReviewStatus: 'PENDING' },
          data: {
            hoReviewStatus: 'APPROVED',
            hoReviewedById: user.sub,
            hoReviewedAt: new Date(),
            hoRejectionReasonCode: null,
            hoRejectionReason: null,
          },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(
        tx,
        user,
        'APPROVE',
        id,
        { hoReviewStatus: recce.hoReviewStatus },
        { hoReviewStatus: 'APPROVED' },
      );
      return updated;
    });
  }

  /** HO reject: hoReviewStatus PENDING → REJECTED AND status → REJECTED (back to the field). */
  async reject(user: JwtPayload, id: string, dto: RecceHoRejectDto) {
    const recce = await this.loadForMutation(user, id);
    this.assertPending(recce.hoReviewStatus);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.recce
        .update({
          where: { id, hoReviewStatus: 'PENDING' },
          data: {
            hoReviewStatus: 'REJECTED',
            status: 'REJECTED',
            hoReviewedById: user.sub,
            hoReviewedAt: new Date(),
            hoRejectionReasonCode: dto.reasonCode as RejectReasonCode,
            hoRejectionReason: dto.reason ?? null,
          },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(
        tx,
        user,
        'REJECT',
        id,
        { hoReviewStatus: recce.hoReviewStatus, status: recce.status },
        { hoReviewStatus: 'REJECTED', status: 'REJECTED', reasonCode: dto.reasonCode, reason: dto.reason ?? null },
      );
      return updated;
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Load a recce for a transition, tenant-scoped (cross-tenant / missing → 404). */
  private async loadForMutation(user: JwtPayload, id: string) {
    const scope = tenantScope(user);
    const recce = await this.prisma.recce.findFirst({
      where: { id, ...(scope !== undefined ? { clientId: scope } : {}) },
      select: { id: true, status: true, hoReviewStatus: true },
    });
    if (!recce) throw new NotFoundException('Recce not found');
    return recce;
  }

  /** Only a recce currently escalated to HO (PENDING) may be decided here. */
  private assertPending(hoReviewStatus: string) {
    if (hoReviewStatus !== 'PENDING') {
      throw new ConflictException(
        `This recce is not awaiting HO review (HO status: ${hoReviewStatus}).`,
      );
    }
  }

  private conflictOnLostRace(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new ConflictException(
        'This recce was already decided by a concurrent HO review.',
      );
    }
    throw e;
  }

  /**
   * Cross-submission duplicate-photo detection for the recces on this page (mirrors
   * ApprovalService.computeDuplicateRecceIds so the ASM and HO consoles raise the SAME signal).
   * Reuses the shared ImageHash store written by the capture lane (ownerKind "RECCE"): a recce is
   * flagged when any of its photo hashes also appears under a DIFFERENT owner in the same tenant.
   * Bounded to this page (never a tenant-wide scan).
   */
  private async computeDuplicateRecceIds(
    recces: { id: string; clientId: string }[],
  ): Promise<Set<string>> {
    const dup = new Set<string>();
    if (recces.length === 0) return dup;
    const recceIds = recces.map((r) => r.id);
    const clientIds = [...new Set(recces.map((r) => r.clientId))];

    const mine = await this.prisma.imageHash.findMany({
      where: { clientId: { in: clientIds }, ownerKind: 'RECCE', ownerId: { in: recceIds } },
      select: { ownerId: true, hash: true },
    });
    if (mine.length === 0) return dup;

    const hashes = [...new Set(mine.map((m) => m.hash))];
    const occ = await this.prisma.imageHash.findMany({
      where: { clientId: { in: clientIds }, hash: { in: hashes } },
      select: { ownerKind: true, ownerId: true, hash: true },
    });
    const byHash = new Map<string, { ownerKind: string; ownerId: string }[]>();
    for (const o of occ) {
      const arr = byHash.get(o.hash) ?? [];
      arr.push({ ownerKind: o.ownerKind, ownerId: o.ownerId });
      byHash.set(o.hash, arr);
    }
    for (const m of mine) {
      const owners = byHash.get(m.hash) ?? [];
      if (owners.some((ow) => !(ow.ownerKind === 'RECCE' && ow.ownerId === m.ownerId))) {
        dup.add(m.ownerId);
      }
    }
    return dup;
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
        entityType: 'RECCE_HO_REVIEW',
        entityId,
        oldValues: toJson(oldValues),
        newValues: toJson(newValues),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
