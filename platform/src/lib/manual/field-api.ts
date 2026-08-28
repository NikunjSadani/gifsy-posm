/**
 * Vendor (field-user) manual-task API client + pure helpers.
 *
 * A "manual task" is an ad-hoc, admin-defined capture form assigned to a vendor fleet. The
 * VENDOR_FIELD user sees the tasks targeting their fleet, fills the form (typed answers +
 * photos + GPS), and submits. An admin approves/rejects elsewhere; a REJECTED task is
 * re-fillable and re-submittable.
 *
 * This module is the thin typed edge over the two backend routes the filler uses, plus a
 * handful of PURE helpers (unit-tested) that the form-filler UI leans on so the state logic
 * lives outside React. Types/required/options/media/geo are RE-VALIDATED by the backend
 * against the task's `formSchema`; these helpers are only a client-side pre-submit guard.
 */

import { api } from '@/lib/api-client';
import {
  orderedFields,
  hasValue,
  type ManualFormSchema,
  type FormField,
  type FormValues,
  type FormValue,
} from '@/lib/manual/form-types';

/** A vendor's own submission against a task (null when never submitted). */
export type SubmissionStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface MySubmission {
  status: SubmissionStatus;
  version: number;
  /** Present (and worth surfacing) only when status === 'REJECTED'. */
  rejectionReason?: string;
}

/** A row of `GET /api/manual/my-tasks` — an OPEN task targeting my fleet + my latest submission. */
export interface ManualTask {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  formSchema: ManualFormSchema;
  mySubmission: MySubmission | null;
}

/** The unwrapped `GET /api/manual/my-tasks` payload. */
export interface MyTasksResult {
  items: ManualTask[];
}

/**
 * The filler's derived status for a task card / gate:
 *  - NEW       → never submitted, fillable
 *  - SUBMITTED → awaiting review, read-only
 *  - APPROVED  → accepted, read-only
 *  - REJECTED  → sent back, RE-fillable
 */
export type TaskDisplayStatus = 'NEW' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** Derive the card/gate status from the task's latest submission (pure — unit-tested). */
export function taskDisplayStatus(task: Pick<ManualTask, 'mySubmission'>): TaskDisplayStatus {
  return task.mySubmission?.status ?? 'NEW';
}

/**
 * Whether the task's form is editable by the vendor right now (pure — unit-tested).
 * NEW and REJECTED are fillable; SUBMITTED (under review) and APPROVED are read-only.
 */
export function isFillable(task: Pick<ManualTask, 'mySubmission'>): boolean {
  const s = taskDisplayStatus(task);
  return s === 'NEW' || s === 'REJECTED';
}

/**
 * Every required field that does NOT yet have a valid answer, in form order
 * (pure — unit-tested). Empty array ⇒ all required fields answered.
 */
export function missingRequiredFields(schema: ManualFormSchema, values: FormValues): FormField[] {
  return orderedFields(schema).filter((f) => f.required && !hasValue(f, values[f.id] ?? null));
}

/** True when every required field has a valid answer (pure — unit-tested). */
export function isComplete(schema: ManualFormSchema, values: FormValues): boolean {
  return missingRequiredFields(schema, values).length === 0;
}

/**
 * Assemble the submit payload's `formValues` from the working answer map (pure — unit-tested).
 *
 * Only fields declared in the schema are included, and only when they carry a real answer
 * (per `hasValue`) — this drops the transient empty strings / nulls the UI holds for untouched
 * optional fields so the backend sees a clean map. Media/GPS objects and primitives pass
 * through unchanged.
 */
export function buildFormValues(schema: ManualFormSchema, values: FormValues): FormValues {
  const out: FormValues = {};
  for (const f of orderedFields(schema)) {
    const v = values[f.id];
    if (v === undefined) continue;
    if (hasValue(f, v as FormValue)) out[f.id] = v as FormValue;
  }
  return out;
}

/** Fetch the vendor's assigned OPEN manual tasks. Returns the api-client ApiResponse. */
export function fetchMyTasks() {
  return api.get<MyTasksResult>('/api/manual/my-tasks');
}

/**
 * Submit a task's answers. The caller passes the RAW working values; this cleans them via
 * `buildFormValues(schema, …)` before POSTing so untouched optionals never reach the backend.
 * Returns the api-client ApiResponse — the caller surfaces a 400 (validation) / 409
 * ("already submitted" / "under review") honestly.
 */
export function submitTask(taskId: string, schema: ManualFormSchema, values: FormValues) {
  return api.post<{ id: string; status: SubmissionStatus; version: number }>(
    `/api/manual/tasks/${encodeURIComponent(taskId)}/submit`,
    { formValues: buildFormValues(schema, values) },
  );
}
