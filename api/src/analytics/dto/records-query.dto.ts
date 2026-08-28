import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { AnalyticsStage } from './geo-query.dto';

/**
 * Query for GET /v1/analytics/records — the drill-down-to-evidence list. Unlike the
 * approval/audit queues (SUBMITTED-only), this lists ANY status so the console can open
 * already-reviewed submissions. `@Type` is explicit (not relying on enableImplicitConversion)
 * so page/limit coerce deterministically before the bounds run.
 */
export class RecordsQueryDto {
  /** Which pipeline entity to list. Required. */
  @IsIn(['recce', 'install'])
  stage!: AnalyticsStage;

  /**
   * Optional status filter — a RecceStatus (recce) or InstallationStatus (install). Free
   * string; only applied when present (an unknown value simply matches no rows).
   */
  @IsOptional()
  @IsString()
  status?: string;

  /**
   * Admin drill-down: narrow to ONE vendor's records (for a vendor-scorecard-row click).
   * Honoured ONLY for CLIENT_ADMIN / GIFSY_ADMIN. For a VENDOR_HO it is IGNORED — that caller
   * stays fail-closed to their own fleet (they can never pass a foreign vendorId).
   */
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
