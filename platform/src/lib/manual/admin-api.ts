/* ─── Manual-tasks admin — typed API client + pure helpers ────────────────────
   The ADMIN side of the manual-tasks module: define/list ad-hoc capture tasks,
   review their submissions, approve/reject. Thin wrappers over the central `api`
   fetch helper (ApiResponse envelope, httpOnly-cookie auth through the /api proxy),
   plus the pure builder/formatting helpers the pages + components share. The pure
   helpers are unit-tested under `__tests__` — keep them free of React/fetch/DOM.

   The form-field model itself lives in the SHARED contract `./form-types` (the exact
   shape the backend validates against) — imported here, never redefined.
─────────────────────────────────────────────────────────────────────────────── */

import { api, type ApiResponse } from '@/lib/api-client';
import {
  type FormField,
  type FormFieldType,
  type FormValue,
  type ManualFormSchema,
  type MediaValue,
  type GpsCapture,
  OPTION_FIELD_TYPES,
  MEDIA_FIELD_TYPES,
} from './form-types';

// ── Domain types (mirror the backend manual-tasks API) ───────────────────────

export type TaskStatus = 'OPEN' | 'CLOSED';
export type SubmissionStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface SubmitterRef {
  id: string;
  name: string;
}

export interface TaskCounts {
  submitted: number;
  approved: number;
  rejected: number;
  total: number;
}

/** A row in the task list. */
export interface ManualTaskListItem {
  id: string;
  title: string;
  description: string | null;
  vendorId: string | null;
  vendorName?: string | null;
  dueDate: string | null;
  status: TaskStatus;
  createdAt: string;
  submissionCounts: TaskCounts;
}

export interface ManualTaskListResult {
  items: ManualTaskListItem[];
  total: number;
  page: number;
  limit: number;
}

/** The full task record (carries the formSchema). */
export interface ManualTask {
  id: string;
  title: string;
  description: string | null;
  vendorId: string | null;
  vendorName?: string | null;
  dueDate: string | null;
  status: TaskStatus;
  createdAt: string;
  formSchema: ManualFormSchema;
}

/** A submission row inside a task's detail. */
export interface TaskSubmissionRow {
  id: string;
  submittedBy: SubmitterRef;
  vendorId: string | null;
  status: SubmissionStatus;
  version: number;
  reviewedAt: string | null;
  createdAt: string;
}

/**
 * GET /api/manual/tasks/:id returns the task fields FLAT (not wrapped in `task`), with its
 * submissions alongside — so the detail is `ManualTask & { createdById, updatedAt, submissions }`.
 */
export interface ManualTaskDetail extends ManualTask {
  createdById?: string;
  updatedAt?: string;
  submissions: TaskSubmissionRow[];
}

/** A row in the cross-task submissions queue. */
export interface SubmissionListItem {
  id: string;
  taskId: string;
  taskTitle: string;
  submittedBy: SubmitterRef;
  vendorId: string | null;
  status: SubmissionStatus;
  version: number;
  createdAt: string;
}

export interface SubmissionListResult {
  items: SubmissionListItem[];
  total: number;
  page: number;
  limit: number;
}

/** One answer, paired with the field it answers. */
export interface SubmissionValueRow {
  field: FormField;
  value: FormValue;
  media?: { key: string; viewPath: string; geo?: GpsCapture } | null;
}

export interface SubmissionDetail {
  id: string;
  task: { id: string; title: string; formSchema: ManualFormSchema };
  submittedBy: SubmitterRef;
  vendorId: string | null;
  status: SubmissionStatus;
  version: number;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  values: SubmissionValueRow[];
}

