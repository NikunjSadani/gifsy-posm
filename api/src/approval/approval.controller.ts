import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { ListRecceQueueDto } from './dto/list-recce-queue.dto';
import { RejectRecceDto } from './dto/reject-recce.dto';
import { BulkApproveDto } from './dto/bulk-approve.dto';

/**
 * ASM approval console — Wave 2 REVIEW lane.
 *
 * The global guard chain (JwtAuth → Roles → Tenant → Permission) is applied app-wide; every
 * route declares an explicit @Roles floor. Cross-tenant AND per-site (ASM-territory)
 * confinement is enforced inside the service on every read AND every state transition.
 */
@Controller('approval')
@Roles('ASM', 'CLIENT_ADMIN', 'GIFSY_ADMIN')
export class ApprovalController {
  constructor(private readonly approval: ApprovalService) {}

  /** GET /v1/approval/recces — the SUBMITTED-recce review queue (scoped). */
  @Get('recces')
  listQueue(@CurrentUser() user: JwtPayload, @Query() query: ListRecceQueueDto) {
    return this.approval.listQueue(user, query);
  }

  /** GET /v1/approval/waterfall — the stage-funnel counts, scoped to the caller. */
  @Get('waterfall')
  waterfall(@CurrentUser() user: JwtPayload) {
    return this.approval.waterfall(user);
  }

  /** GET /v1/approval/recces/:id — one scoped recce for the detail view (any status). */
  @Get('recces/:id')
  getRecce(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.approval.getRecce(user, id);
  }

  /** POST /v1/approval/recces/bulk-approve — approve many by id (all scoped; skip out-of-scope). */
  @Post('recces/bulk-approve')
  @HttpCode(HttpStatus.OK)
  bulkApprove(@CurrentUser() user: JwtPayload, @Body() dto: BulkApproveDto) {
    return this.approval.bulkApprove(user, dto);
  }

  /** POST /v1/approval/recces/:id/approve — SUBMITTED → APPROVED (gate that unlocks install). */
  @Post('recces/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.approval.approve(user, id);
  }

  /** POST /v1/approval/recces/:id/reject — SUBMITTED → REJECTED with a required reason code. */
  @Post('recces/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RejectRecceDto,
  ) {
    return this.approval.reject(user, id, dto);
  }
}
