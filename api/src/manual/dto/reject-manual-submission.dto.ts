import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Body for POST /v1/manual/submissions/:id/reject.
 *
 * Manual tasks are arbitrary, so there is no controlled reason-code vocabulary (unlike recce
 * rejection): a free-text `reason` is REQUIRED and non-empty, capped at 500 chars. The value is
 * trimmed first so a whitespace-only reason is rejected by MinLength.
 */
export class RejectManualSubmissionDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'reason is required' })
  @MaxLength(500)
  reason: string;
}
