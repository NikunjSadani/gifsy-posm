import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportsService } from './reports.service';

/**
 * The hourly digest scheduler. Fires at the top of every hour and delegates to
 * {@link ReportsService.runDailyDigestCron}, which itself decides — per tenant — whether the
 * current IST hour matches that tenant's configured `sendHourLocal` and whether today's digest
 * has already been sent (idempotency via the EmailDigestLog unique ledger).
 *
 * Kept thin (no business logic) so the sweep is unit-testable by calling the service method
 * directly with an injected `now`. The whole run is wrapped so a scheduler failure is logged,
 * never thrown into the framework's cron loop.
 */
@Injectable()
export class ReportsCron {
  private readonly logger = new Logger(ReportsCron.name);

  constructor(private readonly reports: ReportsService) {}

  /** Top of every hour (server TZ Asia/Calcutta; the service re-derives the IST wall clock). */
  @Cron('0 * * * *', { name: 'daily-email-digest' })
  async handleHourly(): Promise<void> {
    try {
      await this.reports.runDailyDigestCron();
    } catch (e) {
      this.logger.error(
        `daily-email-digest cron failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
