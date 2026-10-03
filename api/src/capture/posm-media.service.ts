import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { platformWide } from '../common/tenant-scope';
import { sniffFileType } from '../common/file-signature';

/** Media types allowed to render inline; anything else is forced to a download. */
const INLINE_SAFE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

/** Object-key tenant folder for all POSM capture media (recce/install photos + samples). */
const MEDIA_FOLDER_PREFIX = 'posm-media/';

/**
 * PosmMediaService — POSM capture media upload + auth-gated view, plus the duplicate-photo
 * hash primitives (5 MB cap, magic-byte sniff, tenant-foldered key, auth-gated inline-safe
 * stream, per-image SHA-256 content hashing for the cross-site duplicate flag).
 *
 * Renamed + generalised from the loyalty VisibilityMediaService (folder prefix
 * `visibility-media/` → `posm-media/`; dup-hash writes the POSM `ImageHash` model keyed by
 * ownerKind/ownerId).
 */
@Injectable()
export class PosmMediaService {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The vendor that OWNS a recce/install EVIDENCE photo, resolved from the ReccePosm/InstallPosm whose
   * `photo.key` matches (the key itself has no vendor segment). Returns the owning site's vendorId, or
   * `null` when the key is not a recce/install photo — a tenant-shared POSM-type catalogue image, or a
   * fresh un-submitted upload — which is NOT vendor-owned and stays tenant-viewable.
   */
  private async resolveOwnerVendorId(key: string): Promise<string | null> {
    const rp = await this.prisma.reccePosm.findFirst({
      where: { photo: { path: ['key'], equals: key } },
      select: { recce: { select: { site: { select: { vendorId: true } } } } },
    });
    if (rp?.recce?.site) return rp.recce.site.vendorId ?? null;

    const ip = await this.prisma.installPosm.findFirst({
      where: { photo: { path: ['key'], equals: key } },
      select: { installation: { select: { site: { select: { vendorId: true } } } } },
    });
    return ip?.installation?.site?.vendorId ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Upload (magic-byte guarded) + auth-gated view
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Validate + store an uploaded image/PDF and return its stored object key. The client
   * mimetype is untrusted — the real type is derived from the leading bytes (sniffFileType);
   * the key is tenant-foldered so viewMedia can enforce tenant from the path.
   */
  async uploadMedia(
    user: JwtPayload,
    file: Express.Multer.File,
  ): Promise<{ key: string; fileUrl: string; mimeType: string; fileSizeBytes: number }> {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!file.buffer?.length) throw new BadRequestException('Empty file');
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) throw new BadRequestException('File too large (max 5 MB)');

