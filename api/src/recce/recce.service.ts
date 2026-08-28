import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, RecceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope } from '../common/tenant-scope';
import { PosmMediaService } from '../capture/posm-media.service';
import { readMediaValue } from '../capture/visibility-types';
import { CaptureIntegrityService } from '../capture-integrity/capture-integrity.service';
import { readPosmCaptureConfig, readGpsAccuracyCapMeters } from '../capture-integrity/posm-config.helper';
import { aggregatePhotoFence } from '../capture-integrity/photo-geo.helper';
import { CreateRecceDto, ReccePosmLineDto } from './dto/create-recce.dto';
import { ResubmitRecceDto } from './dto/resubmit-recce.dto';
import { ListRecceDto } from './dto/list-recce.dto';

/** JSON-safe conversion (Dates → ISO, strips undefined) for the AuditLog Json columns. */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

/** A media reference the field UI can render: object key + auth-gated relative view-path. */
export interface MediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/** The prepared, integrity-checked payload for one recce submission (create or resubmit). */
interface PreparedRecce {
  geo: {
    captureLat: number | null;
    captureLng: number | null;
    captureAccuracy: number | null;
    distanceMeters: number | null;
    geoFenceOk: boolean | null;
    capturedAt: Date | null;
  };
  posmCreate: {
    slotNo: number;
    posmTypeId: string;
    dimensions: Prisma.InputJsonValue;
    photo: Prisma.InputJsonValue;
    markup: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  }[];
  hashes: string[];
}

/**
 * RecceService — the Recce field-capture stage (Wave 2 CAPTURE lane). Owns the state
 * transition **∅ → SUBMITTED** (and REJECTED → SUBMITTED on resubmit, bumping `version`).
 * Approval/rejection is a DIFFERENT lane (ApprovalService).
 *
 * SECURITY (the anti-fraud + isolation concern), enforced on every path:
 *   - Only a VENDOR_FIELD caller (controller @Roles floor) whose OWN vendor services the site
 *     may submit — resolved fail-closed via `vendorScope`. A foreign / other-vendor / other-
 *     tenant site is INVISIBLE (404), never a leak.
 *   - The site must be ACTIVE.
 *   - At most 2 POSM lines (DTO + defensive service check).
 *   - The recce is IMMUTABLE once submitted: one live recce per site
 *     (`@@unique([clientId, siteId])`); only a REJECTED one can be re-captured (resubmit).
 *   - Per-photo geo is server-verified against the SITE reference: any fix OUTSIDE the fence
 *     is a HARD 403 when the tenant fence is enabled (a flag, not a block, when disabled or
 *     unverifiable). Content hashes are recorded for the cross-submission duplicate flag.
 */
