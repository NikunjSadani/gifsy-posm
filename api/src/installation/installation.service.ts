import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, InstallationStatus, RecceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { tenantScope, vendorScope } from '../common/tenant-scope';
import { PosmMediaService } from '../capture/posm-media.service';
import { readMediaValue } from '../capture/visibility-types';
import { haversineMeters, isValidGeo } from '../capture/geo-fence.helper';
import { CaptureIntegrityService } from '../capture-integrity/capture-integrity.service';
import { readPosmCaptureConfig } from '../capture-integrity/posm-config.helper';
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
 *   - Installation is allowed ONLY when the site's recce is APPROVED (else 409).
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

    // The site's recce must exist AND be APPROVED (the ASM gate) — else 409.
    const recce = await this.prisma.recce.findUnique({
      where: { clientId_siteId: { clientId, siteId: site.id } },
      include: { posms: true, installation: { select: { id: true } } },
    });
    if (!recce || recce.status !== RecceStatus.APPROVED) {
      throw new ConflictException(
        "Installation requires the site's recce to be APPROVED first.",
      );
    }
    if (recce.installation) {
      throw new ConflictException('This recce already has an installation submitted.');
    }

    this.assertOnePerReccePosm(recce.posms, dto.posms);

    const prepared = await this.prepare(clientId, site, recce.posms, dto.posms);

    const installation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.installation.create({
        data: {
          clientId,
          siteId: site.id,
          recceId: recce.id,
          submittedById: user.sub,
          status: InstallationStatus.SUBMITTED,
          version: 1,
          posms: {
            create: prepared.map((p) => ({
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
      const hashes = prepared.map((p) => p.hash).filter((h): h is string => !!h);
      if (hashes.length > 0) {
        await this.media.recordImageHashes(
          tx, clientId, { ownerKind: 'INSTALL', ownerId: created.id }, hashes,
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

    return this.present(installation);
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
  ): Promise<PreparedInstallPosm[]> {
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
    const reference =
      site.lat != null && site.lng != null ? { lat: Number(site.lat), lng: Number(site.lng) } : null;

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

    let anyOutside = false;
    const out: PreparedInstallPosm[] = [];
    for (const l of lines) {
      const rp = recceById.get(l.reccePosmId)!; // presence guaranteed by assertOnePerReccePosm
      const installGeo = readMediaValue(l.photo).geo;
      const recceGeo = readMediaValue(rp.photo).geo;

      // Per-photo fence verdict + representative fix (single-photo aggregate).
      const agg = aggregatePhotoFence([{ geo: installGeo }], reference, config.geoFence.radiusMeters);
      if (config.geoFence.enabled && agg.anyOutside) anyOutside = true;

      // Distance from the linked recce photo (both fixes must be valid).
      const distanceFromRecce =
        isValidGeo(installGeo) && isValidGeo(recceGeo)
          ? haversineMeters({ lat: installGeo.lat, lng: installGeo.lng }, { lat: recceGeo.lat, lng: recceGeo.lng })
          : null;

      // before≠after perceptual diff (both byte sources required, else null/unverifiable).
      const recceBytes = await this.integrity.fetchImageBytes(readMediaValue(rp.photo).key);
      const beforeAfterDiffOk = this.integrity.beforeAfterDiffOk(recceBytes, installBytes.get(l.reccePosmId) ?? null);

      const hash = installHash.get(l.reccePosmId) ?? null;
      const qualityFlags = this.integrity.qualityFlags(installBytes.get(l.reccePosmId) ?? null, {
        duplicate: hash ? dupSet.has(hash) : false,
        accuracy: installGeo?.accuracy,
      });

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
      });
    }

    if (anyOutside) {
      throw new ForbiddenException(
        'A photo was captured outside the site geo-fence. Re-capture at the site.',
      );
    }

    return out;
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
      throw new NotFoundException('Site not found');
    }
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, clientId: user.clientId, ...(v ? { vendorId: v } : {}) },
    });
    if (!site) throw new NotFoundException('Site not found');
    if (site.status !== 'ACTIVE') throw new BadRequestException('Site is not active');
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
    for (const l of lines) {
      if (!recceIds.has(l.reccePosmId)) {
        throw new BadRequestException('A reccePosmId is not part of this site\'s approved recce.');
      }
      if (seen.has(l.reccePosmId)) {
        throw new BadRequestException('Two install photos target the same recce POSM.');
      }
      seen.add(l.reccePosmId);
    }
    // Missing-required-photo → HARD block: every recce POSM must be fulfilled.
    for (const r of reccePosms) {
      if (!seen.has(r.id)) {
        throw new BadRequestException('An installation must include a photo for every recce POSM.');
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
