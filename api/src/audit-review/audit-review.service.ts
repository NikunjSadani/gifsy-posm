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

/**
 * Single source of truth for the installation audit shape — shared by the queue (findMany) and
 * the scoped single-record GET (findFirst) so the compare payload can never drift.
 */
const INSTALL_INCLUDE = {
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
} satisfies Prisma.InstallationInclude;

type InstallRow = Prisma.InstallationGetPayload<{ include: typeof INSTALL_INCLUDE }>;

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
        include: INSTALL_INCLUDE,
      }),
      this.prisma.installation.count({ where }),
    ]);

    const items = installs.map((inst) => this.mapInstallItem(inst));

    return { items, total, page, limit };
  }

  /**
   * A single installation the caller is authorised to audit, by id — the detail-view read
   * behind the auditor/admin console. Scoped identically to the queue (`installWhere`): a
   * cross-tenant id is not found → 404. Returns an installation in ANY status, so the console
   * can open an already-audited record and one past the queue's page cap (WoW #2: the
   * alternate/scale path the list-scan missed).
   */
  async getInstallation(user: JwtPayload, id: string) {
    const inst = await this.prisma.installation.findFirst({
      where: { ...this.installWhere(user), id },
      include: INSTALL_INCLUDE,
    });
    if (!inst) throw new NotFoundException('Installation not found');
    return this.mapInstallItem(inst);
  }

  /** Map an installation row (INSTALL_INCLUDE) → the per-image compare item shape. */
  private mapInstallItem(inst: InstallRow) {
    return {
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
    };
  }

  // ── State transitions ────────────────────────────────────────────────────────

  /** Installation SUBMITTED → AUDIT_APPROVED. Stamps auditedById + auditedAt. */
  async approve(user: JwtPayload, id: string) {
    const inst = await this.loadForMutation(user, id);
    this.assertSubmitted(inst.status);

    // The state transition AND its append-only audit row must commit together — a settled
    // installation must never exist with no audit row (nor an audit row for a rolled-back write).
    // One $transaction wraps both.
    // A2 (double-pay TOCTOU): the `status: 'SUBMITTED'` predicate in the WRITE closes the window
    // between the load above and this update. Two concurrent audits both pass the pre-read guard,
    // but only the row STILL SUBMITTED transitions; the loser matches 0 rows (Prisma P2025) → 409
    // (thrown inside the tx, rolling it back), so the audit-log APPROVE row is appended only on the
    // winning path.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.installation
        .update({
          where: { id, status: 'SUBMITTED' },
          data: {
            status: 'AUDIT_APPROVED',
            auditedById: user.sub,
            auditedAt: new Date(),
            rejectionReasonCode: null,
            rejectionReason: null,
          },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(tx, user, 'APPROVE', id, { status: inst.status }, { status: 'AUDIT_APPROVED' });
      return updated;
    });
  }

  /** Installation SUBMITTED → AUDIT_REJECTED with a required reason code (+ optional note). */
  async reject(user: JwtPayload, id: string, dto: RejectInstallationDto) {
    const inst = await this.loadForMutation(user, id);
    this.assertSubmitted(inst.status);

    // A2: same status-guarded write as approve, wrapped with its audit row in one $transaction so
    // the state change and the append-only audit row commit atomically. Because only a row STILL
    // SUBMITTED transitions, a concurrent approve (which would have set auditedById +
    // AUDIT_APPROVED) can never co-exist with this rejection — the loser gets a 409 and writes no
    // second audit row.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.installation
        .update({
          where: { id, status: 'SUBMITTED' },
          data: {
            status: 'AUDIT_REJECTED',
            auditedById: user.sub,
            auditedAt: new Date(),
            rejectionReasonCode: dto.reasonCode as RejectReasonCode,
            rejectionReason: dto.reason ?? null,
            // Escalate to HO/Admin: an audit rejection is not terminal — it awaits HO review
            // (owner decision 2026-09-30). HO approve overrides this reject; HO reject upholds it.
            hoReviewStatus: 'PENDING',
          },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(
        tx,
        user,
        'REJECT',
        id,
        { status: inst.status },
        {
          status: 'AUDIT_REJECTED',
          reasonCode: dto.reasonCode,
          reason: dto.reason ?? null,
          hoReviewStatus: 'PENDING',
        },
      );
      return updated;
    });
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

  /**
   * A2: the status-guarded single-item write matched 0 rows — the installation was transitioned
   * by a concurrent request between the load and the write. Prisma surfaces this as P2025; re-map
   * it to a 409 so the loser of the race never appends a duplicate audit row. Any other error
   * propagates unchanged. Returns `never` so callers' definite-assignment analysis holds.
   */
  private conflictOnLostRace(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new ConflictException(
        'Installation was already audited by a concurrent request and can no longer be audited',
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

  /**
   * Append-only audit write (chassis AuditLog pattern). Takes the transaction client so the audit
   * row commits atomically with the state transition that precedes it.
   */
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
        entityType: 'INSTALLATION',
        entityId,
        oldValues: toJson(oldValues),
        newValues: toJson(newValues),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
