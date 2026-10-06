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
import { RecceHoReviewService } from './recce-ho-review.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { ListRecceHoQueueDto } from './dto/list-recce-ho-queue.dto';
import { RecceHoRejectDto } from './dto/recce-ho-reject.dto';

/**
 * Recce-HO approval console — reviews ASM-approved recces before installation is unlocked.
 *
 * ONLY the head office (CLIENT_ADMIN) and the platform operator (GIFSY_ADMIN) may act here — the
 * AUDITOR is intentionally excluded (mirrors the install-side HO console). The global guard chain
 * applies app-wide; tenant confinement is enforced inside the service on every read AND every
 * transition. HO reviews recces one at a time — there is no bulk endpoint.
 */
@Controller('recce-ho-review')
@Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
export class RecceHoReviewController {
  constructor(private readonly ho: RecceHoReviewService) {}

  /** GET /v1/recce-ho-review/recces — ASM-approved recces awaiting HO review. */
  @Get('recces')
  listQueue(@CurrentUser() user: JwtPayload, @Query() query: ListRecceHoQueueDto) {
    return this.ho.listQueue(user, query);
  }

  /** GET /v1/recce-ho-review/recces/:id — one scoped recce for the HO detail view. */
  @Get('recces/:id')
  getRecce(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ho.getRecce(user, id);
  }

  /** POST /v1/recce-ho-review/recces/:id/approve — hoReviewStatus PENDING → APPROVED (unlocks install). */
  @Post('recces/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ho.approve(user, id);
  }

  /** POST /v1/recce-ho-review/recces/:id/reject — hoReviewStatus PENDING → REJECTED + status REJECTED. */
  @Post('recces/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RecceHoRejectDto,
  ) {
    return this.ho.reject(user, id, dto);
  }
}
