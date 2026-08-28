import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RejectReasonCode } from '@prisma/client';

/**
 * Body for POST /v1/approval/recces/:id/reject.
 *
 * `reasonCode` is REQUIRED and must be one of the controlled RejectReasonCode vocabulary
 * (chassis reject-code pattern) — a free-text-only rejection is refused. `reason` is an
 * optional human note captured alongside the code.
 */
export class RejectRecceDto {
  @IsEnum(RejectReasonCode, {
    message: `reasonCode must be one of: ${Object.values(RejectReasonCode).join(', ')}`,
  })
  reasonCode: RejectReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
