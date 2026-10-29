import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsBoolean,
  IsIn,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Element measurement mode. Mirrors the Prisma `ElementMeasurement` enum. */
export const ELEMENT_MEASUREMENTS = ['DIMENSION', 'UNIT'] as const;
export type ElementMeasurementDto = (typeof ELEMENT_MEASUREMENTS)[number];

/** Optional {width,height,unit} template pre-filled when a rep captures this POSM type. */
export class DimensionsDto {
  @IsNumber()
  @IsPositive()
  width: number;

  @IsNumber()
  @IsPositive()
  height: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  unit: string;
}

export class CreatePosmTypeDto {
  /** Tenant-unique short code. Enforced by @@unique([clientId, code]). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DimensionsDto)
  defaultDimensions?: DimensionsDto;

  /** Reference-photo media key (from POST /media/upload). Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageKey?: string;

  /**
   * The GSB-gated element flag (default false). A recce line of an isGsb=true element may be
   * captured ONLY at an outlet with gsbAllowed=true.
   */
  @IsOptional()
  @IsBoolean()
  isGsb?: boolean;

  /**
   * Measurement mode (default DIMENSION). DIMENSION elements are captured with W×H; UNIT elements
   * carry no dimensions. When UNIT, the service forces maxAreaSqFt and defaultDimensions to null.
   */
  @IsOptional()
  @IsIn(ELEMENT_MEASUREMENTS)
  measurement?: ElementMeasurementDto;

  /**
   * Optional max size cap (sq ft) for a DIMENSION element: the recce's width*height must be ≤ this.
   * Must be > 0 when provided; `null` clears it. Ignored (forced null) for a UNIT element.
   */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxAreaSqFt?: number | null;
}
