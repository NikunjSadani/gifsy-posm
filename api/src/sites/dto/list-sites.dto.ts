import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query filters for GET /v1/sites. All optional; string filters are case-insensitive
 * `contains`. `vendorId` is applied ONLY for non-vendor callers — a vendor-role caller
 * is already hard-pinned to its own vendor by the service scope, so this filter can
 * never widen a vendor's view.
 */
export class ListSitesDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  town?: string;

  @IsOptional()
  @IsString()
  rsCode?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  // @Type is explicit (not relying on enableImplicitConversion) so a query string coerces
  // to a number deterministically before the @IsInt/@Min bounds run.
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
