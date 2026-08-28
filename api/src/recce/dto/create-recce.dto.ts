import {
  IsArray, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min,
  ArrayMinSize, ArrayMaxSize, ValidateNested, IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * A per-photo GPS fix (the shutter-time geotag). lat/lng are range-checked to valid Earth
 * coordinates — a bad fix must never reach the geo-fence math. `accuracy` (metres) and
 * `capturedAt` (client shutter time, ISO-8601) are optional diagnostics.
 */
export class GeoDto {
  @IsNumber({}, { message: 'geo.lat must be a number' })
  @Min(-90) @Max(90)
  lat: number;

  @IsNumber({}, { message: 'geo.lng must be a number' })
  @Min(-180) @Max(180)
  lng: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}

/**
 * A captured photo value — the stored GCS object `key` (produced by the media-upload
 * endpoint) plus its optional per-photo geo. Matches the `MediaValue {key, geo?}` contract.
 */
export class PhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  key: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoDto)
  geo?: GeoDto;
}

/** POSM physical dimensions entered by the rep at recce (numeric width/height + a unit). */
export class DimensionsDto {
  @IsNumber({}, { message: 'dimensions.width must be a number' })
  @Min(0)
  width: number;

  @IsNumber({}, { message: 'dimensions.height must be a number' })
  @Min(0)
  height: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  unit: string;
}

/** One planned POSM line at a site during recce. */
export class ReccePosmLineDto {
  /** A PosmType id in THIS tenant (validated server-side). */
  @IsString()
  @IsNotEmpty()
  posmTypeId: string;

  @ValidateNested()
  @Type(() => DimensionsDto)
  dimensions: DimensionsDto;

  @ValidateNested()
  @Type(() => PhotoDto)
  photo: PhotoDto;

  /** Optional on-image marked install-area annotation (free-form JSON blob). */
  @IsOptional()
  @IsObject()
  markup?: Record<string, unknown>;
}

/**
 * Submit one site's recce: 1–2 POSM lines, each with dimensions + a marked photo. The recce
 * is IMMUTABLE once submitted (one live recce per site via `@@unique([clientId, siteId])`); a
 * REJECTED recce is re-captured through POST /v1/recce/:id/resubmit, not a fresh POST.
 */
export class CreateRecceDto {
  @IsString()
  @IsNotEmpty()
  siteId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A recce needs at least 1 POSM line' })
  @ArrayMaxSize(2, { message: 'A recce may have at most 2 POSM lines' })
  @ValidateNested({ each: true })
  @Type(() => ReccePosmLineDto)
  posms: ReccePosmLineDto[];
}
