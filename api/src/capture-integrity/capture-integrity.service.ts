import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { PosmMediaService } from '../capture/posm-media.service';
import {
  beforeAfterDiffers,
  computeQualityFlags,
  isLowAccuracy,
  QualityFlags,
} from './image-integrity.helper';

/**
 * CaptureIntegrityService — the capture-integrity seam shared by the Recce and Installation
 * lanes. It OWNS the byte-level image checks (fetch raw bytes, content-hash, before≠after
 * perceptual diff, blur/exposure quality flags) and delegates the actual hash primitive to
 * the reused PosmMediaService (it never re-implements or edits it). The pure math lives in
 * `image-integrity.helper` (unit-tested on synthetic buffers); this class is the thin
 * I/O-bound orchestration around it.
 *
 * Depends only on two @Global providers (StorageService, PosmMediaService), so it needs no
 * module imports and is itself provided globally.
 */
@Injectable()
export class CaptureIntegrityService {
  constructor(
    private readonly storage: StorageService,
    private readonly media: PosmMediaService,
  ) {}

  /**
   * Fetch a stored object's raw bytes by key (integrity/hashing read path). Returns null when
   * the key is empty or the object is missing/oversized — callers degrade gracefully (a
   * missing byte source yields null verdicts / no hash rather than throwing).
   */
  async fetchImageBytes(key: string | null | undefined): Promise<Buffer | null> {
    if (!key || typeof key !== 'string') return null;
    const file = await this.storage.downloadBytes(key);
    return file ? file.bytes : null;
  }

  /** SHA-256 content hash of a photo's bytes (delegates to the reused PosmMediaService). */
  hash(bytes: Buffer): string {
    return this.media.computeImageHash(bytes);
  }

  /**
   * before≠after: true when the install photo differs enough from the linked recce photo.
   * Returns null when EITHER byte source is unavailable (unverifiable — a soft flag for the
   * reviewer, never a persisted pass on missing evidence).
   */
  async beforeAfterDiffOk(
    recceBytes: Buffer | null,
    installBytes: Buffer | null,
  ): Promise<boolean | null> {
    if (!recceBytes || !installBytes) return null;
    // beforeAfterDiffers itself returns null when either image is undecodable (unverifiable).
    return beforeAfterDiffers(recceBytes, installBytes);
  }

  /** Assemble the soft quality flags for one install photo (blur/exposure from DECODED pixels + passed signals). */
  async qualityFlags(
    bytes: Buffer | null,
    signals: { duplicate: boolean; accuracy: number | null | undefined },
  ): Promise<QualityFlags> {
    return computeQualityFlags(bytes, {
      duplicate: signals.duplicate,
      lowAccuracy: isLowAccuracy(signals.accuracy),
    });
  }

  /** GPS fix quality helper (exposed so the recce lane can flag low-accuracy fixes too). */
  isLowAccuracy(accuracy: number | null | undefined): boolean {
    return isLowAccuracy(accuracy);
  }
}
