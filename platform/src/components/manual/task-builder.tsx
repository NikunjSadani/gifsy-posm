'use client';

/**
 * The manual-task builder — shared by the create and edit pages. Owns the working draft
 * (title / description / target fleet / due date + the field list + captureGpsOnSubmit),
 * runs client-side validation, and hands the parent an assembled, backend-valid payload.
 * The parent owns the actual create/update call and passes back a form-level `error`.
 *
 * When `fieldsLocked` is set (the task already has submissions), the field builder is
 * read-only and the assembled schema is NOT sent — only the meta (title/target/due/status)
 * is editable, matching the backend rule (formSchema is immutable once submissions exist).
 */

import { useMemo, useState } from 'react';
import { Plus, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FieldEditorRow } from './field-editor-row';
import {
  type FormField,
  type FormFieldType,
  FORM_FIELD_TYPES,
  FIELD_TYPE_LABELS,
} from '@/lib/manual/form-types';
import {
  type VendorLite,
  ALL_FLEETS,
  assembleSchema,
  validateBuilder,
  builderIsValid,
  makeDraftField,
  moveField,
  dateInputToIso,
} from '@/lib/manual/admin-api';

export interface BuilderInitial {
  title: string;
  description: string;
  /** '' = all fleets. */
  vendorId: string;
  /** yyyy-mm-dd, or ''. */
  dueDate: string;
  fields: FormField[];
  captureGpsOnSubmit: boolean;
}

export interface BuilderPayload {
  title: string;
  description: string;
  vendorId: string | null;
  dueDate: string | null;
  /** Present only when the field builder is editable (schema may have changed). */
  formSchema?: ReturnType<typeof assembleSchema>;
}

const TYPE_OPTIONS = FORM_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }));

export function TaskBuilder({
  mode,
  initial,
  vendors,
  vendorsLoading = false,
  vendorsError,
  fieldsLocked = false,
  submitting = false,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial: BuilderInitial;
  vendors: VendorLite[];
  vendorsLoading?: boolean;
  vendorsError?: string | null;
  fieldsLocked?: boolean;
  submitting?: boolean;
  error?: string | null;
  submitLabel: string;
  onSubmit: (payload: BuilderPayload) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [vendorId, setVendorId] = useState(initial.vendorId);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [fields, setFields] = useState<FormField[]>(initial.fields);
  const [captureGpsOnSubmit, setCaptureGpsOnSubmit] = useState(initial.captureGpsOnSubmit);
  const [addType, setAddType] = useState<FormFieldType>('TEXT');
  const [attempted, setAttempted] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const schema = useMemo(
    () => assembleSchema(fields, captureGpsOnSubmit),
    [fields, captureGpsOnSubmit],
  );
  const builderErrors = useMemo(() => validateBuilder(schema), [schema]);

  const vendorOptions = useMemo(
    () => [
      { value: ALL_FLEETS, label: 'All fleets' },
      ...vendors.map((v) => ({ value: v.id, label: v.name ? `${v.name}${v.code ? ` (${v.code})` : ''}` : v.id })),
    ],
    [vendors],
  );

  const addField = () => {
    setFields((prev) => [...prev, makeDraftField(addType, prev.length)]);
  };
  const changeField = (i: number, next: FormField) => {
    setFields((prev) => prev.map((f, j) => (j === i ? next : f)));
  };
  const removeFieldAt = (i: number) => {
    setFields((prev) => prev.filter((_, j) => j !== i).map((f, k) => ({ ...f, order: k })));
  };

  const submit = () => {
    setAttempted(true);
    const tErr = title.trim() ? null : 'Give the task a title.';
    setTitleError(tErr);
    // The field builder only gates the create/edit when it's editable.
    const schemaOk = fieldsLocked || builderIsValid(builderErrors);
    if (tErr || !schemaOk) return;

    onSubmit({
      title: title.trim(),
      description: description.trim(),
      vendorId: vendorId === ALL_FLEETS || vendorId === '' ? null : vendorId,
      dueDate: dateInputToIso(dueDate) ?? null,
      ...(fieldsLocked ? {} : { formSchema: schema }),
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) submit();
      }}
      className="flex flex-col gap-6"
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Task meta */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Task details</h2>
        <div className="mt-4 flex flex-col gap-4">
          <Input
            label="Title"
            placeholder="e.g. Monsoon freezer visibility check"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError(null);
            }}
            error={titleError ?? undefined}
            maxLength={160}
            autoFocus
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the field team capture, and why?"
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Target fleet"
              options={vendorOptions}
              value={vendorId === '' ? ALL_FLEETS : vendorId}
              onValueChange={(v) => setVendorId(v)}
              placeholder={vendorsLoading ? 'Loading fleets…' : 'Select…'}
              error={vendorsError ?? undefined}
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">Due date (optional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Form builder */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Capture form</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              The fields the field team fills in when they complete this task.
            </p>
          </div>
        </div>

        {fieldsLocked && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This task already has submissions, so its capture form is locked to keep every answer
              comparable. You can still edit the title, target, due date and status.
            </span>
          </div>
        )}

        {attempted && !fieldsLocked && builderErrors.general.length > 0 && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <ul className="list-inside list-disc space-y-0.5">
              {builderErrors.general.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {fields.length === 0 && (
            <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
              No fields yet. Add your first field below.
            </p>
          )}
          {fields.map((f, i) => (
            <FieldEditorRow
              key={f.id}
              field={f}
              index={i}
              total={fields.length}
              disabled={fieldsLocked}
              error={attempted && !fieldsLocked ? builderErrors.byField[f.id] : undefined}
              onChange={(next) => changeField(i, next)}
              onMove={(dir) => setFields((prev) => moveField(prev, i, dir))}
              onRemove={() => removeFieldAt(i)}
            />
          ))}
        </div>

        {!fieldsLocked && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4">
            <div className="w-52">
              <Select
                label="Add a field"
                options={TYPE_OPTIONS}
                value={addType}
                onValueChange={(v) => setAddType(v as FormFieldType)}
              />
            </div>
            <Button type="button" variant="outline" onClick={addField}>
              <Plus className="h-4 w-4" />
              Add field
            </Button>
          </div>
        )}

        {!fieldsLocked && (
          <label className="mt-5 flex items-center gap-2 border-t border-gray-100 pt-4 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={captureGpsOnSubmit}
              onChange={(e) => setCaptureGpsOnSubmit(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-[var(--brand-primary)] focus:ring-[var(--brand-primary)]/30"
            />
            Capture a GPS fix when the form is submitted (requires a GPS location field)
          </label>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export default TaskBuilder;
