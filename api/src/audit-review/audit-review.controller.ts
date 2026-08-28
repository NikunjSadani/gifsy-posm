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
import { AuditReviewService } from './audit-review.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { ListInstallQueueDto } from './dto/list-install-queue.dto';
import { RejectInstallationDto } from './dto/reject-installation.dto';

/**
 * Auditor console — Wave 2 REVIEW lane.
 *
 * The global guard chain (JwtAuth → Roles → Tenant → Permission) is applied app-wide; every
 * route declares an explicit @Roles floor. Tenant confinement is enforced inside the service
 * on every read AND every state transition. Review is per-image — there is no bulk action.
 */
@Controller('audit')
@Roles('AUDITOR', 'CLIENT_ADMIN', 'GIFSY_ADMIN')
export class AuditReviewController {
  constructor(private readonly audit: AuditReviewService) {}

  /** GET /v1/audit/installations — the SUBMITTED-installation queue with the compare payload. */
  @Get('installations')
  listQueue(@CurrentUser() user: JwtPayload, @Query() query: ListInstallQueueDto) {
    return this.audit.listQueue(user, query);
  }

  /** GET /v1/audit/installations/:id — one scoped installation for the detail view (any status). */
  @Get('installations/:id')
  getInstallation(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.audit.getInstallation(user, id);
  }

  /** POST /v1/audit/installations/:id/approve — SUBMITTED → AUDIT_APPROVED. */
  @Post('installations/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.audit.approve(user, id);
  }

  /** POST /v1/audit/installations/:id/reject — SUBMITTED → AUDIT_REJECTED (required reason code). */
  @Post('installations/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RejectInstallationDto,
  ) {
    return this.audit.reject(user, id, dto);
  }
}
