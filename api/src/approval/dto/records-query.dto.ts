import { IsEnum, IsOptional, IsInt, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The dashboard tiles a `records` drill-down can target. Each maps 1:1 to a waterfall count
 * (or the sites universe) and reuses the SAME scope helpers in the service:
 *   - OUTLETS         → scoped sites (the universe).
 *   - RECCE           → scoped recces (any status).
 *   - ASM_APPROVED    → scoped recces, status APPROVED.
 *   - HO_APPROVED     → scoped recces, status APPROVED && hoReviewStatus APPROVED.
 *   - PENDING_INSTALL → HO-approved recces whose site has no installation yet.
 *   - INSTALLED       → scoped installations.
 */
export enum RecordsStage {
  OUTLETS = 'outlets',
  RECCE = 'recce',
  ASM_APPROVED = 'asm-approved',
  HO_APPROVED = 'ho-approved',
  PENDING_INSTALL = 'pending-install',
  INSTALLED = 'installed',
}

/**
 * Query for GET /v1/approval/records (the per-tile drill-down list).
 *
 * `stage` is REQUIRED and must be one of the controlled RecordsStage vocabulary — an unknown
 * stage is refused by validation (the service also fails closed on any unexpected value rather
 * than returning an unscoped list). Paging is KEYSET (cursor): the client passes `afterId` (the
 * last row it holds) and gets the next `limit` rows after it — immune to the OFFSET duplicate/skip
 * when rows change between fetches. `limit` defaults to 50 and is capped at 200. `@Type` is
 * explicit (not relying on enableImplicitConversion) so query-string `limit` coerces to a number
 * deterministically before the bounds run.
 */
export class RecordsQueryDto {
  @IsEnum(RecordsStage, {
    message: `stage must be one of: ${Object.values(RecordsStage).join(', ')}`,
  })
  stage: RecordsStage;

  /**
   * Keyset cursor: the id of the LAST row the client already holds. Omitted on the first page;
   * each subsequent page passes it so the server seeks PAST that row (cursor paging). Immune to
   * the duplicate/skip that offset paging suffers when rows are inserted/deleted between fetches.
   */
  @IsOptional()
  @IsString()
  afterId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
