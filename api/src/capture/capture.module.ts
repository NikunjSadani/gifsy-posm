import { Global, Module } from '@nestjs/common';
import { PosmMediaService } from './posm-media.service';

/**
 * The reusable POSM capture toolkit. Provides PosmMediaService (upload + auth-gated view +
 * dup-hash); the pure helpers (visibility-types, visibility-form.helper, geo-fence.helper)
 * are import-only and need no provider. Global so any capture-domain wave (recce/install/
 * manual) can inject the media service without re-importing. Its only dependency is the
 * @Global StorageService.
 */
@Global()
@Module({
  providers: [PosmMediaService],
  exports: [PosmMediaService],
})
export class CaptureModule {}
