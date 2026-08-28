import {
  Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { RecceService } from './recce.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateRecceDto } from './dto/create-recce.dto';
import { ResubmitRecceDto } from './dto/resubmit-recce.dto';
import { ListRecceDto } from './dto/list-recce.dto';

/**
 * Recce field-capture — Wave 2 CAPTURE lane.
 *
 * The global guard chain (JwtAuth → Roles → Tenant → Permission) is applied app-wide; every
 * route declares an explicit @Roles floor of VENDOR_FIELD. Cross-tenant AND cross-vendor
 * confinement is enforced fail-closed inside the service.
 */
@Controller('recce')
export class RecceController {
  constructor(private readonly recce: RecceService) {}

  /** POST /v1/recce — submit one site's recce (1–2 POSM lines). */
  @Roles('VENDOR_FIELD')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRecceDto) {
    return this.recce.create(user, dto);
  }

  /** GET /v1/recce — the field user's own recces (vendor-scoped). */
  @Roles('VENDOR_FIELD')
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListRecceDto) {
    return this.recce.list(user, query);
  }

  /** GET /v1/recce/:id — a single recce with its POSM lines + media view-paths. */
  @Roles('VENDOR_FIELD')
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.recce.get(user, id);
  }

  /** POST /v1/recce/:id/resubmit — re-capture a REJECTED recce (bumps version). */
  @Roles('VENDOR_FIELD')
  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  resubmit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ResubmitRecceDto,
  ) {
    return this.recce.resubmit(user, id, dto);
  }
}
