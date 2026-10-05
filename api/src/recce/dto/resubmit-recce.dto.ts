import {
  IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReccePosmLineDto } from './create-recce.dto';

/**
 * Re-capture a REJECTED recce (POST /v1/recce/:id/resubmit). The site is fixed (taken from
 * the existing recce row — the caller cannot move it to another site), so the body carries
 * only the fresh 1–2 POSM lines. A successful resubmit bumps `version` and returns the recce
 * to SUBMITTED.
 */
export class ResubmitRecceDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'A recce needs at least 1 Element line' })
  @ArrayMaxSize(2, { message: 'A recce may have at most 2 Element lines' })
  @ValidateNested({ each: true })
  @Type(() => ReccePosmLineDto)
  posms: ReccePosmLineDto[];
}
