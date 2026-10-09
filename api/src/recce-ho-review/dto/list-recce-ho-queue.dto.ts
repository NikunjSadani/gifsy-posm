import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query filters for GET /v1/recce-ho-review/recces (the recce-HO queue). The queue is widened for
 * the Manual Recce feature: it now holds BOTH ASM-approved app recces awaiting HO review AND manual
 * recces (which skip ASM, so they arrive status=SUBMITTED). `mode` narrows to one kind. All
 * optional; site filters are case-insensitive.
 */
export class ListRecceHoQueueDto {
  /** `all` (default) | `app` (ASM-approved app recces) | `manual` (field-typed manual recces). */
  @IsOptional()
  @IsIn(['all', 'app', 'manual'])
  mode?: 'all' | 'app' | 'manual';

  @IsOptional()
  @IsString()
  siteCode?: string;

  @IsOptional()
  @IsString()
  town?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
