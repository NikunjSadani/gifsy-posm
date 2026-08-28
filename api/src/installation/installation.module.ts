import { Module } from '@nestjs/common';
import { InstallationController } from './installation.controller';
import { InstallationService } from './installation.service';

/**
 * Wave-2 Installation capture module. Depends on the @Global PrismaModule, CaptureModule
 * (PosmMediaService) and CaptureIntegrityModule (CaptureIntegrityService) — all global, so
 * nothing is re-imported here. Register in AppModule's `imports` to expose /v1/installation.
 */
@Module({
  controllers: [InstallationController],
  providers: [InstallationService],
  exports: [InstallationService],
})
export class InstallationModule {}
