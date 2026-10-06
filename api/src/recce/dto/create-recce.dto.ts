import {
  IsArray, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min,
  ArrayMinSize, ArrayMaxSize, ValidateNested, IsISO8601, Equals, IsIn,
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

/** One point of a freehand path — normalised 0..1 to the image content box. */
export class MarkupPointDto {
  @IsNumber() @Min(0) @Max(1) x: number;
  @IsNumber() @Min(0) @Max(1) y: number;
}

/**
 * One markup shape: a RECTANGLE box (type 'rect' + x/y/w/h) OR a FREEHAND path (type 'path' +
 * points). All coordinates are normalised 0..1; a path is bounded to ≤400 points. The rect
 * fields / `points` are optional at this level (a rect carries x/y/w/h, a path carries points) —
 * completeness is enforced by the shared defensive `parseMarkup` on render (platform
 * src/lib/markup.ts); this DTO's job is to type-restrict + BOUND the blob so it can't grow huge.
 * The accept-set is a strict superset of the previous rect-only DTO.
 */
export class MarkupShapeDto {
  @IsIn(['rect', 'path'])
  type: 'rect' | 'path';

  @IsOptional() @IsNumber() @Min(0) @Max(1) x?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) y?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) w?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) h?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400, { message: 'A freehand path may have at most 400 points' })
  @ValidateNested({ each: true })
  @Type(() => MarkupPointDto)
  points?: MarkupPointDto[];
}

/**
 * The field executive's on-image annotation marking WHERE the POSM install is proposed — rectangle
 * and/or freehand shapes. Bounded (≤10 shapes) so the stored blob can't grow unbounded — mirrors
 * the FE `RecceMarkup` (platform src/lib/markup.ts).
 */
export class MarkupDto {
  @Equals(1)
  version: 1;

  @IsArray()
  @ArrayMinSize(1, { message: 'Markup must have at least 1 shape' })
  @ArrayMaxSize(10, { message: 'At most 10 markup shapes' })
  @ValidateNested({ each: true })
  @Type(() => MarkupShapeDto)
  shapes: MarkupShapeDto[];
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

  /** REQUIRED on-image annotation marking WHERE the Element install is proposed (≥1 shape).
   *  Marking the recce photo is compulsory — a line without a markup is rejected. */
  @IsObject({ message: 'Each Element must be marked on the photo before submitting' })
  @ValidateNested()
  @Type(() => MarkupDto)
  markup: MarkupDto;
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
  @ArrayMinSize(1, { message: 'A recce needs at least 1 Element line' })
  @ArrayMaxSize(2, { message: 'A recce may have at most 2 Element lines' })
  @ValidateNested({ each: true })
  @Type(() => ReccePosmLineDto)
  posms: ReccePosmLineDto[];
}