/** Minimal vendor shape for the target picker. */
export interface VendorLite {
  id: string;
  code: string;
  name: string;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  /** null (or absent) = every fleet. */
  vendorId?: string | null;
  /** ISO date-time. */
  dueDate?: string | null;
  formSchema: ManualFormSchema;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
  vendorId?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  /** Only changeable while the task has 0 submissions (backend 409 otherwise). */
  formSchema?: ManualFormSchema;
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

export const ALL_FLEETS = '__ALL__';

/** Human label for a task's target fleet. */
export function targetLabel(vendorName?: string | null, vendorId?: string | null): string {
  if (!vendorId) return 'All fleets';
  return vendorName?.trim() || 'Assigned fleet';
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
};

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  SUBMITTED: 'Awaiting review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/** Build the querystring for the task list (omits empty filters). */
export function buildTaskListQuery(params: {
  status?: TaskStatus | 'ALL';
  vendorId?: string;
  page?: number;
  limit?: number;
}): string {
  const p = new URLSearchParams();
  if (params.status && params.status !== 'ALL') p.set('status', params.status);
  if (params.vendorId) p.set('vendorId', params.vendorId);
  p.set('page', String(params.page ?? 1));
  p.set('limit', String(params.limit ?? 20));
  return p.toString();
}

/** Build the querystring for the submissions queue. */
export function buildSubmissionListQuery(params: {
  status?: SubmissionStatus;
  taskId?: string;
  page?: number;
  limit?: number;
}): string {
  const p = new URLSearchParams();
  if (params.status) p.set('status', params.status);
  if (params.taskId) p.set('taskId', params.taskId);
  p.set('page', String(params.page ?? 1));
  p.set('limit', String(params.limit ?? 20));
  return p.toString();
}

/** Same-origin media URL for a stored object key. */
export function mediaViewUrl(key: string): string {
  return `/api/media/view?key=${encodeURIComponent(key)}`;
}

/**
 * Resolve a media answer to a same-origin viewable URL. Prefers a backend-provided
 * viewPath (mapping the backend `/v1/` surface onto the proxied `/api/`), falling
 * back to building the URL from the object key.
 */
export function resolveMediaUrl(media: { key: string; viewPath?: string | null } | null | undefined): string | null {
  if (!media) return null;
  if (media.viewPath && media.viewPath.trim()) {
    const path = media.viewPath.trim();
    if (path.startsWith('/v1/')) return `/api/${path.slice('/v1/'.length)}`;
    if (path.startsWith('/api/')) return path;
    // A relative or already-mapped path — trust it as-is if it points at media.
    return path;
  }
  if (media.key) return mediaViewUrl(media.key);
  return null;
}

/** Best-effort display name for a submitter (tolerates a bare string). */
export function submitterName(s: SubmitterRef | string | null | undefined): string {
  if (!s) return 'Unknown';
  if (typeof s === 'string') return s || 'Unknown';
  return s.name?.trim() || 'Unknown';
}

/** Format a date-time ISO string for display, or '—'. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format a due date (date only), or '—'. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Whether a due date is strictly in the past (used to flag overdue tasks). */
export function isOverdue(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < now.getTime();
}

/** Convert a <input type="date"> value (yyyy-mm-dd) to an ISO string, or undefined. */
export function dateInputToIso(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Convert an ISO string to a <input type="date"> value (yyyy-mm-dd), or ''. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a non-media answer as display text. CAMERA answers return '' (rendered as
 * a photo by the viewer, not text). Returns '—' for an empty/missing answer.
 */
export function formatAnswer(field: FormField, value: FormValue): string {
  if (MEDIA_FIELD_TYPES.has(field.type)) return '';
  if (value == null) return '—';

  switch (field.type) {
    case 'TOGGLE':
      return value === true ? 'Yes' : value === false ? 'No' : '—';
    case 'MULTI_SELECT': {
      if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
      return String(value);
    }
    case 'DATE': {
      if (typeof value === 'string') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? value : formatDate(value);
      }
      return String(value);
    }
    case 'GPS_POINT': {
      const g = value as unknown as GpsCapture;
      if (g && typeof g === 'object' && typeof g.lat === 'number' && typeof g.lng === 'number') {
        return `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`;
      }
      return '—';
    }
    case 'NUMBER':
      return typeof value === 'number' ? String(value) : String(value ?? '—');
    default: {
      if (typeof value === 'string') return value.trim() || '—';
      return String(value);
    }
  }
}

/** Pull the {lat,lng} out of a GPS_POINT answer, if present. */
export function readGps(value: FormValue): GpsCapture | null {
  const g = value as unknown as GpsCapture;
  if (g && typeof g === 'object' && typeof g.lat === 'number' && typeof g.lng === 'number') return g;
  return null;
}

/** Pull the media object ({key, geo?}) out of a CAMERA answer, if present. */
export function readMedia(value: FormValue): MediaValue | null {
  if (value && typeof value === 'object' && 'key' in (value as object)) {
    const m = value as MediaValue;
    return m.key ? m : null;
  }
  if (typeof value === 'string' && value.trim()) return { key: value };
  return null;
}

// ── Form builder (pure) ──────────────────────────────────────────────────────

/** Generate a stable, unique field id (crypto.randomUUID with a fallback). */
export function newFieldId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `f_${c.randomUUID()}`;
  } catch {
    /* fall through */
  }
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh field of the given type with sensible per-type defaults. */
export function makeDraftField(type: FormFieldType, order: number): FormField {
  const base: FormField = {
    id: newFieldId(),
    type,
    label: '',
    required: false,
    order,
  };
  if (OPTION_FIELD_TYPES.has(type)) base.options = [''];
  if (type === 'CAMERA') {
    base.geotag = true;
    base.geoFenceRequired = false;
  }
  if (type === 'GPS_POINT') base.captureTrigger = 'ON_SUBMIT';
  return base;
}

