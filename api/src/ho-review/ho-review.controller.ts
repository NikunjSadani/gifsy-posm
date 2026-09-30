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
import { HoReviewService } from './ho-review.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { ListHoQueueDto } from './dto/list-ho-queue.dto';
import { HoRejectDto } from './dto/ho-reject.dto';

/**
 * HO/Admin escalation console — reviews audit-rejected installations (owner decision 2026-09-30).
 *
 * ONLY the head office (CLIENT_ADMIN) and the platform operator (GIFSY_ADMIN) may act here — the
 * AUDITOR is intentionally excluded, because HO sits ABOVE the auditor in the chain. The global
 * guard chain applies app-wide; tenant confinement is enforced inside the service on every read
 * AND every transition.
 */
@Controller('ho-review')
@Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
export class HoReviewController {
  constructor(private readonly ho: HoReviewService) {}

  /** GET /v1/ho-review/installations — audit-rejected installations awaiting HO review. */
  @Get('installations')
  listQueue(@CurrentUser() user: JwtPayload, @Query() query: ListHoQueueDto) {
    return this.ho.listQueue(user, query);
  }

  /** GET /v1/ho-review/installations/:id — one scoped installation for the HO detail view. */
  @Get('installations/:id')
  getInstallation(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ho.getInstallation(user, id);
  }

  /** POST /v1/ho-review/installations/:id/approve — hoReviewStatus PENDING → APPROVED. */
  @Post('installations/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ho.approve(user, id);
  }

  /** POST /v1/ho-review/installations/:id/reject — hoReviewStatus PENDING → REJECTED (terminal). */
  @Post('installations/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: HoRejectDto,
  ) {
    return this.ho.reject(user, id, dto);
  }
}
