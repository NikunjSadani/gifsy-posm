import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DimensionsDto } from './create-posm-type.dto';

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
