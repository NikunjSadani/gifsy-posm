import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsPositive,
  IsIn,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DimensionsDto,
  ELEMENT_MEASUREMENTS,
  ElementMeasurementDto,
} from './create-posm-type.dto';

/** Partial update of a PosmType. `clientId` can never change. */
export class UpdatePosmTypeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DimensionsDto)
  defaultDimensions?: DimensionsDto;

  /** Reference-photo media key (from POST /media/upload). Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageKey?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** GSB-gated element flag. See CreatePosmTypeDto.isGsb. */
  @IsOptional()
  @IsBoolean()
  isGsb?: boolean;

  /** Measurement mode (DIMENSION | UNIT). See CreatePosmTypeDto.measurement. */
  @IsOptional()
  @IsIn(ELEMENT_MEASUREMENTS)
  measurement?: ElementMeasurementDto;

  /** Max size cap (sq ft) for a DIMENSION element; > 0 or `null` to clear. See CreatePosmTypeDto.maxAreaSqFt. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxAreaSqFt?: number | null;
}
