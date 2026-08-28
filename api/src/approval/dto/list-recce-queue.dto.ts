import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query filters for GET /v1/approval/recces (the ASM review queue). All optional.
 * String filters are case-insensitive `contains` against the recce's SITE. `@Type` is
 * explicit (not relying on enableImplicitConversion) so a query-string page/limit coerces
 * to a number deterministically before the bounds run.
 */
export class ListRecceQueueDto {
  /** Filter by the site's code (case-insensitive contains). */
  @IsOptional()
  @IsString()
  siteCode?: string;

  /** Filter by the site's town (case-insensitive contains). */
  @IsOptional()
  @IsString()
  town?: string;

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
