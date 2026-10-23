import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, InstallationStatus, RecceStatus, HoReviewStatus, RecceMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope } from '../common/tenant-scope';
import { PosmMediaService } from '../capture/posm-media.service';
import { readMediaValue } from '../capture/visibility-types';
import { haversineMeters, isValidGeo } from '../capture/geo-fence.helper';
import { CaptureIntegrityService } from '../capture-integrity/capture-integrity.service';
import { readPosmCaptureConfig, readGpsAccuracyCapMeters } from '../capture-integrity/posm-config.helper';
import { aggregatePhotoFence } from '../capture-integrity/photo-geo.helper';
import { CreateInstallationDto, InstallPosmLineDto } from './dto/create-installation.dto';

/** JSON-safe conversion (Dates → ISO, strips undefined) for the AuditLog / Json columns. */
const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

/** A media reference the UI can render: object key + auth-gated relative view-path. */
export interface MediaRef {
  key: string;
  viewPath: string;
  geo: { lat: number; lng: number; accuracy?: number } | null;
}

/** The computed, integrity-checked create payload for one InstallPosm row. */
interface PreparedInstallPosm {
  reccePosmId: string;
  photo: Prisma.InputJsonValue;
  captureLat: number | null;
  captureLng: number | null;
  geoFenceOk: boolean | null;
  distanceFromRecce: number | null;
  beforeAfterDiffOk: boolean | null;
  qualityFlags: Prisma.InputJsonValue;
  hash: string | null;
  /** B3: this photo is an exact-hash duplicate already seen elsewhere (hard-block reuse). */
  duplicate: boolean;
}

/** prepare() result: the per-POSM payloads + a representative submission capture time. */
interface PreparedInstallation {
  posms: PreparedInstallPosm[];
  capturedAt: Date | null;
}

/**
 * InstallationService — the Installation field-capture stage (Wave 2 CAPTURE lane). Owns the
 * state transition **∅ → SUBMITTED**. The AUDIT decision (AUDIT_APPROVED / AUDIT_REJECTED) is
 * a DIFFERENT lane (audit-review). This service COMPUTES + PERSISTS the integrity signals the
 * auditor later reads: per-photo geoFenceOk, distanceFromRecce, beforeAfterDiffOk, qualityFlags.
 *
 * SECURITY / RULES enforced on every path:
 *   - Only a VENDOR_FIELD caller (controller @Roles floor) whose OWN vendor services the site
 *     may submit — fail-closed via `vendorScope`; a foreign/other-vendor/other-tenant site is
 *     INVISIBLE (404).
 *   - The site must be ACTIVE.
 *   - Installation is allowed ONLY when the site's recce is ASM-APPROVED AND HO-APPROVED (else 409).
 *   - Exactly one photo per recce POSM (1:1, complete): a missing photo is a HARD block; an
 *     unknown/duplicate reccePosmId is rejected.
 *   - One installation per recce (`Installation.recceId @unique`): a second submit → 409.
 *   - A photo OUTSIDE the fence is a HARD 403 when the tenant fence is enabled (flag otherwise).
 */
