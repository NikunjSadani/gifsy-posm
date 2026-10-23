import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The drillable Analytics tiles. Each value maps (in AnalyticsService.drilldown) to a scoped
 * `where` that EXACTLY reproduces the count the matching summary tile shows, so a tile and its
 * drill-down list can never diverge. Kebab-case string values are the query contract.
 */
export enum DrilldownMetric {
  /** Scoped outlet universe (Site). byElementType []. */
  TOTAL_OUTLETS = 'total-outlets',
  /** All scoped recces (any status/mode) — the funnel's recce-event total. */
  RECCE = 'recce',
  /** ASM-approved: APPROVED app recces (APP-only — a MANUAL recce skips ASM). */
  ASM_APPROVED = 'asm-approved',
  /** HO-approved / installable: APPROVED && hoReviewStatus APPROVED. */
  HO_APPROVED = 'ho-approved',
  /** All scoped installations. */
  INSTALLED = 'installed',
  /** Audited installations (AUDIT_APPROVED). */
  AUDITED = 'audited',
  /** ASM review queue: SUBMITTED app recces (APP-only — MANUAL skips ASM). */
  PENDING_ASM_REVIEW = 'pending-asm-review',
  /** HO review queue: APP ASM-approved+HO-pending OR MANUAL SUBMITTED+HO-pending. */
  PENDING_HO_REVIEW = 'pending-ho-review',
  /** Installations awaiting audit (SUBMITTED). */
  PENDING_INSTALL_AUDIT = 'pending-install-audit',
  /** Rejected recces (REJECTED). */
  REJECTED_RECCE = 'rejected-recce',
  /** Rejected installations (AUDIT_REJECTED). */
  REJECTED_INSTALL = 'rejected-install',
  /** App recces (recceMode APP). */
  RECCES_APP = 'recces-app',
  /** Manual recces (recceMode MANUAL). */
  RECCES_MANUAL = 'recces-manual',
}

/**
 * Query for GET /v1/analytics/drilldown — the sheet-shaped per-tile record list. `@Type` is
 * explicit (not relying on enableImplicitConversion) so page/limit coerce deterministically
 * before the bounds run.
 */
export class DrilldownQueryDto {
  /** Which tile to drill into. Required; enum-validated (an unknown value → 400). */
  @IsEnum(DrilldownMetric)
  metric!: DrilldownMetric;

  /**
   * Admin drill-down: narrow to ONE vendor's records (for a vendor-scorecard-row click).
   * Honoured ONLY for CLIENT_ADMIN / GIFSY_ADMIN. For a VENDOR_HO / ASM it is IGNORED — that
   * caller stays fail-closed to their own scope (they can never surface a foreign fleet).
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
