import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ReportsModule } from '../reports/reports.module';

/**
 * Analytics module — read-only reporting over the pipeline (Site → Recce → Installation →
 * audit) + manual lane. Imports ReportsModule so the drill-down .xlsx export can reuse the
 * full-column outlet-execution report (scoped to the drilled outlet set). Registered in AppModule
 * to expose /v1/analytics.
 */
@Module({
  imports: [ReportsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
