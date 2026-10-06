import { Module } from '@nestjs/common';
import { RecceHoReviewController } from './recce-ho-review.controller';
import { RecceHoReviewService } from './recce-ho-review.service';

/**
 * Recce-HO approval module — reviews ASM-approved recces before installation is unlocked. Depends
 * only on the @Global PrismaModule. Registered in AppModule's `imports` to expose
 * /v1/recce-ho-review.
 */
@Module({
  controllers: [RecceHoReviewController],
  providers: [RecceHoReviewService],
  exports: [RecceHoReviewService],
})
export class RecceHoReviewModule {}
