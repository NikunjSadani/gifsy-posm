import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /v1/ho-review/installations/:id/reject.
 *
 * HO/Admin UPHOLDS the auditor's rejection — a terminal decision. The auditor already supplied
 * the controlled RejectReasonCode, so HO only adds an optional free-text note explaining why the
 * escalation was declined.
 */
export class HoRejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