@Injectable()
export class RecceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: PosmMediaService,
    private readonly integrity: CaptureIntegrityService,
  ) {}

  // ── Submit (∅ → SUBMITTED) ─────────────────────────────────────────────────────
  async create(user: JwtPayload, dto: CreateRecceDto) {
    const clientId = user.clientId;
    const site = await this.loadOwnedActiveSite(user, dto.siteId);
    this.assertMaxTwo(dto.posms);

    // One live recce per site — a submitted/approved recce is immutable; a rejected one
    // must go through resubmit (not a fresh POST).
    const existing = await this.prisma.recce.findUnique({
      where: { clientId_siteId: { clientId, siteId: site.id } },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === RecceStatus.REJECTED) {
        throw new ConflictException(
          'This site already has a rejected recce — re-capture it via POST /v1/recce/:id/resubmit.',
        );
      }
      throw new ConflictException(
        `This site already has a ${existing.status} recce (a submitted recce is immutable).`,
      );
    }

    const prepared = await this.prepare(clientId, site, dto.posms);

    // B8: surface a cross-submission duplicate flag — recordImageHashes reports which of this
    // recce's photo hashes already appear on a DIFFERENT owner (a recce photo reused across
    // sites). Captured out of the transaction closure and surfaced on the response.
    let duplicate = false;
    let recce;
    try {
      recce = await this.prisma.$transaction(async (tx) => {
        const created = await tx.recce.create({
          data: {
            clientId,
            siteId: site.id,
            submittedById: user.sub,
            status: RecceStatus.SUBMITTED,
            version: 1,
            ...prepared.geo,
            posms: { create: prepared.posmCreate },
          },
          include: this.detailInclude(),
        });
        if (prepared.hashes.length > 0) {
          const rec = await this.media.recordImageHashes(
            tx, clientId, { ownerKind: 'RECCE', ownerId: created.id }, prepared.hashes,
          );
          duplicate = rec.dupHashes.length > 0;
        }
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            action: 'CREATE',
            entityType: 'RECCE',
            entityId: created.id,
            newValues: toJson({ status: created.status, siteId: site.id, version: created.version }),
            metadata: { clientId, event: 'RECCE_SUBMIT' } as Prisma.InputJsonValue,
          },
        });
        return created;
      });
    } catch (e) {
      // A4: a concurrent create racing the one-live-recce-per-site unique constraint surfaces a
      // clean 409, not a raw 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This site already has a recce (concurrent submit).');
      }
      throw e;
    }

    return this.present(recce, { duplicate });
  }

  // ── Resubmit (REJECTED → SUBMITTED, version++) ──────────────────────────────────
  async resubmit(user: JwtPayload, id: string, dto: ResubmitRecceDto) {
    const clientId = user.clientId;
    this.assertMaxTwo(dto.posms);

    // A1 fail-CLOSED: a null vendor scope must DENY (404), never collapse the `where` to `{ id }`
    // (which would let a vendor resubmit ANY tenant's recce). Matches get()/list().
    const scope = this.scopeWhere(user);
    if (scope === null) throw new NotFoundException('Recce not found');

    const recce = await this.prisma.recce.findFirst({
      where: { id, ...scope },
      include: { site: true },
    });
    if (!recce) throw new NotFoundException('Recce not found');
    if (recce.status !== RecceStatus.REJECTED) {
      throw new ConflictException(
        `Only a REJECTED recce can be resubmitted (this one is ${recce.status}).`,
      );
    }
    if (recce.site.status !== 'ACTIVE') throw new BadRequestException('Site is not active');

    const prepared = await this.prepare(clientId, recce.site, dto.posms);

    let duplicate = false;
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        // A rejected recce never has an installation (install requires APPROVED), so replacing
        // its POSM child rows is safe.
        await tx.reccePosm.deleteMany({ where: { recceId: id } });
        const next = await tx.recce.update({
          where: { id },
          data: {
            status: RecceStatus.SUBMITTED,
            version: { increment: 1 },
            receivedAt: new Date(),
            approvedById: null,
            reviewedAt: null,
            rejectionReasonCode: null,
            rejectionReason: null,
            ...prepared.geo,
            posms: { create: prepared.posmCreate },
          },
          include: this.detailInclude(),
        });
        if (prepared.hashes.length > 0) {
          const rec = await this.media.recordImageHashes(
            tx, clientId, { ownerKind: 'RECCE', ownerId: id }, prepared.hashes,
          );
          duplicate = rec.dupHashes.length > 0;
        }
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            action: 'UPDATE',
            entityType: 'RECCE',
            entityId: id,
            oldValues: toJson({ status: RecceStatus.REJECTED, version: recce.version }),
            newValues: toJson({ status: RecceStatus.SUBMITTED, version: next.version }),
            metadata: { clientId, event: 'RECCE_RESUBMIT' } as Prisma.InputJsonValue,
          },
        });
        return next;
      });
    } catch (e) {
      // A4: clean 409 on a unique-constraint race.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This recce could not be resubmitted (concurrent write).');
      }
      throw e;
    }

    return this.present(updated, { duplicate });
  }

  // ── List (the field user's OWN recces, vendor-scoped) ───────────────────────────
  async list(user: JwtPayload, q: ListRecceDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const scope = this.scopeWhere(user);
    if (scope === null) return { recces: [], total: 0, page, limit }; // fail-closed

    const where: Prisma.RecceWhereInput = { ...scope, submittedById: user.sub };
    if (q.status) where.status = q.status;
    if (q.siteCode) {
      where.site = {
        ...(where.site as Prisma.SiteWhereInput | undefined),
        code: { contains: q.siteCode, mode: 'insensitive' },
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.recce.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          site: { select: { id: true, code: true, name: true, town: true } },
          posms: { orderBy: { slotNo: 'asc' }, select: { id: true, slotNo: true } },
        },
      }),
      this.prisma.recce.count({ where }),
    ]);

    const recces = rows.map((r) => ({
      id: r.id,
      status: r.status,
      version: r.version,
      site: r.site,
      posmCount: r.posms.length,
      geoFenceOk: r.geoFenceOk,
      distanceMeters: this.dec(r.distanceMeters),
      capturedAt: r.capturedAt,
      receivedAt: r.receivedAt,
      rejectionReasonCode: r.rejectionReasonCode,
    }));
    return { recces, total, page, limit };
  }

  // ── Get one (with POSM lines + media view-paths) ────────────────────────────────
  async get(user: JwtPayload, id: string) {
    const scope = this.scopeWhere(user);
    if (scope === null) throw new NotFoundException('Recce not found');
    const recce = await this.prisma.recce.findFirst({
      where: { id, ...scope },
      include: this.detailInclude(),
    });
    if (!recce) throw new NotFoundException('Recce not found');
    const duplicate = await this.recceDuplicate(recce.clientId, recce.id);
    return this.present(recce, { duplicate });
  }

  /**
   * B8: does any of this recce's recorded photo hashes also appear on a DIFFERENT owner (a
   * recce photo reused across sites / an install)? Two cheap indexed lookups against the shared
   * ImageHash store — no byte re-fetch. Returns false when the recce recorded no hashes.
   */
  private async recceDuplicate(clientId: string, recceId: string): Promise<boolean> {
    const own = await this.prisma.imageHash.findMany({
      where: { ownerKind: 'RECCE', ownerId: recceId },
      select: { hash: true },
    });
    if (own.length === 0) return false;
    const hashes = [...new Set(own.map((h) => h.hash))];
    const other = await this.prisma.imageHash.findFirst({
      where: {
        clientId,
        hash: { in: hashes },
        NOT: { ownerKind: 'RECCE', ownerId: recceId },
      },
      select: { id: true },
    });
    return !!other;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Prepare + integrity-check a submission's POSM lines: validate posm-types + media keys,
   * roll up the per-photo geo-fence (HARD 403 on an outside fix when the fence is enabled),
   * and record content hashes for the duplicate flag. Shared by create + resubmit.
   */
  private async prepare(
    clientId: string,
    site: { id: string; lat: Prisma.Decimal | null; lng: Prisma.Decimal | null; settings?: unknown },
    lines: ReccePosmLineDto[],
  ): Promise<PreparedRecce> {
    await this.assertPosmTypesInTenant(clientId, lines.map((l) => l.posmTypeId));

    // Media keys must belong to THIS tenant's media folder (key-ownership guard).
    for (const l of lines) {
      const { key } = readMediaValue(l.photo);
      if (!key || !key.startsWith(`posm-media/${clientId}/`)) {
        throw new BadRequestException('A photo key does not belong to this tenant.');
      }
    }

    // Per-tenant fence policy (settings-backed).
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { settings: true },
    });
    const config = readPosmCaptureConfig(client?.settings);
    const accuracyCapMeters = readGpsAccuracyCapMeters(client?.settings);
    const reference =
      site.lat != null && site.lng != null ? { lat: Number(site.lat), lng: Number(site.lng) } : null;

    const photos = lines.map((l) => ({ geo: readMediaValue(l.photo).geo }));
    const agg = aggregatePhotoFence(photos, reference, config.geoFence.radiusMeters, {
      accuracyCapMeters,
    });
    // B1 fail-CLOSED: when the fence is enabled AND the site has a reference, ANY fence-required
    // photo that is OUTSIDE **or** unverifiable (missing / invalid / over-accuracy-cap fix) is a
    // HARD 403 — an unverifiable fix no longer falls through as a soft null. `anyOutside` /
    // `anyUnverifiable` are only ever set when a reference exists, so the fence-disabled and
    // no-site-reference cases stay soft flags (geoFenceOk on the row).
    if (config.geoFence.enabled && (agg.anyOutside || agg.anyUnverifiable)) {
      throw new ForbiddenException(
        agg.anyOutside
          ? 'A photo was captured outside the site geo-fence. Re-capture at the site.'
          : 'A photo has no verifiable in-fence GPS fix (missing, invalid, or low-accuracy). Re-capture at the site with location enabled.',
      );
    }

    // Content hashes for the cross-submission duplicate flag (best-effort: a missing object
    // simply contributes no hash rather than failing the submission).
    const hashes: string[] = [];
    for (const l of lines) {
      const { key } = readMediaValue(l.photo);
      const bytes = await this.integrity.fetchImageBytes(key);
      if (bytes) hashes.push(this.integrity.hash(bytes));
    }

    const capturedAt =
      agg.worst?.capturedAt && !Number.isNaN(Date.parse(agg.worst.capturedAt))
        ? new Date(agg.worst.capturedAt)
        : null;

    return {
      geo: {
        captureLat: agg.worst?.lat ?? null,
        captureLng: agg.worst?.lng ?? null,
        captureAccuracy: agg.worst?.accuracy ?? null,
        distanceMeters: agg.worst?.distanceMeters ?? null,
        geoFenceOk: agg.geoFenceOk,
        capturedAt,
      },
      posmCreate: lines.map((l, i) => ({
        slotNo: i + 1,
        posmTypeId: l.posmTypeId,
        dimensions: this.dimensionsJson(l.dimensions),
        photo: this.photoJson(l.photo),
        markup: l.markup ? (toJson(l.markup) as Prisma.InputJsonValue) : Prisma.JsonNull,
      })),
      hashes,
    };
  }

  /** The base `where` a vendor caller is confined to, or null = FAIL-CLOSED (match nothing). */
  private scopeWhere(user: JwtPayload): Prisma.RecceWhereInput | null {
    const where: Prisma.RecceWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;

    if (user.role === 'VENDOR_FIELD' || user.role === 'VENDOR_HO') {
      const v = vendorScope(user);
      if (!v) return null; // a vendor role must NEVER read unscoped
      where.site = { vendorId: v };
    }
    return where;
  }

  /** Load a site the caller's vendor services AND that is ACTIVE (fail-closed → 404 / 400). */
  private async loadOwnedActiveSite(user: JwtPayload, siteId: string) {
    const v = vendorScope(user);
    if ((user.role === 'VENDOR_FIELD' || user.role === 'VENDOR_HO') && !v) {
      throw new NotFoundException('Site not found');
    }
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, clientId: user.clientId, ...(v ? { vendorId: v } : {}) },
    });
    if (!site) throw new NotFoundException('Site not found');
    if (site.status !== 'ACTIVE') throw new BadRequestException('Site is not active');
    return site;
  }

  private assertMaxTwo(lines: unknown[]) {
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2) {
      throw new BadRequestException('A recce must have 1 or 2 POSM lines.');
    }
  }

  private async assertPosmTypesInTenant(clientId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.posmType.findMany({
      where: { clientId, id: { in: unique } },
      select: { id: true, isActive: true },
    });
    const byId = new Map(found.map((p) => [p.id, p]));
    for (const id of unique) {
      const p = byId.get(id);
      if (!p) throw new BadRequestException('A posmTypeId is not a POSM type in this tenant.');
      if (!p.isActive) throw new BadRequestException('A referenced POSM type is inactive.');
    }
  }

  private detailInclude() {
    return {
      site: { select: { id: true, code: true, name: true, town: true, lat: true, lng: true } },
      submittedBy: { select: { id: true, name: true } },
      posms: {
        orderBy: { slotNo: 'asc' as const },
        include: { posmType: { select: { id: true, code: true, name: true } } },
      },
    };
  }

  /** Shape a recce (with includes) into the API response, resolving media view-paths. */
  private present(
    r: {
      id: string; status: RecceStatus; version: number;
      captureLat: Prisma.Decimal | null; captureLng: Prisma.Decimal | null; captureAccuracy: number | null;
      distanceMeters: Prisma.Decimal | null; geoFenceOk: boolean | null;
      capturedAt: Date | null; receivedAt: Date;
      rejectionReasonCode: unknown; rejectionReason: string | null;
      site: { id: string; code: string; name: string; town: string | null; lat: Prisma.Decimal | null; lng: Prisma.Decimal | null };
      submittedBy: { id: string; name: string };
      posms: { id: string; slotNo: number; posmTypeId: string; dimensions: unknown; photo: unknown; markup: unknown; posmType: { id: string; code: string; name: string } }[];
    },
    flags: { duplicate?: boolean } = {},
  ) {
    // Recce reviewer flags (B5/B6/B8). The Recce row has no qualityFlags column, so these are
    // COMPUTED from stored signals and surfaced on the response `integrity` block:
    //   - lowAccuracy: the stored representative fix's accuracy is worse than the cap (B8);
    //   - clockSkew:   client shutter time vs. server receive time differ by > 10 min (B6);
    //   - duplicate:   a recorded photo hash reused across submissions (B8), resolved by the
    //                  caller (submit → recordImageHashes dupHashes; get → recceDuplicate()).
    const qualityFlags = {
      lowAccuracy: this.integrity.isLowAccuracy(r.captureAccuracy),
      clockSkew: this.integrity.isClockSkewed(r.capturedAt, r.receivedAt),
      duplicate: flags.duplicate ?? false,
    };
    return {
      id: r.id,
      status: r.status,
      version: r.version,
      site: {
        id: r.site.id, code: r.site.code, name: r.site.name, town: r.site.town,
        lat: this.dec(r.site.lat), lng: this.dec(r.site.lng),
      },
      submittedBy: r.submittedBy,
      integrity: {
        geoFenceOk: r.geoFenceOk,
        distanceMeters: this.dec(r.distanceMeters),
        captureAccuracy: r.captureAccuracy,
        captureLat: this.dec(r.captureLat),
        captureLng: this.dec(r.captureLng),
        qualityFlags,
      },
      capturedAt: r.capturedAt,
      receivedAt: r.receivedAt,
      rejectionReasonCode: r.rejectionReasonCode ?? null,
      rejectionReason: r.rejectionReason ?? null,
      posms: r.posms.map((p) => ({
        id: p.id,
        slotNo: p.slotNo,
        posmType: p.posmType,
        dimensions: p.dimensions,
        photo: this.mediaRef(p.photo),
        markup: p.markup ?? null,
      })),
    };
  }

  /** A stored MediaValue → a render-ready {key, viewPath, geo}. */
  private mediaRef(photo: unknown): MediaRef | null {
    const { key, geo } = readMediaValue(photo);
    if (!key) return null;
    return {
      key,
      viewPath: `/v1/media/view?key=${encodeURIComponent(key)}`,
      geo: geo ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : null,
    };
  }

  private dimensionsJson(d: { width: number; height: number; unit: string }): Prisma.InputJsonValue {
    return { width: d.width, height: d.height, unit: d.unit };
  }

  private photoJson(photo: { key: string; geo?: unknown }): Prisma.InputJsonValue {
    const { key, geo } = readMediaValue(photo);
    return geo ? { key, geo: toJson(geo) } : { key };
  }

  private dec(v: Prisma.Decimal | null): number | null {
    return v != null ? Number(v) : null;
  }
}