@Injectable()
export class InstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: PosmMediaService,
    private readonly integrity: CaptureIntegrityService,
  ) {}

  // ── Submit (∅ → SUBMITTED) ─────────────────────────────────────────────────────
  async create(user: JwtPayload, dto: CreateInstallationDto) {
    const clientId = user.clientId;
    const site = await this.loadOwnedActiveSite(user, dto.siteId);

    // R1 — installation is recce-KEYED, not site-keyed (an outlet can now carry many recces: 1 app
    // + N manual). When `recceId` is supplied the installer targets THAT recce (scoped to the
    // owned site, so a foreign/other-site recce is invisible → treated as not installable). When
    // omitted we fall back to the outlet's single APP recce (back-compat). `include` auto-selects
    // every Recce scalar, so `status` / `hoReviewStatus` ride along here.
    const recce = dto.recceId
      ? await this.prisma.recce.findFirst({
          where: { id: dto.recceId, clientId, siteId: site.id },
          include: { posms: true, installation: { select: { id: true } } },
        })
      : await this.prisma.recce.findFirst({
          where: { clientId, siteId: site.id, recceMode: RecceMode.APP },
          include: { posms: true, installation: { select: { id: true } } },
        });
    // The chosen recce must exist, be ASM-APPROVED, AND HO-APPROVED (the two-stage gate) — else 409.
    if (
      !recce ||
      recce.status !== RecceStatus.APPROVED ||
      recce.hoReviewStatus !== HoReviewStatus.APPROVED
    ) {
      throw new ConflictException(
        dto.recceId
          ? 'The selected recce is not installable (not found on this outlet, or not HO-approved).'
          : "Installation requires the outlet's recce to be HO-approved first.",
      );
    }
    if (recce.installation) {
      throw new ConflictException('This recce already has an installation submitted.');
    }

    this.assertOnePerReccePosm(recce.posms, dto.posms);

    const prepared = await this.prepare(clientId, site, recce.posms, dto.posms);

    // B3 HARD-BLOCK install-photo reuse: an install photo that is ≈identical to its linked recce
    // photo (beforeAfterDiffOk === false) OR an exact-hash duplicate already seen elsewhere
    // (duplicate === true) is a REJECTION, not a soft flag. Reusing the recce photo as the
    // install "after" is the core fraud this pipeline exists to stop. (blur / lowLight /
    // overexposed / lowAccuracy stay SOFT flags — enforced nowhere here.)
    const reused = prepared.posms.find((p) => p.beforeAfterDiffOk === false || p.duplicate === true);
    if (reused) {
      throw new ConflictException(
        reused.beforeAfterDiffOk === false
          ? 'An installation photo is identical to its recce photo — capture a real post-installation photo.'
          : 'An installation photo has already been used on another submission — capture a fresh photo at the outlet.',
      );
    }

    let installation;
    try {
      installation = await this.prisma.$transaction(async (tx) => {
        const created = await tx.installation.create({
          data: {
            clientId,
            siteId: site.id,
            recceId: recce.id,
            submittedById: user.sub,
            status: InstallationStatus.SUBMITTED,
            version: 1,
            capturedAt: prepared.capturedAt,
            posms: {
              create: prepared.posms.map((p) => ({
                reccePosmId: p.reccePosmId,
                photo: p.photo,
                captureLat: p.captureLat,
                captureLng: p.captureLng,
                geoFenceOk: p.geoFenceOk,
                distanceFromRecce: p.distanceFromRecce,
                beforeAfterDiffOk: p.beforeAfterDiffOk,
                qualityFlags: p.qualityFlags,
              })),
            },
          },
          include: this.detailInclude(),
        });
        const hashes = prepared.posms.map((p) => p.hash).filter((h): h is string => !!h);
        if (hashes.length > 0) {
          // hardBlock: a cross-submission photo reuse (incl. the concurrent read-then-write race
          // the pre-read dup check cannot catch) collides on the (clientId, hash) unique → P2002,
          // rolling back this create. INSTALL is the money path, so a duplicate is a HARD block.
          await this.media.recordImageHashes(
            tx, clientId, { ownerKind: 'INSTALL', ownerId: created.id }, hashes, { hardBlock: true },
          );
        }
        await tx.auditLog.create({
          data: {
            actorId: user.sub,
            action: 'CREATE',
            entityType: 'INSTALLATION',
            entityId: created.id,
            newValues: toJson({ status: created.status, siteId: site.id, recceId: recce.id }),
            metadata: { clientId, event: 'INSTALLATION_SUBMIT' } as Prisma.InputJsonValue,
          },
        });
        return created;
      });
    } catch (e) {
      // Two P2002 sources inside the transaction, distinguished by the violated constraint's
      // columns (meta.target):
      //   - the ImageHash (clientId, hash) unique  → a duplicate/reused photo (the cross-
      //     submission race Fix 2 closes) → HARD block, same message as the pre-read dup block.
      //   - the Installation.recceId @unique       → a concurrent one-install-per-recce submit.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (this.isImageHashConflict(e)) {
          throw new ConflictException(
            'An installation photo has already been used on another submission — capture a fresh photo at the outlet.',
          );
        }
        throw new ConflictException('This recce already has an installation (concurrent submit).');
      }
      throw e;
    }

    return this.present(installation);
  }

  // ── Installable recces for an outlet (the field install picker — R1) ─────────────
  /**
   * List the outlet's INSTALLABLE recces — APPROVED + HO-APPROVED with no installation yet — so the
   * field exec can pick WHICH recce they are installing (an outlet may have 1 app + N manual recces).
   * Vendor-scoped via the owned-active-site load (a foreign/other-vendor outlet → 404). Each entry
   * carries `recceMode` + a short element summary (POSM type names) for the picker.
   */
  async installable(user: JwtPayload, siteId: string) {
    const site = await this.loadOwnedActiveSite(user, siteId);
    const recces = await this.prisma.recce.findMany({
      where: {
        clientId: user.clientId,
        siteId: site.id,
        status: RecceStatus.APPROVED,
        hoReviewStatus: HoReviewStatus.APPROVED,
        installation: { is: null }, // not yet installed
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        posms: {
          orderBy: { slotNo: 'asc' },
          select: { slotNo: true, posmType: { select: { id: true, code: true, name: true } } },
        },
      },
    });

    return {
      recces: recces.map((r) => ({
        id: r.id,
        recceMode: r.recceMode,
        version: r.version,
        // Same outlet for every row (siteId-scoped), but the field picker labels/groups each option
        // by outlet, so it carries the outlet identity per recce (matches the FE InstallableRecce).
        site: { id: site.id, code: site.code, name: site.name, town: site.town },
        capturedAt: r.capturedAt,
        receivedAt: r.receivedAt,
        posmCount: r.posms.length,
        // Short element summary for the picker row (e.g. "Board, Shelf Strip").
        elements: r.posms.map((p) => p.posmType.name),
        posms: r.posms.map((p) => ({ slotNo: p.slotNo, posmType: p.posmType })),
      })),
    };
  }

  // ── Get one (with POSM lines, both photos' view-paths, integrity signals) ────────
  async get(user: JwtPayload, id: string) {
    const scope = this.scopeWhere(user);
    if (scope === null) throw new NotFoundException('Installation not found');
    const installation = await this.prisma.installation.findFirst({
      where: { id, ...scope },
      include: this.detailInclude(),
    });
    if (!installation) throw new NotFoundException('Installation not found');
    return this.present(installation);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Compute the integrity signals + create payload for every InstallPosm line. Fetches both
   * the install and the linked recce photo bytes (before≠after diff), rolls up the per-photo
   * geo-fence (HARD 403 on an outside fix when the fence is enabled), and pre-resolves the
   * duplicate flag against the shared ImageHash store.
   */
  private async prepare(
    clientId: string,
    site: { lat: Prisma.Decimal | null; lng: Prisma.Decimal | null },
    reccePosms: { id: string; photo: unknown }[],
    lines: InstallPosmLineDto[],
  ): Promise<PreparedInstallation> {
    // Media keys must belong to THIS tenant's media folder (key-ownership guard).
    for (const l of lines) {
      const { key } = readMediaValue(l.photo);
      if (!key || !key.startsWith(`posm-media/${clientId}/`)) {
        throw new BadRequestException('A photo key does not belong to this tenant.');
      }
    }

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { settings: true },
    });
    const config = readPosmCaptureConfig(client?.settings);
    const accuracyCapMeters = readGpsAccuracyCapMeters(client?.settings);
    const reference =
      site.lat != null && site.lng != null ? { lat: Number(site.lat), lng: Number(site.lng) } : null;
    // One server clock read for the whole submission (B6 clock-skew reference).
    const receivedAt = new Date();

    const recceById = new Map(reccePosms.map((r) => [r.id, r]));

    // Pre-resolve the cross-submission duplicate flag: compute install-photo hashes now and
    // check the shared ImageHash store (no self rows exist yet — this installation is uncreated).
    const installBytes = new Map<string, Buffer | null>();
    const installHash = new Map<string, string | null>();
    for (const l of lines) {
      const { key } = readMediaValue(l.photo);
      const bytes = await this.integrity.fetchImageBytes(key);
      installBytes.set(l.reccePosmId, bytes);
      installHash.set(l.reccePosmId, bytes ? this.integrity.hash(bytes) : null);
    }
    const allHashes = [...installHash.values()].filter((h): h is string => !!h);
    const dupSet = new Set<string>();
    if (allHashes.length > 0) {
      const seen = await this.prisma.imageHash.findMany({
        where: { clientId, hash: { in: [...new Set(allHashes)] } },
        select: { hash: true },
      });
      for (const s of seen) dupSet.add(s.hash);
    }

    let hardFail = false;
    let hardFailOutside = false;
    let capturedAt: Date | null = null;
    const out: PreparedInstallPosm[] = [];
    for (const l of lines) {
      const rp = recceById.get(l.reccePosmId)!; // presence guaranteed by assertOnePerReccePosm
      const installGeo = readMediaValue(l.photo).geo;
      const recceGeo = readMediaValue(rp.photo).geo;

      // Per-photo fence verdict + representative fix (single-photo aggregate). B1/B8: an OUTSIDE
      // fix OR an unverifiable one (missing / invalid / over-accuracy-cap) fails CLOSED when the
      // fence is enabled and the site has a reference.
      const agg = aggregatePhotoFence([{ geo: installGeo }], reference, config.geoFence.radiusMeters, {
        accuracyCapMeters,
      });
      if (config.geoFence.enabled && (agg.anyOutside || agg.anyUnverifiable)) {
        hardFail = true;
        if (agg.anyOutside) hardFailOutside = true;
      }

      // Distance from the linked recce photo (both fixes must be valid).
      const distanceFromRecce =
        isValidGeo(installGeo) && isValidGeo(recceGeo)
          ? haversineMeters({ lat: installGeo.lat, lng: installGeo.lng }, { lat: recceGeo.lat, lng: recceGeo.lng })
          : null;

      // B2 three-way geo cross-check (reviewer flags): site↔recce, site↔install, recce↔install.
      const siteToRecceMeters =
        reference && isValidGeo(recceGeo)
          ? haversineMeters({ lat: recceGeo.lat, lng: recceGeo.lng }, reference) : null;
      const siteToInstallMeters =
        reference && isValidGeo(installGeo)
          ? haversineMeters({ lat: installGeo.lat, lng: installGeo.lng }, reference) : null;
      const geoCrossCheck =
        siteToInstallMeters !== null && siteToInstallMeters > config.geoFence.radiusMeters;

      // B6 clock-skew (reviewer flag): this install photo's shutter time vs. server receive time.
      const clockSkew = this.integrity.isClockSkewed(installGeo?.capturedAt, receivedAt);

      // Representative submission capture time — the latest install shutter time we can parse.
      if (installGeo?.capturedAt && !Number.isNaN(Date.parse(installGeo.capturedAt))) {
        const t = new Date(installGeo.capturedAt);
        if (!capturedAt || t > capturedAt) capturedAt = t;
      }

      // before≠after perceptual diff (both byte sources required, else null/unverifiable).
      const recceBytes = await this.integrity.fetchImageBytes(readMediaValue(rp.photo).key);
      const beforeAfterDiffOk = await this.integrity.beforeAfterDiffOk(recceBytes, installBytes.get(l.reccePosmId) ?? null);

      const hash = installHash.get(l.reccePosmId) ?? null;
      const duplicate = hash ? dupSet.has(hash) : false;
      const baseFlags = await this.integrity.qualityFlags(installBytes.get(l.reccePosmId) ?? null, {
        duplicate,
        accuracy: installGeo?.accuracy,
      });
      // The soft image flags (blur/lowLight/overexposed/duplicate/lowAccuracy) + the submission
      // anti-fraud signals (B2/B6) merged into the persisted per-POSM qualityFlags the auditor
      // reads. These are FLAGS, not blocks (the hard reuse block for beforeAfterDiffOk===false /
      // duplicate is enforced in create()).
      const qualityFlags = {
        ...baseFlags,
        clockSkew,
        geoCrossCheck,
        siteToRecceMeters,
        siteToInstallMeters,
        recceToInstallMeters: distanceFromRecce,
      };

      out.push({
        reccePosmId: l.reccePosmId,
        photo: this.photoJson(l.photo),
        captureLat: agg.worst?.lat ?? null,
        captureLng: agg.worst?.lng ?? null,
        geoFenceOk: agg.geoFenceOk,
        distanceFromRecce,
        beforeAfterDiffOk,
        qualityFlags: toJson(qualityFlags),
        hash,
        duplicate,
      });
    }

    if (hardFail) {
      throw new ForbiddenException(
        hardFailOutside
          ? 'A photo was captured outside the outlet geo-fence. Re-capture at the outlet.'
          : 'A photo has no verifiable in-fence GPS fix (missing, invalid, or low-accuracy). Re-capture at the outlet with location enabled.',
      );
    }

    return { posms: out, capturedAt };
  }

  /**
   * Does this P2002 come from the ImageHash (clientId, hash) unique (a duplicate photo) rather
   * than the Installation.recceId unique? Prisma reports the violated constraint's columns/name in
   * `meta.target`; the hash unique is the only one carrying a `hash` column, so a substring match
   * cleanly distinguishes the two (recceId target has no 'hash').
   */
  private isImageHashConflict(e: Prisma.PrismaClientKnownRequestError): boolean {
    const target = (e.meta as { target?: unknown } | undefined)?.target;
    const asText = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return asText.includes('hash');
  }

  /** The base `where` a caller is confined to, or null = FAIL-CLOSED (match nothing). */
  private scopeWhere(user: JwtPayload): Prisma.InstallationWhereInput | null {
    const where: Prisma.InstallationWhereInput = {};
    const scope = tenantScope(user);
    if (scope !== undefined) where.clientId = scope;

    if (user.role === 'VENDOR_FIELD' || user.role === 'VENDOR_HO') {
      const v = vendorScope(user);
      if (!v) return null;
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

  /**
   * Enforce the 1:1 completeness contract: exactly one install line per recce POSM, no
   * unknown ids, no duplicates, and NO missing photo (a HARD block).
   */
  private assertOnePerReccePosm(
    reccePosms: { id: string }[],
    lines: InstallPosmLineDto[],
  ) {
    const recceIds = new Set(reccePosms.map((r) => r.id));
    const seen = new Set<string>();
    // "install one, get paid for two": one uploaded photo must not fulfil multiple POSM lines.
    // The before≠after / duplicate-store checks miss this because the SAME key differs from its
    // recce photo (ok) and is absent from the pre-existing store (ok). Reject the same photo key
    // reused across lines of THIS submission BEFORE any write.
    const seenKeys = new Set<string>();
    for (const l of lines) {
      if (!recceIds.has(l.reccePosmId)) {
        throw new BadRequestException('A reccePosmId is not part of this outlet\'s approved recce.');
      }
      if (seen.has(l.reccePosmId)) {
        throw new BadRequestException('Two install photos target the same recce Element.');
      }
      seen.add(l.reccePosmId);
      const { key } = readMediaValue(l.photo);
      if (key) {
        if (seenKeys.has(key)) {
          throw new BadRequestException(
            'The same photo is used on more than one Element line — capture a distinct photo per Element.',
          );
        }
        seenKeys.add(key);
      }
    }
    // Missing-required-photo → HARD block: every recce POSM must be fulfilled.
    for (const r of reccePosms) {
      if (!seen.has(r.id)) {
        throw new BadRequestException('An installation must include a photo for every recce Element.');
      }
    }
  }

  private detailInclude() {
    return {
      site: { select: { id: true, code: true, name: true, town: true, lat: true, lng: true } },
      submittedBy: { select: { id: true, name: true } },
      recce: { select: { id: true, status: true, version: true } },
      posms: {
        include: {
          reccePosm: {
            include: { posmType: { select: { id: true, code: true, name: true } } },
          },
        },
      },
    };
  }

  /** Shape an installation (with includes) into the API response, resolving media view-paths. */
  private present(inst: {
    id: string; status: InstallationStatus; version: number;
    capturedAt: Date | null; receivedAt: Date;
    auditedAt: Date | null; rejectionReasonCode: unknown; rejectionReason: string | null;
    site: { id: string; code: string; name: string; town: string | null; lat: Prisma.Decimal | null; lng: Prisma.Decimal | null };
    submittedBy: { id: string; name: string };
    recce: { id: string; status: RecceStatus; version: number };
    posms: {
      id: string; reccePosmId: string; photo: unknown;
      captureLat: Prisma.Decimal | null; captureLng: Prisma.Decimal | null;
      geoFenceOk: boolean | null; distanceFromRecce: Prisma.Decimal | null;
      beforeAfterDiffOk: boolean | null; qualityFlags: unknown;
      reccePosm: { id: string; slotNo: number; dimensions: unknown; photo: unknown; markup: unknown; posmType: { id: string; code: string; name: string } };
    }[];
  }) {
    return {
      id: inst.id,
      status: inst.status,
      version: inst.version,
      site: {
        id: inst.site.id, code: inst.site.code, name: inst.site.name, town: inst.site.town,
        lat: this.dec(inst.site.lat), lng: this.dec(inst.site.lng),
      },
      submittedBy: inst.submittedBy,
      recce: inst.recce,
      capturedAt: inst.capturedAt,
      receivedAt: inst.receivedAt,
      auditedAt: inst.auditedAt,
      rejectionReasonCode: inst.rejectionReasonCode ?? null,
      rejectionReason: inst.rejectionReason ?? null,
      posms: inst.posms.map((p) => ({
        id: p.id,
        reccePosmId: p.reccePosmId,
        posmType: p.reccePosm.posmType,
        recceSlotNo: p.reccePosm.slotNo,
        recceDimensions: p.reccePosm.dimensions,
        installPhoto: this.mediaRef(p.photo),
        reccePhoto: this.mediaRef(p.reccePosm.photo),
        recceMarkup: p.reccePosm.markup ?? null,
        integrity: {
          geoFenceOk: p.geoFenceOk,
          distanceFromRecce: this.dec(p.distanceFromRecce),
          beforeAfterDiffOk: p.beforeAfterDiffOk,
          captureLat: this.dec(p.captureLat),
          captureLng: this.dec(p.captureLng),
          qualityFlags: p.qualityFlags ?? null,
        },
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

  private photoJson(photo: { key: string; geo?: unknown }): Prisma.InputJsonValue {
    const { key, geo } = readMediaValue(photo);
    return geo ? { key, geo: toJson(geo) } : { key };
  }

  private dec(v: Prisma.Decimal | null): number | null {
    return v != null ? Number(v) : null;
  }
}
