import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, RecceStatus, HoReviewStatus, RecceMode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope } from '../common/tenant-scope';
import { PROVISIONAL_CODE_PREFIX } from '../common/provisional-code';
import { PosmMediaService } from '../capture/posm-media.service';
import { readMediaValue } from '../capture/visibility-types';
import { CaptureIntegrityService } from '../capture-integrity/capture-integrity.service';
import { readPosmCaptureConfig, readGpsAccuracyCapMeters } from '../capture-integrity/posm-config.helper';
import { aggregatePhotoFence } from '../capture-integrity/photo-geo.helper';
import { CreateRecceDto, ReccePosmLineDto } from './dto/create-recce.dto';
import { CreateManualRecceDto } from './dto/create-manual-recce.dto';
import { ResubmitRecceDto } from './dto/resubmit-recce.dto';
import { ListRecceDto } from './dto/list-recce.dto';

/**
 * Linear conversion factors → feet, for every dimension unit the recce capture UI can record.
 * The max-area cap is expressed in sq ft, so W×H must be normalised to feet before comparing —
 * otherwise a value entered in cm/mm/in would compare against a ft cap and silently bypass it.
 */
const AREA_UNIT_TO_FT: Record<string, number> = {
  ft: 1,
  feet: 1,
  foot: 1,
  in: 1 / 12,
  inch: 1 / 12,
  inches: 1 / 12,
  cm: 0.0328084,
  mm: 0.00328084,
  m: 3.28084,
  meter: 3.28084,
  metre: 3.28084,
};

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
    // A UNIT element stores JSON null (no W×H); a DIMENSION element stores {width,height,unit}.
    dimensions: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    photo: Prisma.InputJsonValue;
    markup: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    qualityFlags: Prisma.InputJsonValue;
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

    // One live APP recce per site — a submitted/approved recce is immutable; a rejected one must
    // go through resubmit (not a fresh POST). The old (clientId, siteId) hard unique was relaxed to
    // an APP-only partial unique (`recces_app_one_per_site`) so MANUAL recces can be unlimited, so
    // this guard now filters to recceMode=APP (findFirst, not findUnique on the dropped compound).
    const existing = await this.prisma.recce.findFirst({
      where: { clientId, siteId: site.id, recceMode: RecceMode.APP },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === RecceStatus.REJECTED) {
        throw new ConflictException(
          'This outlet already has a rejected recce — re-capture it via POST /v1/recce/:id/resubmit.',
        );
      }
      throw new ConflictException(
        `This outlet already has a ${existing.status} recce (a submitted recce is immutable).`,
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
        throw new ConflictException('This outlet already has a recce (concurrent submit).');
      }
      throw e;
    }

    return this.present(recce, { duplicate });
  }

  // ── Manual submit (field-typed outlet → straight to HO, no ASM) ──────────────────
  /**
   * Submit a MANUAL recce: the field exec types the outlet (only Outlet Name required) and does
   * the identical element capture. The Site is RESOLVED-OR-CREATED (vendor derived from the token,
   * same confinement as the app recce) and the recce is created `recceMode=MANUAL,
   * status=SUBMITTED, hoReviewStatus=PENDING` so it lands directly in the HO queue (no ASM stage).
   *
   * Outlet resolution (D6 / D8):
   *   - `outletId` matches an existing Site the caller's vendor services → ATTACH (reuse it).
   *   - `outletId` new → create a Site with `code = outletId`.
   *   - `outletId` blank → create a Site with a provisional `MAN-<uuid>` code (HO finalises it).
   * An `outletId` that collides with an outlet NOT serviced by this vendor surfaces a clean 409
   * (the (clientId, code) unique) — never a cross-vendor attach or a silent duplicate. A manual
   * recce is allowed even when the outlet already has an APP recce (manual is unlimited per outlet).
   */
  async createManual(user: JwtPayload, dto: CreateManualRecceDto) {
    const clientId = user.clientId;
    // Vendor derived from the caller's token — identical confinement to the app recce lane. A
    // vendor role with no resolvable vendor FAILS CLOSED (404), never an unscoped create.
    const v = vendorScope(user);
    if ((user.role === 'VENDOR_FIELD' || user.role === 'VENDOR_HO') && !v) {
      throw new NotFoundException('Outlet not found');
    }

    // Outlet Name is REQUIRED (also guarded in the DTO) — reject a blank / whitespace-only name.
    const outletName = (dto.outletName ?? '').trim();
    if (!outletName) throw new BadRequestException('Outlet Name is required.');
    this.assertMaxTwo(dto.posms);

    const outletId = (dto.outletId ?? '').trim();

    // Resolve an existing outlet to ATTACH to — scoped to the caller's vendor so a foreign /
    // other-vendor outlet is never attached (it is invisible here). A collision with such an outlet
    // falls through to the create branch and surfaces as a P2002 → 409 below (no existence leak).
    let existingSite: { id: string; lat: Prisma.Decimal | null; lng: Prisma.Decimal | null; status: string; gsbAllowed: boolean } | null = null;
    if (outletId) {
      existingSite = await this.prisma.site.findFirst({
        where: { clientId, code: outletId, ...(v ? { vendorId: v } : {}) },
        select: { id: true, lat: true, lng: true, status: true, gsbAllowed: true },
      });
      if (existingSite && existingSite.status !== 'ACTIVE') {
        throw new BadRequestException('That outlet is not active.');
      }
    }

    // Prepare (media + integrity + per-photo fence) against the resolved geo reference. A
    // brand-new manual outlet has no lat/lng → geoFenceOk stays null (flag, not block — R5).
    // A brand-new manual outlet has no master row yet → gsbAllowed is false (GSB is blocked for a
    // walk-in; it becomes available only once HO finalises the outlet and approves it for GSB).
    const siteForPrepare = existingSite ?? { id: '', lat: null, lng: null, gsbAllowed: false };
    const prepared = await this.prepare(clientId, siteForPrepare, dto.posms);

    let duplicate = false;
    let recce;
    try {
      recce = await this.prisma.$transaction(async (tx) => {
        // Create the outlet row at submit (D8) when not attaching to an existing one.
        let siteId: string;
        if (existingSite) {
          siteId = existingSite.id;
        } else {
          const code = outletId || `${PROVISIONAL_CODE_PREFIX}${randomUUID()}`;
          const created = await tx.site.create({
            data: {
              clientId,
              code,
              name: outletName,
              address: dto.outletAddress?.trim() || null,
              phone: dto.outletPhone?.trim() || null,
              vendorId: v ?? null,
              status: 'ACTIVE',
            },
            select: { id: true },
          });
          siteId = created.id;
        }

        const createdRecce = await tx.recce.create({
          data: {
            clientId,
            siteId,
            submittedById: user.sub,
            status: RecceStatus.SUBMITTED,
            recceMode: RecceMode.MANUAL,
            // No ASM stage: the manual recce enters HO review directly (R4).
            hoReviewStatus: HoReviewStatus.PENDING,
            version: 1,
            ...prepared.geo,
            posms: { create: prepared.posmCreate },
          },
          include: this.detailInclude(),
        });
        if (prepared.hashes.length > 0) {
          const rec = await this.media.recordImageHashes(
            tx, clientId, { ownerKind: 'RECCE', ownerId: createdRecce.id }, prepared.hashes,
          );
          duplicate = rec.dupHashes.length > 0;
        }
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            action: 'CREATE',
            entityType: 'RECCE',
            entityId: createdRecce.id,
            newValues: toJson({
              status: createdRecce.status, recceMode: RecceMode.MANUAL, siteId, version: createdRecce.version,
            }),
            metadata: { clientId, event: 'RECCE_MANUAL_SUBMIT' } as Prisma.InputJsonValue,
          },
        });
        return createdRecce;
      });
    } catch (e) {
      // An outletId that collides with an existing outlet (clientId, code) the caller's vendor does
      // NOT service — or a concurrent create racing the same code — surfaces a 409. The message is
      // intentionally generic: confirming the id belongs to a sibling vendor's outlet would leak its
      // existence across the vendor boundary that `/sites/lookup` enforces (adversarial audit F3).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          outletId
            ? "This Outlet ID can't be used. Enter a different Outlet ID, or leave it blank for Head-Office to assign."
            : 'This outlet could not be created (concurrent submit).',
        );
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
      // The original POSM lines (type + dimensions) are loaded so the resubmit can be validated to
      // EQUAL them — the FE locks the element type + dimensions to the original and only re-captures
      // photo + markup, so a modified client (or an FE bug) must not be able to drop / re-type an
      // element and silently lose it. See assertResubmitMatchesOriginal below.
      include: { site: true, posms: { select: { posmTypeId: true, dimensions: true } } },
    });
    if (!recce) throw new NotFoundException('Recce not found');
    if (recce.status !== RecceStatus.REJECTED) {
      throw new ConflictException(
        `Only a REJECTED recce can be resubmitted (this one is ${recce.status}).`,
      );
    }
    if (recce.site.status !== 'ACTIVE') throw new BadRequestException('Outlet is not active');

    // The element SET is locked on resubmit: the resubmitted POSM lines must match the original
    // recce's — same count, same set of posmTypeIds, same dimensions (order-insensitive). This
    // enforces the FE lock server-side so an element can never be dropped or re-typed on re-capture.
    this.assertResubmitMatchesOriginal(recce.posms, dto.posms);

    // GSB gate is BYPASSED on resubmit: the element identity is fixed (it equals the original, which
    // was already GSB-valid when first accepted). Only the photo + markup are new, so re-applying the
    // gate against the outlet's CURRENT gsbAllowed would turn a later gsbAllowed=false flip into a
    // permanent dead-end (a locked GSB element could never be re-captured). A normal create/manual
    // path still runs the gate unchanged.
    const prepared = await this.prepare(clientId, recce.site, dto.posms, { isResubmit: true });

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
            // A re-captured recce re-enters the pipeline straight at HO review — for BOTH modes.
            // A REJECTED recce was already seen once; on resubmit it skips the ASM stage and goes
            // directly to the HO queue (status SUBMITTED, hoReviewStatus PENDING), so the field's
            // re-work lands in front of HO, never back in the ASM queue. (Previously only MANUAL
            // went straight to HO and an APP resubmit returned to NONE / re-entered ASM.)
            hoReviewStatus: HoReviewStatus.PENDING,
            hoReviewedById: null,
            hoReviewedAt: null,
            hoRejectionReasonCode: null,
            hoRejectionReason: null,
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
    // Mode filter lets the field app pull the exec's MANUAL recces independent of the RS/Beat gate
    // (a provisional manual outlet has no RS/Beat) so they stay visible + re-capturable in My Work.
    if (q.recceMode) where.recceMode = q.recceMode;
    if (q.siteCode) {
      where.site = {
        ...(where.site as Prisma.SiteWhereInput | undefined),
        code: { contains: q.siteCode, mode: 'insensitive' },
      };
    }
    // RS code + Beat are EXACT case-insensitive matches (the field picks one value per
    // drop-down). Spread-merged into `where.site` so the vendor pin (set by scopeWhere) holds.
    if (q.rsCode) {
      where.site = {
        ...(where.site as Prisma.SiteWhereInput | undefined),
        rsCode: { equals: q.rsCode, mode: 'insensitive' },
      };
    }
    // Beat: a non-empty `beatNames` multi-select wins — matched CASE-INSENSITIVELY (an OR of
    // insensitive equals inside the `site` relation filter, AND-ed with the vendor pin + any
    // rsCode/siteCode clause). Mixed-case bulk-upload beat data must not hide a rep's own recces,
    // so this mirrors the legacy single-beat insensitive match. Else: the legacy single `beatName`.
    if (Array.isArray(q.beatNames) && q.beatNames.length > 0) {
      where.site = {
        ...(where.site as Prisma.SiteWhereInput | undefined),
        OR: q.beatNames.map((b) => ({ beatName: { equals: b, mode: 'insensitive' } })),
      };
    } else if (q.beatName) {
      where.site = {
        ...(where.site as Prisma.SiteWhereInput | undefined),
        beatName: { equals: q.beatName, mode: 'insensitive' },
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
          // The recce's installation (to-one), if any — so the field My Work screen can DROP a recce
          // that's already been submitted for installation instead of still offering "Start
          // installation" (a second submit 409s; the rep only learns that after opening it).
          installation: { select: { status: true } },
        },
      }),
      this.prisma.recce.count({ where }),
    ]);

    const recces = rows.map((r) => ({
      id: r.id,
      status: r.status,
      // APP vs MANUAL — the field My Work list needs this to classify a SUBMITTED recce as
      // "awaiting HO" (manual, no ASM) vs "awaiting ASM" (app), and to label the card honestly.
      recceMode: r.recceMode,
      // The HO review verdict the field app needs to gate installation + render the re-recce banner.
      hoReviewStatus: r.hoReviewStatus,
      // The recce's installation status (SUBMITTED / AUDIT_APPROVED / AUDIT_REJECTED), or null when
      // it has never been installed. A non-null value means the rep's install job is done — the My
      // Work screen uses it to drop the recce from "Ready to install".
      installStatus: r.installation?.status ?? null,
      version: r.version,
      site: r.site,
      posmCount: r.posms.length,
      geoFenceOk: r.geoFenceOk,
      distanceMeters: this.dec(r.distanceMeters),
      capturedAt: r.capturedAt,
      receivedAt: r.receivedAt,
      rejectionReasonCode: r.rejectionReasonCode,
      // The HO rejection reason (null unless HO sent it back) — the My Work re-capture card reads
      // this when hoReviewStatus === 'REJECTED', since the ASM `rejectionReasonCode` is null then.
      hoRejectionReasonCode: r.hoRejectionReasonCode,
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

  // ── Resolve the resubmit target for a site (field app re-capture) ───────────────
  /**
   * Resolve the REJECTED recce the CURRENT caller may re-capture at a given site — the
   * authoritative target for the field app's re-capture flow. Returns `{ recce: <RecceDetail> }`
   * (the SAME shape as get(), so the FE can seed + lock from `recce.posms`) or `{ recce: null }`
   * when the site has no rejected recce the caller can act on.
   *
   * Scoped EXACTLY like resubmit() (via `scopeWhere`: tenant + vendor pin, fail-closed for a vendor
   * with no vendorId) — never widened. This replaces the FE's fragile "scan my-recces + take the
   * newest for the site" heuristic, which resolved the wrong recce at a site carrying a rejected
   * APP recce alongside a newer (manual/approved) one, and missed it entirely past the page cap.
   * When several rejected recces match, the newest is returned (deterministic); a caller targeting a
   * specific one uses the GET /v1/recce/:id deep link.
   */
  async forSite(user: JwtPayload, siteId: string) {
    const scope = this.scopeWhere(user);
    if (scope === null) return { recce: null }; // fail-closed (a vendor with no vendorId)

    const recce = await this.prisma.recce.findFirst({
      where: { ...scope, siteId, status: RecceStatus.REJECTED },
      orderBy: { createdAt: 'desc' },
      include: this.detailInclude(),
    });
    if (!recce) return { recce: null };
    const duplicate = await this.recceDuplicate(recce.clientId, recce.id);
    return { recce: this.present(recce, { duplicate }) };
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
    site: { id: string; lat: Prisma.Decimal | null; lng: Prisma.Decimal | null; gsbAllowed?: boolean; settings?: unknown },
    lines: ReccePosmLineDto[],
    opts: { isResubmit?: boolean } = {},
  ): Promise<PreparedRecce> {
    const posmTypes = await this.assertPosmTypesInTenant(clientId, lines.map((l) => l.posmTypeId));
    const typeById = new Map(posmTypes.map((p) => [p.id, p]));

    // GSB GATE: an element flagged `isGsb=true` may be recced ONLY at an outlet whose master record is
    // approved for GSB (Site.gsbAllowed === true). Keyed on the explicit PosmType.isGsb flag (replaces
    // the former hardcoded code==='GSB' rule). Enforced here, the shared choke-point for the APP
    // (create) and MANUAL (createManual) lanes, so the gate cannot be bypassed by any FRESH submit path
    // — and BEFORE any media/fence/hash/DB write. A provisional manual walk-in outlet has
    // gsbAllowed=false by default, so GSB is correctly blocked there until HO finalises + approves the
    // outlet. The resubmit lane passes isResubmit:true — its element set is locked to the
    // (already-valid) original, so re-applying the gate against the outlet's CURRENT gsbAllowed would
    // make a later gsbAllowed flip a permanent dead-end.
    const hasGsb = posmTypes.some((p) => p.isGsb === true);
    if (!opts.isResubmit && hasGsb && site.gsbAllowed !== true) {
      throw new BadRequestException('You can only recce the GSB element at outlets approved for GSB.');
    }

    // MEASUREMENT + MAX-AREA cap (per element type), enforced before any media/fence/hash/DB write:
    //   - DIMENSION element: a numeric width + height (and unit) are REQUIRED (today's behaviour); if the
    //     type has a maxAreaSqFt cap, width*height (sq ft) must be ≤ it, else reject.
    //   - UNIT element: NO dimensions — any supplied W×H is IGNORED and the line is stored with null
    //     dimensions (handled in the posmCreate mapping below).
    for (const l of lines) {
      const pt = typeById.get(l.posmTypeId);
      if (!pt || pt.measurement === 'UNIT') continue; // UNIT → no dimension rule / cap
      const d = l.dimensions;
      if (
        !d ||
        typeof d.width !== 'number' ||
        typeof d.height !== 'number' ||
        !Number.isFinite(d.width) ||
        !Number.isFinite(d.height) ||
        d.width <= 0 ||
        d.height <= 0 ||
        !d.unit
      ) {
        throw new BadRequestException('Width and height are required for this element.');
      }
      // Max-area cap: skip on resubmit (dims are locked from the original recce — mirror the GSB gate),
      // and compare in sq ft after normalising the recorded unit so a cm/mm entry can't bypass the cap.
      if (!opts.isResubmit && pt.maxAreaSqFt != null) {
        const factor = AREA_UNIT_TO_FT[d.unit.trim().toLowerCase()];
        if (factor == null) {
          throw new BadRequestException(`Unsupported dimension unit "${d.unit}" for this element.`);
        }
        const areaSqFt = d.width * factor * (d.height * factor);
        if (areaSqFt > pt.maxAreaSqFt) {
          throw new BadRequestException(
            `Element exceeds the maximum size (${pt.maxAreaSqFt} sq ft) for this element type.`,
          );
        }
      }
    }

    // Media keys must belong to THIS tenant's media folder (key-ownership guard), AND no two POSM
    // lines in this ONE submission may reuse the same photo (parity with the installation lane's
    // in-submission dedup): a single storefront photo cannot legitimately stand in for two distinct
    // POSM slots. Caught here, before any write/fence/hash work, so the reuse never touches the DB.
    const seenKeys = new Set<string>();
    for (const l of lines) {
      const { key } = readMediaValue(l.photo);
      if (!key || !key.startsWith(`posm-media/${clientId}/`)) {
        throw new BadRequestException('A photo key does not belong to this tenant.');
      }
      if (seenKeys.has(key)) {
        throw new BadRequestException(
          'The same photo is used on more than one Element line — capture a distinct photo per Element.',
        );
      }
      seenKeys.add(key);
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
          ? 'A photo was captured outside the outlet geo-fence. Re-capture at the outlet.'
          : 'A photo has no verifiable in-fence GPS fix (missing, invalid, or low-accuracy). Re-capture at the outlet with location enabled.',
      );
    }

    // Content hashes for the cross-submission duplicate flag (best-effort: a missing object
    // simply contributes no hash rather than failing the submission). The SAME fetched bytes
    // drive each POSM line's stored per-photo capture-quality flags (blur/lowLight/overexposed
    // from the decoded pixels + lowAccuracy from that photo's own geo fix) — no double-fetch.
    // `duplicate` is dropped here: the recce keeps its submission-level duplicate flag (recorded
    // via recordImageHashes / recceDuplicate), so per-POSM stays byte-quality + geo-accuracy only.
    // Order is preserved so `qualityFlags[i]` maps to `lines[i]` (and thus `posmCreate[i]`).
    const hashes: string[] = [];
    const qualityFlags: Prisma.InputJsonValue[] = [];
    for (const l of lines) {
      const { key, geo } = readMediaValue(l.photo);
      const bytes = await this.integrity.fetchImageBytes(key);
      if (bytes) hashes.push(this.integrity.hash(bytes));
      const qf = await this.integrity.qualityFlags(bytes, {
        duplicate: false,
        accuracy: geo?.accuracy,
      });
      qualityFlags.push({
        blur: qf.blur,
        blank: qf.blank,
        lowLight: qf.lowLight,
        overexposed: qf.overexposed,
        lowAccuracy: qf.lowAccuracy,
      });
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
      posmCreate: lines.map((l, i) => {
        // UNIT element → store JSON null (no dimensions); DIMENSION → store the entered {width,height,unit}.
        const isUnit = typeById.get(l.posmTypeId)?.measurement === 'UNIT';
        return {
          slotNo: i + 1,
          posmTypeId: l.posmTypeId,
          dimensions: isUnit ? Prisma.JsonNull : this.dimensionsJson(l.dimensions!),
          photo: this.photoJson(l.photo),
          markup: l.markup ? (toJson(l.markup) as Prisma.InputJsonValue) : Prisma.JsonNull,
          qualityFlags: qualityFlags[i],
        };
      }),
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
      throw new NotFoundException('Outlet not found');
    }
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, clientId: user.clientId, ...(v ? { vendorId: v } : {}) },
    });
    if (!site) throw new NotFoundException('Outlet not found');
    if (site.status !== 'ACTIVE') throw new BadRequestException('Outlet is not active');
    return site;
  }

  private assertMaxTwo(lines: unknown[]) {
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2) {
      throw new BadRequestException('A recce must have 1 or 2 Element lines.');
    }
  }

  /**
   * Enforce the resubmit element LOCK server-side: the resubmitted POSM lines must EQUAL the
   * original recce's — same COUNT, same set of `posmTypeId`s, and the same dimensions
   * (width/height/unit, canonicalised so the "branding not required"/NA case compares equal).
   * The match is ORDER-INSENSITIVE and multiset-aware (two identical lines must still both be
   * present). Any mismatch is a 400 — the FE only re-captures photo + markup, never the element
   * identity, so a dropped / re-typed / re-sized element can only mean a tampered or buggy client.
   */
  private assertResubmitMatchesOriginal(
    original: { posmTypeId: string; dimensions: Prisma.JsonValue }[],
    incoming: ReccePosmLineDto[],
  ) {
    const fail = (): never => {
      throw new BadRequestException(
        'Resubmission must re-capture the same elements (type and dimensions) as the original recce.',
      );
    };
    if (original.length !== incoming.length) fail();

    const key = (posmTypeId: string, dims: unknown) => {
      const d = this.canonicalDims(dims);
      return `${posmTypeId}|${d.width}|${d.height}|${d.unit}`;
    };
    // Multiset of the original lines' keys; each incoming line must consume one.
    const counts = new Map<string, number>();
    for (const o of original) {
      const k = key(o.posmTypeId, o.dimensions);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const i of incoming) {
      const k = key(i.posmTypeId, i.dimensions);
      const c = counts.get(k);
      if (!c) fail(); // not in the original set (or already fully consumed)
      else counts.set(k, c - 1);
    }
    // Lengths are equal and every incoming line consumed a positive count, so the multiset matched.
  }

  /**
   * Canonicalise a dimensions value (stored JSON OR an incoming DTO) to comparable primitives, so
   * the resubmit lock compares like-for-like. A numeric width/height is kept, a non-numeric one
   * becomes null, and a non-string / empty unit becomes null — so an absent / NA / malformed
   * dimension (`{}`, null, "garbage") collapses to {null,null,null} and compares equal to another
   * absent one, while a real {width,height,unit} compares on its actual values.
   */
  private canonicalDims(d: unknown): { width: number | null; height: number | null; unit: string | null } {
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return { width: null, height: null, unit: null };
    }
    const o = d as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
    return { width: num(o.width), height: num(o.height), unit: str(o.unit) };
  }

  private async assertPosmTypesInTenant(clientId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.posmType.findMany({
      where: { clientId, id: { in: unique } },
      // isGsb / measurement / maxAreaSqFt drive the element-type config enforced in prepare():
      // the GSB gate, the DIMENSION-vs-UNIT dimension rule, and the max-area cap.
      select: { id: true, code: true, isActive: true, isGsb: true, measurement: true, maxAreaSqFt: true },
    });
    const byId = new Map(found.map((p) => [p.id, p]));
    for (const id of unique) {
      const p = byId.get(id);
      if (!p) throw new BadRequestException('A posmTypeId is not an Element type in this tenant.');
      if (!p.isActive) throw new BadRequestException('A referenced Element type is inactive.');
    }
    return found;
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
      id: string; status: RecceStatus; recceMode: RecceMode; version: number;
      captureLat: Prisma.Decimal | null; captureLng: Prisma.Decimal | null; captureAccuracy: number | null;
      distanceMeters: Prisma.Decimal | null; geoFenceOk: boolean | null;
      capturedAt: Date | null; receivedAt: Date;
      rejectionReasonCode: unknown; rejectionReason: string | null;
      hoReviewStatus: HoReviewStatus; hoRejectionReasonCode: unknown; hoRejectionReason: string | null;
      site: { id: string; code: string; name: string; town: string | null; lat: Prisma.Decimal | null; lng: Prisma.Decimal | null };
      submittedBy: { id: string; name: string };
      posms: { id: string; slotNo: number; posmTypeId: string; dimensions: unknown; photo: unknown; markup: unknown; qualityFlags: unknown; posmType: { id: string; code: string; name: string } }[];
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
      // APP vs MANUAL — the FE renders the Manual badge / entry-path classification off this.
      recceMode: r.recceMode,
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
      // HO review stage surfaced for the field app's re-recce banner + install gating.
      hoReviewStatus: r.hoReviewStatus,
      hoRejectionReasonCode: r.hoRejectionReasonCode ?? null,
      hoRejectionReason: r.hoRejectionReason ?? null,
      posms: r.posms.map((p) => ({
        id: p.id,
        slotNo: p.slotNo,
        posmType: p.posmType,
        dimensions: p.dimensions,
        photo: this.mediaRef(p.photo),
        markup: p.markup ?? null,
        // Per-POSM stored capture-quality flags (blur/lowLight/overexposed/lowAccuracy), or null
        // for a legacy row captured before this column existed. This is ADDITIVE — the recce-level
        // `integrity.qualityFlags` block (lowAccuracy/clockSkew/duplicate) above is unchanged.
        qualityFlags: p.qualityFlags ?? null,
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
