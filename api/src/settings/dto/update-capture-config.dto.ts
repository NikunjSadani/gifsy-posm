import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Geo-fence policy the admin can set. `radiusMeters` is the fine-grained "is the capture at
 * the outlet?" distance (e.g. 500 m). `maxAccuracyMeters` caps how imprecise a GPS fix may be
 * before it's treated as unverifiable. Bounds keep a fat-fingered value sane; the resolver
 * (`posm-config.helper`) still defaults safely if a stored blob is ever malformed.
 */
class GeoFenceConfigDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt()
  @Min(10)
  @Max(100_000)
  radiusMeters: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxAccuracyMeters?: number;
}

/** PUT /v1/settings/capture — the per-tenant POSM capture config the admin edits. */
export class UpdateCaptureConfigDto {
  @ValidateNested()
  @Type(() => GeoFenceConfigDto)
  geoFence: GeoFenceConfigDto;

  /** Optional; preserved as-is when omitted (it is otherwise a Gifsy-controlled toggle). */
  @IsOptional()
  @IsBoolean()
  nearbyOutletsEnabled?: boolean;
}
