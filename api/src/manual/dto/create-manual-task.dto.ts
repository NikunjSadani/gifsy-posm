import {
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for POST /v1/manual/tasks (admin creates an ad-hoc task).
 *
 * `formSchema` is kept as an opaque object here — class-validator only asserts it is an
 * object; the STRUCTURAL validation runs in the service via the reused capture form engine
 * (`validateFormSchema`), which is the single source of truth for the field shape. `vendorId`
 * omitted / null → the task targets every fleet in the tenant.
 */
export class CreateManualTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Target one vendor fleet; omit / null = all fleets in the tenant. */
  @IsOptional()
  @IsString()
  vendorId?: string;

  /** Optional ISO-8601 deadline (drives reminder emails). */
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  /** The capture-form schema — deep-validated in the service by the form engine. */
  @IsObject()
  formSchema: Record<string, unknown>;
}
