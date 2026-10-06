import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { RecceStatus } from '@prisma/client';

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
