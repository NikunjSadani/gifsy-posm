import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Body for PATCH /v1/manual/tasks/:id. Every field is optional (partial update). A field is
 * only written when the key is PRESENT on the body: `undefined` = leave unchanged; an explicit
 * `null` on `vendorId` / `dueDate` clears it (retarget to all fleets / drop the deadline).
 *
 * `formSchema`, when present, is re-validated by the form engine AND may only change while the
 * task has zero submissions (enforced in the service).
 */
export class UpdateManualTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** null clears the fleet target (task → all fleets); a string retargets it. */
  @ValidateIf((o) => o.vendorId !== null && o.vendorId !== undefined)
  @IsString()
  vendorId?: string | null;

  /** null clears the deadline; an ISO-8601 string sets it. */
  @ValidateIf((o) => o.dueDate !== null && o.dueDate !== undefined)
  @IsISO8601()
  dueDate?: string | null;

  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';

  @IsOptional()
  @IsObject()
  formSchema?: Record<string, unknown>;
}
