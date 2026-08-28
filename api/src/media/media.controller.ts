import {
  Controller, Get, Post, Header, Query, StreamableFile,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PosmMediaService } from '../capture/posm-media.service';
import { PrismaService } from '../prisma/prisma.service';
import { readMediaValue } from '../capture/visibility-types';
import { watermarkImage } from './watermark.util';

/**
 * Auth-gated media WRITE (upload) + READ (view) — the single HTTP surface the recce/installation/
 * approval/audit lanes reference.
 *
 * Upload: `POST /v1/media/upload` stores the ORIGINAL bytes untouched (PosmMediaService magic-byte
 * sniffs, caps at 5 MB, and tenant-folders the key). The stored object MUST stay original so the
 * duplicate SHA-256 hash, before≠after perceptual diff and per-photo geo controls keep reading the
 * true bytes — so there is NO watermarking at upload.
 *
 * View: `GET /v1/media/view` streams via `<img src="/api/media/view?key=…">`; the platform proxy
 * injects the caller's bearer token, so the global JwtAuthGuard populates `user` and
 * `PosmMediaService.viewMedia` enforces the tenant boundary from the object key's folder (an
 * un-assumed GIFSY_ADMIN reads any tenant). For an IMAGE with resolvable capture provenance, a
 * small evidence watermark is composited ON THE FLY before streaming; the stored object is never
 * modified, so the anti-fraud controls above are unaffected.
 *
 * NOTE (for the pipeline audit): viewMedia scopes by TENANT only, not by vendor — unchanged here.
 */
@Controller('media')
@Roles('GIFSY_ADMIN', 'CLIENT_ADMIN', 'ASM', 'AUDITOR', 'VENDOR_HO', 'VENDOR_FIELD')
export class MediaController {
  constructor(
    private readonly media: PosmMediaService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /v1/media/upload — the capture WRITE path (recce/install photos + samples). Returns the
   * stored object key the submission JSON references. The client mimetype is untrusted:
   * PosmMediaService derives the real type from the leading bytes, caps at 5 MB, and tenant-folders
   * the key. Stores the ORIGINAL bytes (no watermark) — the integrity/dup controls depend on it.
   */
  @Roles('VENDOR_FIELD', 'ASM', 'AUDITOR', 'CLIENT_ADMIN', 'GIFSY_ADMIN')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ key: string }> {
    const { key } = await this.media.uploadMedia(user, file);
    return { key };
  }

  @Get('view')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  async view(
    @CurrentUser() user: JwtPayload,
    @Query('key') key: string,
  ): Promise<StreamableFile> {
    // Tenant enforcement + inline-safe decision live entirely inside viewMedia — unchanged.
    const { bytes, contentType, inline } = await this.media.viewMedia(user, key);

    let outBytes = bytes;
    if (inline && contentType.startsWith('image/')) {
      const caption = await this.resolveCaption(key);
      if (caption) {
        // Composite the evidence strip on the fly. If the bytes are not a decodable image
        // (e.g. webp), watermarkImage returns null and we stream the original untouched.
        const stamped = await watermarkImage(bytes, caption);
        if (stamped) outBytes = stamped;
      }
    }

    return new StreamableFile(outBytes, {
      type: contentType,
      disposition: inline ? 'inline' : 'attachment',
    });
  }

  /**
   * Resolve this photo's capture provenance into a one-line watermark caption by finding the
   * ReccePosm OR InstallPosm whose `photo` JSON `key` equals the requested key (Prisma JSON-path
   * filter). Joins Site (code) + submitter (name) + the photo's geo + capturedAt. Returns `null`
   * for a freshly-uploaded pre-submit photo (no owning row yet) — the caller then serves the
   * original, unwatermarked.
   */
  private async resolveCaption(key: string): Promise<string | null> {
    if (!key) return null;

    const reccePosm = await this.prisma.reccePosm.findFirst({
      where: { photo: { path: ['key'], equals: key } },
      select: {
        photo: true,
        recce: {
          select: {
            capturedAt: true,
            captureLat: true,
            captureLng: true,
            site: { select: { code: true } },
            submittedBy: { select: { name: true } },
          },
        },
      },
    });
    if (reccePosm?.recce) {
      const geo = readMediaValue(reccePosm.photo).geo;
      return this.buildCaption({
        siteCode: reccePosm.recce.site?.code,
        staffName: reccePosm.recce.submittedBy?.name,
        lat: geo?.lat ?? this.dec(reccePosm.recce.captureLat),
        lng: geo?.lng ?? this.dec(reccePosm.recce.captureLng),
        capturedAt: reccePosm.recce.capturedAt,
      });
    }

    const installPosm = await this.prisma.installPosm.findFirst({
      where: { photo: { path: ['key'], equals: key } },
      select: {
        photo: true,
        captureLat: true,
        captureLng: true,
        installation: {
          select: {
            capturedAt: true,
            site: { select: { code: true } },
            submittedBy: { select: { name: true } },
          },
        },
      },
    });
    if (installPosm?.installation) {
      const geo = readMediaValue(installPosm.photo).geo;
      return this.buildCaption({
        siteCode: installPosm.installation.site?.code,
        staffName: installPosm.installation.submittedBy?.name,
        lat: geo?.lat ?? this.dec(installPosm.captureLat),
        lng: geo?.lng ?? this.dec(installPosm.captureLng),
        capturedAt: installPosm.installation.capturedAt,
      });
    }

    return null;
  }

  /** Coerce a Prisma Decimal|null (or number) to a plain number, or undefined. */
  private dec(v: unknown): number | undefined {
    if (v === null || v === undefined) return undefined;
    const n = Number(v as never);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Assemble the pipe-separated caption; missing parts are simply omitted. */
  private buildCaption(p: {
    siteCode?: string | null;
    staffName?: string | null;
    lat?: number;
    lng?: number;
    capturedAt?: Date | null;
  }): string {
    const parts: string[] = [];
    if (p.siteCode) parts.push(p.siteCode);
    if (p.staffName) parts.push(p.staffName);
    if (typeof p.lat === 'number' && typeof p.lng === 'number') {
      parts.push(`${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);
    }
    if (p.capturedAt) parts.push(new Date(p.capturedAt).toISOString());
    // `|` is the separator (the font renders it; a middle-dot is not in the glyph set).
    return parts.join(' | ');
  }
}
