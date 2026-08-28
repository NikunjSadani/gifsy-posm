import { Module } from '@nestjs/common';
import { AuditReviewController } from './audit-review.controller';
import { AuditReviewService } from './audit-review.service';

/**
 * Wave-2 Auditor review module (installation audit — per-image, no bulk). Depends only on the
 * @Global PrismaModule. Register it in AppModule's `imports` to expose /v1/audit.
 */
@Module({
  controllers: [AuditReviewController],
  providers: [AuditReviewService],
  exports: [AuditReviewService],
})
export class AuditReviewModule {}
