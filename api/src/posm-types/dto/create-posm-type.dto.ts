import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
}
