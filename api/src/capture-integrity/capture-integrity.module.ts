import { Global, Module } from '@nestjs/common';
import { CaptureIntegrityService } from './capture-integrity.service';

/**
 * Capture-integrity module — provides CaptureIntegrityService (byte-level image checks:
 * fetch bytes, content-hash, before≠after diff, blur/exposure quality flags) to the Recce
 * and Installation lanes. Its only dependencies are the @Global StorageService +
 * PosmMediaService, so it re-imports nothing. @Global so both pipeline lanes inject it
 * without an explicit import. Register in AppModule's `imports`.
 */
@Global()
@Module({
  providers: [CaptureIntegrityService],
  exports: [CaptureIntegrityService],
})
export class CaptureIntegrityModule {}