    const sniffed = sniffFileType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException('Unsupported or corrupt file. Upload a JPG, PNG, WEBP, GIF, or PDF.');
    }

    const key = this.storage.generateKey(
      `${MEDIA_FOLDER_PREFIX}${user.clientId}`,
      file.originalname || `capture.${sniffed.ext}`,
    );
    const fileUrl = await this.storage.uploadFile(file.buffer, key, sniffed.mime);
    return { key, fileUrl, mimeType: sniffed.mime, fileSizeBytes: file.size };
  }

  /**
   * Auth-gated media stream. A SAFE-mime allowlist decides inline vs. attachment; tenant is
   * enforced from the object key's tenant folder (`posm-media/<clientId>/…`) — a GIFSY_ADMIN
   * is the cross-tenant operator, every other caller is pinned to its own tenant. Any failure → 404.
   */
  async viewMedia(
    user: JwtPayload,
    key: string,
  ): Promise<{ bytes: Buffer; contentType: string; inline: boolean }> {
    const deny = () => new NotFoundException();
    if (!key || typeof key !== 'string' || !key.startsWith(MEDIA_FOLDER_PREFIX)) throw deny();

    const keyClientId = key.split('/')[1];
    if (!keyClientId) throw deny();
    // Un-assumed GIFSY reads any tenant; every other caller — incl. an ASSUMED operator — is
    // pinned to its (assumed) tenant folder.
    if (!platformWide(user) && keyClientId !== user.clientId) throw deny();

    // VENDOR confinement on recce/install EVIDENCE photos: the tenant check alone would let one vendor
    // stream another vendor's recce/install evidence within the same tenant (a confidentiality leak in
    // an anti-fraud product). So a vendor caller may not view a recce/install photo owned by a DIFFERENT
    // vendor. Media with no owning recce/install — tenant-shared POSM-type catalogue images, a rep's own
    // pre-submit upload — has `ownerVendorId === null` and stays tenant-viewable (don't break those).
    // Admin/ASM/auditor/GIFSY are not vendor-confined (they review across vendors).
    if (user.role === 'VENDOR_FIELD' || user.role === 'VENDOR_HO') {
      const ownerVendorId = await this.resolveOwnerVendorId(key);
      if (ownerVendorId && ownerVendorId !== user.vendorId) throw deny();
    }

    const file = await this.storage.downloadBytes(key);
    if (!file) throw deny();

    const rawMime = (file.contentType || '').toLowerCase();
    const inline = INLINE_SAFE_MIME.has(rawMime);
    return { bytes: file.bytes, contentType: inline ? rawMime : 'application/octet-stream', inline };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Duplicate-photo hashing (schema model ImageHash)
  // ───────────────────────────────────────────────────────────────────────────

  /** SHA-256 hex digest of a photo's raw bytes — the per-image content fingerprint. */
  computeImageHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Record this capture's image hashes and report which of them already appear on a DIFFERENT
   * capture within the same tenant (the duplicate-photo flag).
   *
   * `ownerKind`/`ownerId` identify the owning submission ("RECCE" | "INSTALL" | "MANUAL" + its
   * id). The "seen elsewhere" check runs BEFORE the insert (and excludes this owner's own rows),
   * so a resubmit re-recording the same photo does not flag itself. Runs inside the caller's
   * transaction. Hashes are de-duplicated within the call.
   *
   * The DB carries `@@unique([clientId, hash])`, so an exact-byte reuse of a photo already owned
   * by a DIFFERENT submission collides on insert. This method NEVER re-inserts a hash this SAME
   * owner already recorded (a legitimate re-record, e.g. recce resubmit) — those are filtered out
   * first, so the same-owner case never self-collides.
   *
   * `opts.hardBlock` selects how a cross-owner reuse of a fresh (not-own) hash is handled:
   *   - hardBlock=false (DEFAULT, soft-flag lane, e.g. recce): the colliding insert is SKIPPED
   *     and the reuse is surfaced only as a FLAG in `dupHashes` — the submission still succeeds.
   *   - hardBlock=true (money path, e.g. installation): the insert is NOT skipped, so a
   *     cross-owner reuse OR a concurrent same-hash insert raises Prisma P2002; the caller rolls
   *     back the create and returns a 409. This is what closes the read-then-write duplicate race
   *     that a pre-read dup check alone cannot (both racers read an empty dup-set, both would pass).
   */
  async recordImageHashes(
    tx: Prisma.TransactionClient,
    clientId: string,
    owner: { ownerKind: string; ownerId: string },
    hashes: string[],
    opts?: { hardBlock?: boolean },
  ): Promise<{ dupHashes: string[] }> {
    const unique = [...new Set(hashes.filter((h) => typeof h === 'string' && h.length > 0))];
    if (unique.length === 0) return { dupHashes: [] };

    // Cross-owner occurrences — the "seen elsewhere" duplicate signal (returned as a flag).
    const existing = await tx.imageHash.findMany({
      where: {
        clientId,
        hash: { in: unique },
        NOT: { ownerKind: owner.ownerKind, ownerId: owner.ownerId },
      },
      select: { hash: true },
    });
    const dupHashes = [...new Set(existing.map((r) => r.hash))];

    // Hashes THIS owner already recorded (a legit re-record) must not be re-inserted — under the
    // (clientId, hash) unique that would either self-conflict (hard mode) or be a silent no-op
    // (skip mode). Filter them out so the same-owner re-record is always a clean no-op.
    const own = await tx.imageHash.findMany({
      where: {
        clientId,
        hash: { in: unique },
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
      },
      select: { hash: true },
    });
    const ownSet = new Set(own.map((r) => r.hash));
    const toInsert = unique.filter((h) => !ownSet.has(h));
    if (toInsert.length === 0) return { dupHashes };

    const data = toInsert.map((hash) => ({
      clientId,
      ownerKind: owner.ownerKind,
      ownerId: owner.ownerId,
      hash,
    }));

    if (opts?.hardBlock) {
      // Hard mode: a cross-owner reuse / concurrent duplicate collides on (clientId, hash) → P2002
      // propagates → caller rolls back → 409. Do NOT skipDuplicates (that would swallow the block).
      await tx.imageHash.createMany({ data });
    } else {
      // Soft mode: a duplicate is a FLAG only; the colliding row is skipped, submission succeeds.
      await tx.imageHash.createMany({ data, skipDuplicates: true });
    }

    return { dupHashes };
  }
}
