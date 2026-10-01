import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Per-ASM pending-recce reminder settings (threshold-triggered). */
export class AsmRecceReminderDto {
  @IsBoolean()
  enabled: boolean;

  /** Hours a recce must be pending ASM approval before it's eligible for a reminder. */
  @IsInt()
  @Min(1)
  @Max(720)
  thresholdHours: number;

  /** Re-remind a given recce at most once per this many hours. */
  @IsInt()
  @Min(1)
  @Max(720)
  reminderIntervalHours: number;
}

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

  /** Per-ASM pending-recce reminder config. Optional for backward-compat; defaulted in the service. */
  @IsOptional()
  @ValidateNested()
  @Type(() => AsmRecceReminderDto)
  asmRecceReminders?: AsmRecceReminderDto;
}
