import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Query filters for GET /v1/manual/submissions (admin review queue). All optional. */
export class ListManualSubmissionsDto {
  /** Defaults to SUBMITTED (the review queue) when omitted — applied in the service. */
  @IsOptional()
  @IsIn(['SUBMITTED', 'APPROVED', 'REJECTED'])
  status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  taskId?: string;

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
