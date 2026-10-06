import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RejectReasonCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope } from '../common/tenant-scope';
import { readMediaValue } from '../capture/visibility-types';
import { ListRecceQueueDto } from './dto/list-recce-queue.dto';
import { RejectRecceDto } from './dto/reject-recce.dto';
import { BulkApproveDto } from './dto/bulk-approve.dto';

/** JSON-safe snapshot for AuditLog (Dates → ISO; strips undefined). */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/**
 * The single source of truth for the recce review shape — shared by the queue (findMany) and
 * the scoped single-record GET (findFirst) so the two can never drift.
 */
const RECCE_INCLUDE = {
  site: { select: { id: true, code: true, name: true, town: true, lat: true, lng: true } },
  submittedBy: { select: { id: true, name: true } },
  posms: {
    orderBy: { slotNo: 'asc' },
    // `include` (for the posmType relation) auto-selects every ReccePosm SCALAR — so the nullable
    // `qualityFlags Json?` column rides along here without an explicit select (a scalar `true`
    // cannot be added inside a Prisma relation `include`). It is surfaced per-POSM in mapRecceItem.
    include: { posmType: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.RecceInclude;

type RecceRow = Prisma.RecceGetPayload<{ include: typeof RECCE_INCLUDE }>;

/** A media reference the ASM UI can render: the raw object key + a relative view-path. */
export interface MediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/**
 * Advisory per-POSM photo-quality signals computed at recce submit (mirrors the auditor's
 * InstallPosm flags). Purely informational for the ASM — they never block approve/reject.
 * Older recces predate the column, so the mapped value is `null` when nothing was stored.
 */
export interface ReccePosmQualityFlags {
  blur: boolean;
  blank: boolean;
  lowLight: boolean;
  overexposed: boolean;
  lowAccuracy: boolean;
}

/**
 * ApprovalService — the ASM approval stage of the pipeline (Wave 2 REVIEW lane).
 *
 * Owns the Recce SUBMITTED → APPROVED / REJECTED transition. ASM approval no longer unlocks
 * installation directly — it stamps `hoReviewStatus = PENDING`, handing the recce to the HO
 * review stage (RecceHoReviewService); only HO approval unlocks installation for a site.
 *
 * SCOPING (the security concern) is centralised so it holds on EVERY read AND every
 * state-transition:
 *   - ASM          → only recces whose SITE is theirs (`site.asmUserId = user.sub`).
 *   - CLIENT_ADMIN → tenant-wide (`tenantScope`).
 *   - GIFSY_ADMIN  → platform-wide when un-assumed, else the assumed tenant.
 * A vendor role never reaches here (the controller's @Roles floor excludes it).
 *
 * The list simply omits out-of-scope rows. A MUTATION distinguishes the two failure modes:
 * a recce that does not exist (or lives in another tenant) → 404; a recce that exists in the
 * tenant but whose site is NOT the ASM's → 403 (never a silent approve of a foreign site).
 * An illegal transition (already APPROVED / REJECTED) → 409.
 */
@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Scoping helpers ──────────────────────────────────────────────────────────

  /** The base `where` on Recce the caller is confined to. */
  private recceWhere(user: JwtPayload): Prisma.RecceWhereInput {
    const where: Prisma.RecceWhereInput = {};
    const scope = tenantScope(user); // undefined only for an un-assumed GIFSY_ADMIN
    if (scope !== undefined) where.clientId = scope;
    if (user.role === 'ASM') where.site = { asmUserId: user.sub };
    return where;
  }

  /** The base `where` on Site the caller is confined to (for the waterfall universe count). */
  private siteWhere(user: JwtPayload): Prisma.SiteWhereInput {
    const where: Prisma.SiteWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    if (user.role === 'ASM') where.asmUserId = user.sub;
    return where;
  }

  /** The base `where` on Installation the caller is confined to (waterfall). */
  private installWhere(user: JwtPayload): Prisma.InstallationWhereInput {
    const where: Prisma.InstallationWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;
    if (user.role === 'ASM') where.site = { asmUserId: user.sub };
    return where;
  }

  // ── Review queue ─────────────────────────────────────────────────────────────

  /**
   * The ASM review queue: SUBMITTED recces the caller may act on, each carrying the POSM
   * lines, media view-paths, geo/quality/duplicate signals so the ASM can decide.
   */
  async listQueue(user: JwtPayload, q: ListRecceQueueDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.RecceWhereInput = { ...this.recceWhere(user), status: 'SUBMITTED' };
    // Site filters ride the site relation so an ASM's `site` scope is never overwritten
    // (we merge into it rather than replacing it).
    const siteFilter: Prisma.SiteWhereInput = {};
    if (q.siteCode) siteFilter.code = { contains: q.siteCode, mode: 'insensitive' };
    if (q.town) siteFilter.town = { contains: q.town, mode: 'insensitive' };
    if (Object.keys(siteFilter).length > 0) {
      where.site = { ...(where.site as Prisma.SiteWhereInput | undefined), ...siteFilter };
    }

    const [recces, total] = await Promise.all([
      this.prisma.recce.findMany({
        where,
        orderBy: [{ receivedAt: 'asc' }], // oldest-first: FIFO review queue
        skip,
        take: limit,
        include: RECCE_INCLUDE,
      }),
      this.prisma.recce.count({ where }),
    ]);

    const dupRecceIds = await this.computeDuplicateRecceIds(recces);
    const items = recces.map((r) => this.mapRecceItem(r, dupRecceIds));

    return { items, total, page, limit };
  }

  /**
   * A single recce the caller is authorised to review, by id — the detail-view read behind the
   * ASM/admin console. Scoped identically to the queue (`recceWhere`): a recce out of the
   * caller's tenant, or (for an ASM) not in their territory, is not found → 404. Unlike the
   * queue this returns a recce in ANY status, so the console can open an already-reviewed recce
   * and one past the queue's page cap (WoW #2: the alternate/scale path the list-scan missed).
   */
  async getRecce(user: JwtPayload, id: string) {
    const recce = await this.prisma.recce.findFirst({
      where: { ...this.recceWhere(user), id },
      include: RECCE_INCLUDE,
    });
    if (!recce) throw new NotFoundException('Recce not found');
    const dupRecceIds = await this.computeDuplicateRecceIds([recce]);
    return this.mapRecceItem(recce, dupRecceIds);
  }

  /** Map a recce row (RECCE_INCLUDE) + the batch's duplicate set → the review item shape. */
  private mapRecceItem(r: RecceRow, dupRecceIds: Set<string>) {
    return {
      id: r.id,
      status: r.status,
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
      capturedAt: r.capturedAt,
      receivedAt: r.receivedAt,
      // Integrity signals available at the recce stage.
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
        // Advisory per-POSM photo-quality flags (blur/dark/too-bright/weak-GPS); `null` for
        // older recces submitted before the column existed.
        qualityFlags: this.qualityFlags(p.qualityFlags),
      })),
    };
  }

  // ── State transitions ────────────────────────────────────────────────────────

  /** Recce SUBMITTED → APPROVED. Stamps approvedById + reviewedAt + hoReviewStatus PENDING (→ HO review). */
  async approve(user: JwtPayload, id: string) {
    const recce = await this.loadForMutation(user, id);
    this.assertSubmitted(recce.status);

    // The state transition AND its append-only audit row must commit together: a settled record
    // must never exist with no audit row (nor an audit row for a write that rolled back). One
    // $transaction wraps both (mirrors bulkApprove).
    // A2 (double-pay TOCTOU): the `status: 'SUBMITTED'` predicate in the WRITE closes the window
    // between the load above and this update. Two concurrent approves both pass the pre-read guard,
    // but only the row STILL SUBMITTED transitions; the loser matches 0 rows (Prisma P2025) → 409
    // (thrown inside the tx, rolling it back), so the audit-log APPROVE row is appended only on the
    // winning path.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.recce
        .update({
          where: { id, status: 'SUBMITTED' },
          data: {
            status: 'APPROVED',
            approvedById: user.sub,
            reviewedAt: new Date(),
            // ASM approve no longer unlocks installation — it hands the recce to the HO review
            // stage (RecceHoReviewService). The recce enters HO review as PENDING.
            hoReviewStatus: 'PENDING',
            // A prior rejection's reason is cleared on a subsequent approval.
            rejectionReasonCode: null,
            rejectionReason: null,
          },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(
        tx,
        user,
        'APPROVE',
        id,
        { status: recce.status },
        { status: 'APPROVED', hoReviewStatus: 'PENDING' },
      );
      return updated;
    });
  }

  /** Recce SUBMITTED → REJECTED with a required reason code (+ optional note). */
  async reject(user: JwtPayload, id: string, dto: RejectRecceDto) {
    const recce = await this.loadForMutation(user, id);
    this.assertSubmitted(recce.status);

    // A2: same status-guarded write as approve, wrapped with its audit row in one $transaction so
    // the state change and the append-only audit row commit atomically. Because only a row STILL
    // SUBMITTED transitions, a concurrent approve (which would have set approvedById) can never
    // co-exist with this rejection — the loser gets a 409 and writes no second audit row.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.recce
        .update({
          where: { id, status: 'SUBMITTED' },
          data: {
            status: 'REJECTED',
            reviewedAt: new Date(),
            rejectionReasonCode: dto.reasonCode as RejectReasonCode,
            rejectionReason: dto.reason ?? null,
          },
        })
        .catch((e) => this.conflictOnLostRace(e));

      await this.audit(
        tx,
        user,
        'REJECT',
        id,
        { status: recce.status },
        { status: 'REJECTED', reasonCode: dto.reasonCode, reason: dto.reason ?? null },
      );
      return updated;
    });
  }

  /**
   * Approve many recces by id. Scoped like every other path: a recce that is not found /
   * out of tenant, not the ASM's site, or not SUBMITTED is SKIPPED (never approved) with a
   * reason — the batch never approves a recce outside the ASM's territory. Bulk is
   * approve-only (rejection is individual — it needs a per-recce reason code).
   */
  async bulkApprove(user: JwtPayload, dto: BulkApproveDto) {
    const ids = [...new Set(dto.ids)];
    const scope = tenantScope(user);
    const recces = await this.prisma.recce.findMany({
      where: { id: { in: ids }, ...(scope !== undefined ? { clientId: scope } : {}) },
      include: { site: { select: { asmUserId: true } } },
    });
    const found = new Map(recces.map((r) => [r.id, r]));

    // Candidates = ids that passed scope + were SUBMITTED at read time. The guarded write below
    // decides which of these ACTUALLY transition (a race may have flipped some in between).
    const candidateIds: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const r = found.get(id);
      if (!r) {
        skipped.push({ id, reason: 'NOT_FOUND' });
        continue;
      }
      if (user.role === 'ASM' && r.site.asmUserId !== user.sub) {
        skipped.push({ id, reason: 'FORBIDDEN' });
        continue;
      }
      if (r.status !== 'SUBMITTED') {
        skipped.push({ id, reason: `INVALID_STATUS_${r.status}` });
        continue;
      }
      candidateIds.push(id);
    }

    let approvedIds: string[] = [];
    if (candidateIds.length > 0) {
      const now = new Date();
      // A3: the count AND the audit rows must reflect only the ids THIS call actually
      // transitioned, not the pre-read candidate list. The guarded `updateMany` may skip ids a
      // concurrent request already flipped; we re-select by this call's unique approver+timestamp
      // stamp to learn the real transitioned set, then audit exactly those — never claim-approve
      // (or audit) an id the write skipped.
      approvedIds = await this.prisma.$transaction(async (tx) => {
        await tx.recce.updateMany({
          where: { id: { in: candidateIds }, status: 'SUBMITTED' },
          // Bulk approve mirrors the single-item approve: APPROVED + stamp AND hand to the HO
          // review stage (hoReviewStatus PENDING). ASM approve no longer unlocks installation.
          data: { status: 'APPROVED', approvedById: user.sub, reviewedAt: now, hoReviewStatus: 'PENDING' },
        });
        const transitioned = await tx.recce.findMany({
          where: {
            id: { in: candidateIds },
            status: 'APPROVED',
            approvedById: user.sub,
            reviewedAt: now,
          },
          select: { id: true },
        });
        const transitionedIds = transitioned.map((r) => r.id);
        if (transitionedIds.length > 0) {
          await tx.auditLog.createMany({
            data: transitionedIds.map((id) => ({
              actorId: user.sub,
              action: 'APPROVE' as const,
              entityType: 'RECCE',
              entityId: id,
              metadata: {
                clientId: user.clientId,
                event: 'BULK_APPROVE',
              } as Prisma.InputJsonValue,
            })),
          });
        }
        return transitionedIds;
      });

      // A candidate the guarded write skipped (a concurrent request beat us to it) is reported as
      // skipped — it is never counted or audited as approved by this call.
      const approvedSet = new Set(approvedIds);
      for (const id of candidateIds) {
        if (!approvedSet.has(id)) skipped.push({ id, reason: 'INVALID_STATUS_RACE' });
      }
    }

    return { approvedCount: approvedIds.length, approvedIds, skipped };
  }

  // ── Waterfall (dashboard funnel) ───────────────────────────────────────────────

  /**
   * The stage-funnel counts, scoped to the caller: total sites (universe) / recced /
   * approved / installed / audited. An ASM sees only their territory; CLIENT_ADMIN their
   * tenant; an un-assumed GIFSY_ADMIN the whole platform.
   */
  async waterfall(user: JwtPayload) {
    const siteWhere = this.siteWhere(user);
    const recceWhere = this.recceWhere(user);
    const installWhere = this.installWhere(user);

    const [totalSites, recced, approved, installed, audited] = await Promise.all([
      this.prisma.site.count({ where: siteWhere }),
      this.prisma.recce.count({ where: recceWhere }),
      this.prisma.recce.count({ where: { ...recceWhere, status: 'APPROVED' } }),
      this.prisma.installation.count({ where: installWhere }),
      this.prisma.installation.count({ where: { ...installWhere, status: 'AUDIT_APPROVED' } }),
    ]);

    return { totalSites, recced, approved, installed, audited };
  }

  // ── Internals ──────────────────────────────────────────────────────────────────

  /**
   * Load a recce for a state transition, enforcing scope with the correct failure mode:
   * out-of-tenant / missing → 404; in-tenant but not the ASM's site → 403. This re-checks
   * scope on the MUTATION (not just the list), so an ASM can never approve a foreign site.
   */
  private async loadForMutation(user: JwtPayload, id: string) {
    const scope = tenantScope(user);
    const recce = await this.prisma.recce.findFirst({
      where: { id, ...(scope !== undefined ? { clientId: scope } : {}) },
      include: { site: { select: { asmUserId: true } } },
    });
    if (!recce) throw new NotFoundException('Recce not found');
    if (user.role === 'ASM' && recce.site.asmUserId !== user.sub) {
      throw new ForbiddenException('This recce is not in your territory');
    }
    return recce;
  }

  /** Guard illegal transitions: only a SUBMITTED recce may be approved/rejected. */
  private assertSubmitted(status: string) {
    if (status !== 'SUBMITTED') {
      throw new ConflictException(`Recce is already ${status} and can no longer be reviewed`);
    }
  }

  /**
   * A2: the status-guarded single-item write matched 0 rows — the recce was transitioned by a
   * concurrent request between the load and the write. Prisma surfaces this as P2025; re-map it
   * to a 409 so the loser of the race never appends a duplicate audit row. Any other error
   * propagates unchanged. Returns `never` so callers' definite-assignment analysis holds.
   */
  private conflictOnLostRace(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new ConflictException(
        'Recce was already reviewed by a concurrent request and can no longer be reviewed',
      );
    }
    throw e;
  }

  /**
   * Cross-submission duplicate-photo detection for the recces on this page (reuses the shared
   * ImageHash store written by the capture lane, ownerKind "RECCE"). A recce is flagged when
   * any of its photo hashes also appears under a DIFFERENT owner in the same tenant. Bounded
   * to the page (never a tenant-wide scan).
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

  /** A stored MediaValue → a render-ready {key, viewPath, geo} the ASM UI can consume. */
  private mediaRef(photo: unknown): MediaRef | null {
    const { key, geo } = readMediaValue(photo);
    if (!key) return null;
    return {
      key,
      // Relative path resolved by the auth-gated media-view endpoint (PosmMediaService.viewMedia).
      viewPath: `/v1/media/view?key=${encodeURIComponent(key)}`,
      geo: geo ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : null,
    };
  }

  /**
   * Normalise the stored `qualityFlags` JSON → the four advisory booleans the ASM UI reads, or
   * `null` when absent/malformed (older recces, or a non-object value). Coerces each flag to a
   * strict boolean so a missing/odd field never leaks a non-boolean into the response.
   */
  private qualityFlags(v: Prisma.JsonValue | null): ReccePosmQualityFlags | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const f = v as Record<string, unknown>;
    return {
      blur: f.blur === true,
      blank: f.blank === true,
      lowLight: f.lowLight === true,
      overexposed: f.overexposed === true,
      lowAccuracy: f.lowAccuracy === true,
    };
  }

  /** Prisma.Decimal | null → number | null for the JSON response. */
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
        entityType: 'RECCE',
        entityId,
        oldValues: toJson(oldValues),
        newValues: toJson(newValues),
        metadata: { clientId: user.clientId } as Prisma.InputJsonValue,
      },
    });
  }
}
