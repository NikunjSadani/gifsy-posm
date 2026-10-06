import {
  IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max, IsEnum, MaxLength,
} from 'class-validator';

/** Mirrors the Prisma `SiteStatus` enum (avoids importing the generated enum into a DTO). */
export enum SiteStatusInput {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/**
 * Create-site payload. `code` is unique per tenant (enforced by the DB composite
 * unique `@@unique([clientId, code])`; a collision surfaces as a 400). lat/lng are
 * range-checked to valid Earth coordinates — they are the authoritative geo-fence
 * reference, so a bad value must never persist.
 */
export class CreateSiteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

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

  // RS code + Beat are MANDATORY for a new outlet (the field RS/Beat filter relies on every
  // outlet carrying both). Required + non-empty here; the bulk upload enforces the same on
  // new-site rows.
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  rsCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  beatName: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  /** A Vendor id in THIS tenant (validated server-side); the fleet servicing this site. */
  @IsOptional()
  @IsString()
  vendorId?: string;

  /** An ASM User id in THIS tenant (validated server-side); the approving ASM. */
  @IsOptional()
  @IsString()
  asmUserId?: string;

  @IsOptional()
  @IsEnum(SiteStatusInput)
  status?: SiteStatusInput;
}
