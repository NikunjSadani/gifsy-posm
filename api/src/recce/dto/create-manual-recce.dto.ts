import {
  IsArray, IsNotEmpty, IsOptional, IsString, MaxLength,
  ArrayMinSize, ArrayMaxSize, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReccePosmLineDto } from './create-recce.dto';

/**
 * Submit a MANUAL recce (field executive, outlet may be off-master).
 *
 * The field exec types a few outlet fields — only **Outlet Name is required** (400 if blank or
 * missing) — and does the IDENTICAL element capture as the app recce (`posms` reuses
 * {@link ReccePosmLineDto}, so compulsory markup, 1–2 lines, dimensions + marked photo all apply).
 *
 *  - `outletId` optional. If it matches an existing outlet the caller's vendor services → ATTACH
 *    (reuse that Site). If new → a Site is created with `code = outletId`. If blank → a Site is
 *    created with an internal provisional code (`MAN-…`); HO sets the real Outlet ID at approval.
 *  - `outletAddress` / `outletPhone` optional; written on a newly-created outlet.
 *
 * The recce is created `recceMode=MANUAL, status=SUBMITTED, hoReviewStatus=PENDING` and goes
 * straight to HO (no ASM). Unlimited manual recces are allowed per outlet.
 */
export class CreateManualRecceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  outletId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Outlet Name is required' })
  @MaxLength(300)
  outletName: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  outletAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  outletPhone?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A recce needs at least 1 Element line' })
  @ArrayMaxSize(2, { message: 'A recce may have at most 2 Element lines' })
  @ValidateNested({ each: true })
  @Type(() => ReccePosmLineDto)
  posms: ReccePosmLineDto[];
}
