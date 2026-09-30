import { Module } from '@nestjs/common';
import { HoReviewController } from './ho-review.controller';
import { HoReviewService } from './ho-review.service';

/**
 * HO/Admin escalation module — reviews audit-rejected installations. Depends only on the
 * @Global PrismaModule. Register it in AppModule's `imports` to expose /v1/ho-review.
 */
@Module({
  controllers: [HoReviewController],
  providers: [HoReviewService],
  exports: [HoReviewService],
})
export class HoReviewModule {}
