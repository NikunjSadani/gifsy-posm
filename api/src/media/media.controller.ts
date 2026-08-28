import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PosmMediaService } from '../capture/posm-media.service';

/**
 * Auth-gated media view — the single HTTP entry the recce/installation/approval/audit
 * lanes reference as `viewPath = /v1/media/view?key=<urlenc key>`. The browser loads it via
 * `<img src="/api/media/view?key=…">`; the platform proxy injects the caller's bearer token,
 * so the global JwtAuthGuard populates `user` and `PosmMediaService.viewMedia` enforces the
 * tenant boundary from the object key's folder (an un-assumed GIFSY_ADMIN reads any tenant).
 *
 * NOTE (for the pipeline audit): viewMedia currently scopes by TENANT only, not by vendor —
 * a same-tenant vendor role that obtained another vendor's opaque key could view it. Keys are
 * uuid-based, tenant-foldered and only handed to a user for their own captures, so exposure is
 * low, but vendor-scoping of media view is a candidate hardening.
 */
@Controller('media')
@Roles('GIFSY_ADMIN', 'CLIENT_ADMIN', 'ASM', 'AUDITOR', 'VENDOR_HO', 'VENDOR_FIELD')
export class MediaController {
  constructor(private readonly media: PosmMediaService) {}

  @Get('view')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  async view(
    @CurrentUser() user: JwtPayload,
    @Query('key') key: string,
  ): Promise<StreamableFile> {
    const { bytes, contentType, inline } = await this.media.viewMedia(user, key);
    return new StreamableFile(bytes, {
      type: contentType,
      disposition: inline ? 'inline' : 'attachment',
    });
  }
}
