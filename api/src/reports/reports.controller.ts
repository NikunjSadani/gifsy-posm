import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateEmailReportsConfigDto } from './dto/update-email-reports-config.dto';

/**
 * Reports console — per-tenant automated email digest configuration + preview + manual test send.
 *
 * The global guard chain (Throttler → JwtAuth → Roles → Tenant → Permission) is app-wide; every
 * route is pinned to CLIENT_ADMIN / GIFSY_ADMIN. All operations are TENANT-SCOPED by the caller's
 * clientId inside the service (config read/write + counts) — a digest only ever reflects ONE
 * tenant's rows.
 */
@Controller('reports')
@Roles('CLIENT_ADMIN', 'GIFSY_ADMIN')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** GET /v1/reports/config — the tenant's emailReports config (defaults when unset). */
  @Get('config')
  getConfig(@CurrentUser() user: JwtPayload) {
    return this.reports.getConfig(user);
  }

  /** PUT /v1/reports/config — validate + merge the emailReports config, return the saved value. */
  @Put('config')
  putConfig(@CurrentUser() user: JwtPayload, @Body() dto: UpdateEmailReportsConfigDto) {
    return this.reports.putConfig(user, dto);
  }

  /** GET /v1/reports/preview — { html, counts } for THIS tenant, WITHOUT sending. */
  @Get('preview')
  preview(@CurrentUser() user: JwtPayload) {
    return this.reports.preview(user);
  }

  /**
   * POST /v1/reports/send-now — build + email the digest to configured recipients NOW (admin
   * test; exempt from the once-per-day idempotency ledger). 400 when no recipients configured.
   */
  @Post('send-now')
  @HttpCode(HttpStatus.OK)
  sendNow(@CurrentUser() user: JwtPayload) {
    return this.reports.sendNow(user);
  }
}
