import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
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
  constructor(private readonly storage: StorageService) {}

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
   * transaction. Hashes are de-duplicated within the call; the insert skips duplicates.
   */
  async recordImageHashes(
    tx: Prisma.TransactionClient,
    clientId: string,
    owner: { ownerKind: string; ownerId: string },
    hashes: string[],
  ): Promise<{ dupHashes: string[] }> {
    const unique = [...new Set(hashes.filter((h) => typeof h === 'string' && h.length > 0))];
    if (unique.length === 0) return { dupHashes: [] };

    const existing = await tx.imageHash.findMany({
      where: {
        clientId,
        hash: { in: unique },
        NOT: { ownerKind: owner.ownerKind, ownerId: owner.ownerId },
      },
      select: { hash: true },
    });
    const dupHashes = [...new Set(existing.map((r) => r.hash))];

    await tx.imageHash.createMany({
      data: unique.map((hash) => ({
        clientId,
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
        hash,
      })),
      skipDuplicates: true,
    });

    return { dupHashes };
  }
}
