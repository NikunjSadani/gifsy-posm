import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

/**
 * Wave-1 Site master module. Depends only on the @Global PrismaModule (no other
 * providers). Register it in AppModule's `imports` to expose /v1/sites.
 */
@Module({
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
