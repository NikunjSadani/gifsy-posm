import { IsObject } from 'class-validator';

/**
 * Body for POST /v1/manual/tasks/:id/submit (a VENDOR_FIELD user fills the task's form).
 *
 * `formValues` is kept opaque here — class-validator only asserts it is an object; the answers
 * are deep-validated in the service against the task's stored `formSchema` via the reused
 * capture form engine (`validateSubmittedValues`), which projects/drops hidden + unknown keys.
 */
export class SubmitManualTaskDto {
  @IsObject()
  formValues: Record<string, unknown>;
}
