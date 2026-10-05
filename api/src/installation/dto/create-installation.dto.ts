import {
  IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min,
  ArrayMinSize, ArrayMaxSize, ValidateNested, IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';

/** A per-photo GPS fix (shutter-time geotag) — range-checked to valid Earth coordinates. */
export class InstallGeoDto {
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

/** A captured install photo — stored GCS object `key` + its optional per-photo geo. */
export class InstallPhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  key: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InstallGeoDto)
  geo?: InstallGeoDto;
}

/** One installed-POSM photo, linked 1:1 to the recce POSM it fulfils. */
export class InstallPosmLineDto {
  /** The ReccePosm id this install photo fulfils (must belong to the site's approved recce). */
  @IsString()
  @IsNotEmpty()
  reccePosmId: string;

  @ValidateNested()
  @Type(() => InstallPhotoDto)
  photo: InstallPhotoDto;
}

/**
 * Submit one site's installation — allowed ONLY when the site's recce is APPROVED. Exactly
 * one line per recce POSM (1:1, complete): a missing photo is a HARD block. 1–2 lines, since
 * a recce carries 1–2 POSM.
 */
export class CreateInstallationDto {
  @IsString()
  @IsNotEmpty()
  siteId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'An installation needs at least 1 Element photo' })
  @ArrayMaxSize(2, { message: 'An installation may have at most 2 Element photos' })
  @ValidateNested({ each: true })
  @Type(() => InstallPosmLineDto)
  posms: InstallPosmLineDto[];
}
