'use client';

/**
 * One editable field row in the task form-builder. Owns the per-type controls:
 *  - type picker (morphs the field, preserving id/label/required),
 *  - label + required,
 *  - DROPDOWN / MULTI_SELECT: an options editor (add / edit / remove),
 *  - CAMERA: geotag + geo-fence toggles + a capture instruction,
 *  - GPS_POINT: the capture trigger.
 * Reorder (up/down) and remove are surfaced via callbacks; the parent owns the array.
 */

import { GripVertical, ArrowUp, ArrowDown, Trash2, Plus, X } from 'lucide-react';
import { Select } from '@/components/ui/select';
import {
  type FormField,
  type FormFieldType,
  type GpsCaptureTrigger,
  FORM_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  OPTION_FIELD_TYPES,
  GPS_CAPTURE_TRIGGERS,
} from '@/lib/manual/form-types';
import { makeDraftField } from '@/lib/manual/admin-api';
import { cn } from '@/lib/utils';

const TYPE_OPTIONS = FORM_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] }));

const TRIGGER_LABELS: Record<GpsCaptureTrigger, string> = {
  ON_SUBMIT: 'On submit',
  ON_PHOTO: 'When a photo is taken',
  MANUAL: 'Manually by the rep',
};
const TRIGGER_OPTIONS = GPS_CAPTURE_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }));

function CheckRow({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-center gap-2 text-sm text-gray-700', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-[var(--brand-primary)] focus:ring-[var(--brand-primary)]/30"
      />
      {label}
    </label>
  );
}

export function FieldEditorRow({
  field,
  index,
  total,
  error,
  disabled = false,
  onChange,
  onMove,
  onRemove,
}: {
  field: FormField;
  index: number;
  total: number;
  error?: string;
  disabled?: boolean;
  onChange: (next: FormField) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const patch = (p: Partial<FormField>) => onChange({ ...field, ...p });

  const changeType = (type: FormFieldType) => {
    if (type === field.type) return;
    // Morph to a fresh field of the new type, preserving identity + label + required + order.
    const fresh = makeDraftField(type, field.order);
    onChange({ ...fresh, id: field.id, label: field.label, required: field.required });
  };

  const setOption = (i: number, value: string) => {
    const options = [...(field.options ?? [])];
    options[i] = value;
    patch({ options });
  };
  const addOption = () => patch({ options: [...(field.options ?? []), ''] });
  const removeOption = (i: number) => {
    const options = (field.options ?? []).filter((_, j) => j !== i);
    patch({ options: options.length ? options : [''] });
  };

  const isOptionType = OPTION_FIELD_TYPES.has(field.type);

  return (
    <div className={cn('rounded-2xl border bg-white p-4', error ? 'border-red-300' : 'border-gray-200')}>
      <div className="flex items-start gap-3">
        <div className="mt-2 text-gray-300">
          <GripVertical className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44 shrink-0">
              <Select
                label="Field type"
                options={TYPE_OPTIONS}
                value={field.type}
                onValueChange={(v) => changeType(v as FormFieldType)}
                disabled={disabled}
              />
            </div>
            <div className="min-w-0 flex-1">
              <label className="text-sm font-medium text-gray-700">Label</label>
              <input
                value={field.label}
                disabled={disabled}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder="e.g. Freezer front photo"
                maxLength={160}
                className={cn(
                  'mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400',
                  'focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors disabled:bg-gray-50',
                  error
                    ? 'border-red-400 focus:border-red-400 focus:ring-red-200'
                    : 'border-gray-300 focus:border-[var(--brand-primary)] focus:ring-[var(--brand-primary)]/20',
                )}
              />
            </div>
          </div>

          {/* Help text */}
          <div className="mt-3">
            <label className="text-sm font-medium text-gray-700">Help text (optional)</label>
            <input
              value={field.helpText ?? ''}
              disabled={disabled}
              onChange={(e) => patch({ helpText: e.target.value })}
              placeholder="Guidance shown under the field"
              maxLength={240}
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 disabled:bg-gray-50"
            />
          </div>

          {/* Options editor */}
          {isOptionType && (
            <div className="mt-3">
              <p className="text-sm font-medium text-gray-700">Options</p>
              <div className="mt-1.5 flex flex-col gap-2">
                {(field.options ?? []).map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={opt}
                      disabled={disabled}
                      onChange={(e) => setOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      maxLength={120}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 disabled:bg-gray-50"
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => removeOption(i)}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-40"
                      aria-label="Remove option"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={addOption}
                  className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/5 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                  Add option
                </button>
              </div>
            </div>
          )}

          {/* CAMERA controls */}
          {field.type === 'CAMERA' && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl bg-gray-50 p-3">
              <CheckRow
                checked={!!field.geotag}
                onChange={(v) => patch({ geotag: v })}
                label="Embed a GPS fix in the photo (geotag)"
                disabled={disabled}
              />
              <CheckRow
                checked={!!field.geoFenceRequired}
                onChange={(v) => patch({ geoFenceRequired: v })}
                label="Flag if the photo falls outside the outlet geo-fence"
                disabled={disabled}
              />
              <CheckRow
                checked={!!field.noGallery}
                onChange={(v) => patch({ noGallery: v })}
                label="Camera only — no gallery uploads"
                disabled={disabled}
              />
              <div>
                <label className="text-sm font-medium text-gray-700">Capture instruction (optional)</label>
                <input
                  value={field.instruction ?? ''}
                  disabled={disabled}
                  onChange={(e) => patch({ instruction: e.target.value })}
                  placeholder="e.g. Stand 2m back, capture the full freezer"
                  maxLength={200}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 disabled:bg-gray-50"
                />
              </div>
            </div>
          )}

          {/* GPS_POINT controls */}
          {field.type === 'GPS_POINT' && (
            <div className="mt-3 w-56">
              <Select
                label="Capture trigger"
                options={TRIGGER_OPTIONS}
                value={field.captureTrigger ?? 'ON_SUBMIT'}
                onValueChange={(v) => patch({ captureTrigger: v as GpsCaptureTrigger })}
                disabled={disabled}
              />
            </div>
          )}

          {/* Required + row actions */}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
            <CheckRow
              checked={field.required}
              onChange={(v) => patch({ required: v })}
              label="Required"
              disabled={disabled}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => onMove(-1)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                aria-label="Move up"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={disabled || index === total - 1}
                onClick={() => onMove(1)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                aria-label="Move down"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={onRemove}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                aria-label="Remove field"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export default FieldEditorRow;
