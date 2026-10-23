import { IsOptional, IsString, IsInt, Min, Max, IsEnum, IsBoolean, IsArray } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { SiteStatus } from '@prisma/client';

/**
 * Query filters for GET /v1/sites. All optional. `name` / `code` / `town` are case-insensitive
 * `contains`; `rsCode` / `beatName` are EXACT case-insensitive matches (the field app's
 * dependent RS-code + Beat drop-down filter picks a single value, not a substring). `vendorId`
 * is applied ONLY for non-vendor callers — a vendor-role caller is already hard-pinned to its
 * own vendor by the service scope, so this filter can never widen a vendor's view.
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
  beatName?: string;

  // Optional MULTI-select Beat filter. A repeated query param `?beatNames=A&beatNames=B`
  // parses to `['A','B']`; a single `?beatNames=A` to `['A']`. When present+non-empty it
  // filters by EXACT membership (the values come from the server's own beat-options list,
  // i.e. canonical stored strings). Back-compat: the single `beatName` above is kept.
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  beatNames?: string[];

  @IsOptional()
  @IsString()
  vendorId?: string;

  // Optional status filter. Validated against the SiteStatus enum (ACTIVE / INACTIVE);
  // absent = all statuses. An unknown value is rejected (400) rather than silently ignored.
  @IsOptional()
  @IsEnum(SiteStatus)
  status?: SiteStatus;

  // "Recce to do" filter: when true, only outlets with NO recce yet (a fresh recce is still
  // owed) are returned. Explicit transform (NOT enableImplicitConversion) so only the literal
  // 'true' enables it — any other value is false, never fail-open.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  pendingRecce?: boolean;

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
