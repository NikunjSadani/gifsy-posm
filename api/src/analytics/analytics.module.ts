import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics module — read-only reporting over the pipeline (Site → Recce → Installation →
 * audit) + manual lane. Depends only on the @Global PrismaModule. Registered in AppModule to
 * expose /v1/analytics.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
