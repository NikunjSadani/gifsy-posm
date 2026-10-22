import {
  IsString, IsOptional, IsNumber, Min, Max, IsEnum, MaxLength, IsNotEmpty, IsBoolean,
} from 'class-validator';
import { SiteStatusInput } from './create-site.dto';

/**
 * Partial site update. Every field is optional; `code` may be re-assigned but stays
 * unique per tenant (a collision surfaces as a 400). Written manually rather than via
 * PartialType so the module has no @nestjs/mapped-types dependency.
 */
export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 }, { message: 'lat must be a number' })
  @Min(-90, { message: 'lat must be between -90 and 90' })
  @Max(90, { message: 'lat must be between -90 and 90' })
  lat?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 }, { message: 'lng must be a number' })
  @Min(-180, { message: 'lng must be between -180 and 180' })
  @Max(180, { message: 'lng must be between -180 and 180' })
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cluster?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  town?: string;

  // RS code + Beat stay OPTIONAL on edit (omit = unchanged) but, if provided, cannot be
  // cleared to empty — an existing outlet must never lose its mandatory RS/Beat.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  rsCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  beatName?: string;

  /** Display name for the RS (distributor) — paired with rsCode. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rsName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  /** Outlet postal PIN code. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pincode?: string;

  /** Per-outlet allow-list for the GSB element type. */
  @IsOptional()
  @IsBoolean()
  gsbAllowed?: boolean;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  asmUserId?: string;

  @IsOptional()
  @IsEnum(SiteStatusInput)
  status?: SiteStatusInput;
}
