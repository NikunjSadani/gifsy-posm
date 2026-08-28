import { Module } from '@nestjs/common';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';

/**
 * Wave-2 ASM approval module (recce review + gate that unlocks installation).
 * Depends only on the @Global PrismaModule. Register it in AppModule's `imports` to expose
 * /v1/approval.
 */
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
