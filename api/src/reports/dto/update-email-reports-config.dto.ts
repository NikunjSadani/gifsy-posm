import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  Max,
  Min,
} from 'class-validator';

/**
 * Body for PUT /v1/reports/config — the full per-tenant email-digest config (replace, not
 * patch). class-validator enforces the field-level rules (each recipient a valid email, the
 * send hour in 0–23, the stale thresholds >= 1 hour). De-duplication of recipients happens in
 * the service (case-insensitive) after validation. The global ValidationPipe runs whitelist +
 * forbidNonWhitelisted, so any unknown key is a 400.
 */
export class UpdateEmailReportsConfigDto {
  @IsBoolean()
  enabled: boolean;

  /** Every element must be a valid email. Capped to keep the blob + fan-out bounded. */
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  recipients: string[];

  /** Local send hour, interpreted in IST. */
  @IsInt()
  @Min(0)
  @Max(23)
  sendHourLocal: number;

  /** Hours after which a SUBMITTED recce is "stale" (reminder trigger). */
  @IsInt()
  @Min(1)
  staleRecceHours: number;

  /** Hours after which a SUBMITTED installation is "stale" (reminder trigger). */
  @IsInt()
  @Min(1)
  staleInstallHours: number;
}
