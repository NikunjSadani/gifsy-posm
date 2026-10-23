import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReportsService } from './reports.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdateEmailReportsConfigDto } from './dto/update-email-reports-config.dto';
import { ListOutletReportDto } from './dto/list-outlet-report.dto';

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
   *
   * Tightly throttled (3/min per caller, well under the global 60/min) so this manual test-send
   * can't be looped into a bulk relay through the shared SMTP domain. Recipients are still the
   * admin-configured list (capped at 50) — a legitimately-external ops list is inherent to the
   * feature; the throttle bounds the abuse rate.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('send-now')
  @HttpCode(HttpStatus.OK)
  sendNow(@CurrentUser() user: JwtPayload) {
    return this.reports.sendNow(user);
  }

  /**
   * GET /v1/reports/outlet-execution — one paginated page of the Outlet Execution Report
   * ({ columns, rows, total, page, limit }) for the on-screen table. Tenant-scoped in the service.
   */
  @Get('outlet-execution')
  outletExecution(@CurrentUser() user: JwtPayload, @Query() query: ListOutletReportDto) {
    return this.reports.outletExecution(user, query);
  }

  /**
   * GET /v1/reports/outlet-execution.xlsx — the same report as a downloadable .xlsx, EVERY matching
   * row (no row cap). The service streams rows in batches straight into the response, so a large
   * tenant export never materialises the whole workbook in memory. Returned as a StreamableFile
   * (passed through the global interceptor unwrapped) with an attachment disposition.
   */
  @Get('outlet-execution.xlsx')
  outletExecutionXlsx(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListOutletReportDto,
  ): StreamableFile {
    const stream = this.reports.outletExecutionXlsxStream(user, query);
    // IST date (en-CA → YYYY-MM-DD) so the fallback filename matches the IST dates in the report.
    // In the real FE flow the blob's `a.download` overrides this; it only surfaces on a direct hit.
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return new StreamableFile(stream, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="recce-report-${stamp}.xlsx"`,
    });
  }
}
