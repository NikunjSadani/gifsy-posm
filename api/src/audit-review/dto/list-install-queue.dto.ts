import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query filters for GET /v1/audit/installations (the Auditor review queue). All optional.
 * Site filters are case-insensitive `contains`. `@Type` is explicit so page/limit coerce
 * deterministically before the bounds run.
 */
export class ListInstallQueueDto {
  @IsOptional()
  @IsString()
  siteCode?: string;

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
