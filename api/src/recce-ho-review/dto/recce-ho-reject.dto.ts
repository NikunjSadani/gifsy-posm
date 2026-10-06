import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RejectReasonCode } from '@prisma/client';

/**
 * Body for POST /v1/recce-ho-review/recces/:id/reject.
 *
 * HO/Admin rejects the recce at the HO stage — the recce returns to the field (status REJECTED).
 * `reasonCode` is REQUIRED and must be one of the controlled RejectReasonCode vocabulary (chassis
 * reject-code pattern); `reason` is an optional free-text note captured alongside it.
 */
export class RecceHoRejectDto {
  @IsEnum(RejectReasonCode, {
    message: `reasonCode must be one of: ${Object.values(RejectReasonCode).join(', ')}`,
  })
  reasonCode: RejectReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
