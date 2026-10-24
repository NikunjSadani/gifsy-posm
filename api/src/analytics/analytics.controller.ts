import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import { GeoQueryDto } from './dto/geo-query.dto';
import { RecordsQueryDto } from './dto/records-query.dto';
import { DrilldownQueryDto } from './dto/drilldown-query.dto';

/**
 * Analytics console — read-only reporting over the POSM pipeline, serving BOTH the admin
 * dashboard and the read-only Vendor-HO console over the SAME endpoints (role-scoped).
 *
 * The global guard chain (JwtAuth → Roles → Tenant → Permission) is applied app-wide; each
 * route declares its @Roles floor. All cross-tenant / cross-fleet / ASM-territory confinement
 * is enforced inside the service (resolveScope) on EVERY query — read-only, no writes.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** GET /v1/analytics/summary — waterfall + KPIs + manual counts, scoped. */
  @Get('summary')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN', 'VENDOR_HO', 'ASM')
  summary(@CurrentUser() user: JwtPayload) {
    return this.analytics.summary(user);
  }

  /** GET /v1/analytics/vendor-scorecards — per-vendor rows (VENDOR_HO = only their own). */
  @Get('vendor-scorecards')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN', 'VENDOR_HO', 'ASM')
  vendorScorecards(@CurrentUser() user: JwtPayload) {
    return this.analytics.vendorScorecards(user);
  }

  /** GET /v1/analytics/geo?stage=recce|install — map/heatmap points (capped 5000), scoped. */
  @Get('geo')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN', 'VENDOR_HO', 'ASM')
  geo(@CurrentUser() user: JwtPayload, @Query() query: GeoQueryDto) {
    return this.analytics.geo(user, query);
  }

  /** GET /v1/analytics/records — any-status drill-down to evidence (media → view paths), scoped. */
  @Get('records')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN', 'VENDOR_HO', 'ASM')
  records(@CurrentUser() user: JwtPayload, @Query() query: RecordsQueryDto) {
    return this.analytics.records(user, query);
  }

  /** GET /v1/analytics/drilldown?metric=… — sheet-shaped per-tile record list + element mix, scoped. */
  @Get('drilldown')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN', 'VENDOR_HO', 'ASM')
  drilldown(@CurrentUser() user: JwtPayload, @Query() query: DrilldownQueryDto) {
    return this.analytics.drilldown(user, query);
  }

  /**
   * GET /v1/analytics/drilldown.xlsx?metric=…&vendorId=… — the SAME scoped drill-down as
   * `/drilldown`, full set (no row cap), streamed as an enriched .xlsx attachment. Same @Roles
   * floor + same scope (a VENDOR_HO export is fleet-only; an ASM export territory-only).
   */
  @Get('drilldown.xlsx')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN', 'VENDOR_HO', 'ASM')
  drilldownXlsx(@CurrentUser() user: JwtPayload, @Query() query: DrilldownQueryDto): StreamableFile {
    return this.analytics.drilldownXlsx(user, query);
  }

  /** GET /v1/analytics/export — Summary + Vendor-Scorecards xlsx (attachment), scoped. */
  @Get('export')
  @Roles('CLIENT_ADMIN', 'GIFSY_ADMIN', 'VENDOR_HO')
  export(@CurrentUser() user: JwtPayload): Promise<StreamableFile> {
    return this.analytics.export(user);
  }
}
