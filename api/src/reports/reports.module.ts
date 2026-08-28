import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsCron } from './reports.cron';

/**
 * Reports module — per-tenant automated email digest (config + preview + manual send) and the
 * hourly scheduled sweep. Depends on the @Global PrismaModule and the @Global NotificationsModule
 * (Msg91Service SMTP transport). Registered in AppModule to expose /v1/reports and to wire the
 * @Cron scheduler.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsCron],
  exports: [ReportsService],
})
export class ReportsModule {}
