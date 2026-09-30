import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Filters for the Outlet Execution Report (GET /v1/reports/outlet-execution[.xlsx]). All optional;
 * text filters are case-insensitive `contains`. page/limit apply to the on-screen JSON view only
 * (the .xlsx export returns every matching row up to a hard server cap).
 */
export class ListOutletReportDto {
  @IsOptional()
  @IsString()
  siteCode?: string;

  @IsOptional()
  @IsString()
  town?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  state?: string;

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
  @Max(500)
  limit?: number;
}
