import { Module } from '@nestjs/common';
import { RecceController } from './recce.controller';
import { RecceService } from './recce.service';

/**
 * Wave-2 Recce capture module. Depends on the @Global PrismaModule, CaptureModule
 * (PosmMediaService) and CaptureIntegrityModule (CaptureIntegrityService) — all global, so
 * nothing is re-imported here. Register in AppModule's `imports` to expose /v1/recce.
 */
@Module({
  controllers: [RecceController],
  providers: [RecceService],
  exports: [RecceService],
})
export class RecceModule {}
