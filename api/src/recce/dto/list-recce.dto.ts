import { IsOptional, IsString, IsInt, Min, Max, IsEnum, IsArray } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { RecceStatus, RecceMode } from '@prisma/client';

/**
 * Query filters for GET /v1/recce (the field user's own recces). All optional. `@Type` is
 * explicit (not relying on enableImplicitConversion) so page/limit coerce deterministically
 * before the bounds run.
 */
export class ListRecceDto {
  /** Filter by recce status. */
  @IsOptional()
  @IsEnum(RecceStatus)
  status?: RecceStatus;

  /**
   * Filter by recce mode (APP | MANUAL). Lets the field app fetch the exec's MANUAL recces
   * independent of the RS/Beat gate — a manual recce's provisional outlet has no RS/Beat, so it
   * would otherwise never surface in My Work (UI/UX audit F1 / owner's reject→re-capture loop).
   */
  @IsOptional()
  @IsEnum(RecceMode)
  recceMode?: RecceMode;

  /** Filter by the site's code (case-insensitive contains). */
  @IsOptional()
  @IsString()
  siteCode?: string;

  /** Filter by the site's RS code (EXACT, case-insensitive) — the field RS/Beat filter. */
  @IsOptional()
  @IsString()
  rsCode?: string;

  /** Filter by the site's Beat (EXACT, case-insensitive) — the field RS/Beat filter. */
  @IsOptional()
  @IsString()
  beatName?: string;

  /**
   * Optional MULTI-select Beat filter. A repeated query param `?beatNames=A&beatNames=B`
   * parses to `['A','B']`; a single `?beatNames=A` to `['A']`. When present+non-empty it
   * filters the site's Beat by EXACT membership (the values come from the server's own
   * beat-options list, i.e. canonical stored strings). Back-compat: single `beatName` is kept.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  beatNames?: string[];

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
