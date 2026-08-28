import { Module } from '@nestjs/common';
import { ManualController } from './manual.controller';
import { ManualService } from './manual.service';

/**
 * Manual-workflow module — the ad-hoc admin-defined task pipeline (author → vendor submit →
 * admin approve/reject), SEPARATE from the recce→install pipeline. Depends only on the @Global
 * PrismaModule (the capture form engine + media helpers are pure imports). Register it in
 * AppModule's `imports` to expose /v1/manual.
 */
@Module({
  controllers: [ManualController],
  providers: [ManualService],
  exports: [ManualService],
})
export class ManualModule {}
