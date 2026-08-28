import {
  IsString, IsOptional, IsNumber, Min, Max, IsEnum, MaxLength, IsNotEmpty,
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
  town?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  rsCode?: string;

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