/** Move a field up/down within the list, returning a new array (out-of-range = unchanged). */
export function moveField(fields: FormField[], index: number, dir: -1 | 1): FormField[] {
  const target = index + dir;
  if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) return fields;
  const next = [...fields];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next.map((f, i) => ({ ...f, order: i }));
}

/**
 * Clean the working field list into a backend-valid ManualFormSchema:
 *  - re-index `order` sequentially by current position,
 *  - trim labels; trim + drop empty options; strip options off non-option fields,
 *  - strip per-type-only props off fields that don't own them.
 * (Does NOT validate — call validateBuilder for that.)
 */
export function assembleSchema(fields: FormField[], captureGpsOnSubmit: boolean): ManualFormSchema {
  const cleaned: FormField[] = fields.map((f, i) => {
    const out: FormField = {
      id: f.id || newFieldId(),
      type: f.type,
      label: f.label.trim(),
      required: !!f.required,
      order: i,
    };
    if (f.placeholder?.trim()) out.placeholder = f.placeholder.trim();
    if (f.helpText?.trim()) out.helpText = f.helpText.trim();
    if (OPTION_FIELD_TYPES.has(f.type)) {
      out.options = (f.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
    }
    if (f.type === 'CAMERA') {
      out.geotag = !!f.geotag;
      out.geoFenceRequired = !!f.geoFenceRequired;
      if (f.noGallery) out.noGallery = true;
      if (f.instruction?.trim()) out.instruction = f.instruction.trim();
      if (typeof f.gpsMaxAccuracy === 'number' && f.gpsMaxAccuracy > 0) out.gpsMaxAccuracy = f.gpsMaxAccuracy;
    }
    if (f.type === 'GPS_POINT') {
      out.captureTrigger = f.captureTrigger ?? 'ON_SUBMIT';
      if (typeof f.gpsMaxAccuracy === 'number' && f.gpsMaxAccuracy > 0) out.gpsMaxAccuracy = f.gpsMaxAccuracy;
    }
    return out;
  });
  return { captureGpsOnSubmit, fields: cleaned };
}

export interface BuilderErrors {
  /** Whole-form problems (not tied to a single field). */
  general: string[];
  /** field.id → message. */
  byField: Record<string, string>;
}

/**
 * Validate an ASSEMBLED schema client-side before submit (the backend stays the real
 * authority). Rules: ≥1 field; every field labelled; unique ids; option fields carry
 * ≥1 non-empty option; captureGpsOnSubmit requires a GPS_POINT field.
 */
export function validateBuilder(schema: ManualFormSchema): BuilderErrors {
  const errors: BuilderErrors = { general: [], byField: {} };
  const { fields } = schema;

  if (fields.length === 0) {
    errors.general.push('Add at least one field to the capture form.');
  }

  const seen = new Set<string>();
  for (const f of fields) {
    if (!f.id) {
      errors.general.push('A field is missing its identifier.');
    } else if (seen.has(f.id)) {
      errors.general.push('Two fields share the same identifier.');
    } else {
      seen.add(f.id);
    }
    if (!f.label.trim()) {
      errors.byField[f.id] = 'Give this field a label.';
    } else if (OPTION_FIELD_TYPES.has(f.type) && (!f.options || f.options.length === 0)) {
      errors.byField[f.id] = 'Add at least one option.';
    }
  }

  if (schema.captureGpsOnSubmit && !fields.some((f) => f.type === 'GPS_POINT')) {
    errors.general.push('“Capture GPS on submit” needs a GPS location field to hold the fix.');
  }

  return errors;
}

/** True when a BuilderErrors has no entries. */
export function builderIsValid(errors: BuilderErrors): boolean {
  return errors.general.length === 0 && Object.keys(errors.byField).length === 0;
}

// ── Vendor list tolerance ────────────────────────────────────────────────────

/** The vendors endpoint returns a bare array today; tolerate a `{vendors:[…]}` wrapper too. */
export function parseVendorList(data: unknown): VendorLite[] {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray((data as { vendors?: unknown[] })?.vendors)
      ? (data as { vendors: unknown[] }).vendors
      : [];
  return raw
    .map((v) => v as { id?: string; code?: string; name?: string })
    .filter((v) => typeof v.id === 'string')
    .map((v) => ({ id: v.id as string, code: v.code ?? '', name: v.name ?? '' }));
}

// ── Typed client ─────────────────────────────────────────────────────────────

export const manualApi = {
  listTasks: (params: { status?: TaskStatus | 'ALL'; vendorId?: string; page?: number; limit?: number } = {}) =>
    api.get<ManualTaskListResult>(`/api/manual/tasks?${buildTaskListQuery(params)}`),

  getTask: (id: string) => api.get<ManualTaskDetail>(`/api/manual/tasks/${id}`),

  createTask: (body: CreateTaskBody) => api.post<ManualTask>('/api/manual/tasks', body),

  updateTask: (id: string, body: UpdateTaskBody) => api.patch<ManualTask>(`/api/manual/tasks/${id}`, body),

  listSubmissions: (params: { status?: SubmissionStatus; taskId?: string; page?: number; limit?: number } = {}) =>
    api.get<SubmissionListResult>(`/api/manual/submissions?${buildSubmissionListQuery(params)}`),

  getSubmission: (id: string) => api.get<SubmissionDetail>(`/api/manual/submissions/${id}`),

  approveSubmission: (id: string) => api.post<{ ok: true }>(`/api/manual/submissions/${id}/approve`, {}),

  rejectSubmission: (id: string, reason: string) =>
    api.post<{ ok: true }>(`/api/manual/submissions/${id}/reject`, { reason }),

  /** Vendor master for the target picker (tolerates array or {vendors} shapes). */
  async listVendors(): Promise<ApiResponse<VendorLite[]>> {
    const res = await api.get<unknown>('/api/vendors');
    if (!res.success) return res;
    return { success: true, data: parseVendorList(res.data) };
  },
};
