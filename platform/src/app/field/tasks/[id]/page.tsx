'use client';

/**
 * Manual-task form filler — render every field of the task's `formSchema` to the right input,
 * enforce required fields client-side, and submit the assembled `formValues`.
 *
 * The backend has no single-task GET; we load the vendor's `my-tasks` list and find this id
 * (the list is already fleet-scoped). NEW / REJECTED tasks are fillable and submittable;
 * SUBMITTED (under review) and APPROVED tasks render read-only with a status note. On a
 * successful submit we show a confirmation and route back to the list. Type/required/options/
 * media/geo are RE-VALIDATED server-side — a 400 (validation) or 409 (already submitted /
 * under review) is surfaced honestly.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { FieldInput } from '@/components/field/tasks/FieldInput';
import { TaskStatusChip } from '@/components/field/tasks/TaskStatusChip';
import { orderedFields, type FormValues, type FormValue } from '@/lib/manual/form-types';
import {
  fetchMyTasks,
  submitTask,
  taskDisplayStatus,
  isFillable,
  isComplete,
  type ManualTask,
} from '@/lib/manual/field-api';

export default function TaskFillerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [task, setTask] = useState<ManualTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const res = await fetchMyTasks();
      if (!alive) return;
      if (res.success) {
        const found = (res.data.items ?? []).find((t) => t.id === id) ?? null;
        setTask(found);
        setError(found ? null : 'This task is no longer available.');
      } else {
        setError(
          res.status === 403
            ? 'Tasks are not available for your account. Please ask your admin to grant access.'
            : res.error || 'Could not load this task.',
        );
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const onFieldChange = useCallback((fieldId: string, value: FormValue) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const fillable = task ? isFillable(task) : false;
  const status = task ? taskDisplayStatus(task) : 'NEW';
  const complete = useMemo(() => (task ? isComplete(task.formSchema, values) : false), [task, values]);
  const canSubmit = fillable && complete && !submitting;

  const submit = async () => {
    if (!task || !canSubmit) return;
    setSubmitting(true);
    const res = await submitTask(task.id, task.formSchema, values);
    setSubmitting(false);
    if (!res.success) {
      // 409 = already submitted / under review; 400 = validation. Surface honestly.
      toast.error(res.error || 'Could not submit. Please review your answers and try again.');
      return;
    }
    setDone(true);
    toast.success('Submitted for review.');
    setTimeout(() => router.push('/field/tasks'), 1200);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="px-4 pt-4">
        <BackButton onClick={() => router.push('/field/tasks')} />
        <div className="mt-6 text-center px-6">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-primary-light)]">
            <AlertCircle className="h-6 w-6 text-[var(--brand-primary)]" />
          </div>
          <p className="text-sm text-gray-600">{error ?? 'Task not found.'}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="px-4 pt-4">
        <div className="mt-10 text-center px-6">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
            <CheckCircle2 className="h-8 w-8 text-[var(--brand-confirm)]" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Submitted for review</h1>
          <p className="mt-1.5 text-sm text-gray-500">Your admin will review it shortly. Returning to your tasks…</p>
        </div>
      </div>
    );
  }

  const fields = orderedFields(task.formSchema);
  const rejection = status === 'REJECTED' ? task.mySubmission?.rejectionReason : null;

  return (
    <div className="px-4 pt-4">
      <BackButton onClick={() => router.push('/field/tasks')} />

      <div className="mb-1 flex items-start justify-between gap-3">
        <h1 className="text-lg font-bold text-gray-900">{task.title}</h1>
        <div className="mt-1 shrink-0">
          <TaskStatusChip status={status} />
        </div>
      </div>
      {task.description && <p className="text-sm text-gray-500">{task.description}</p>}

      {/* Rejected: show the reason and invite a re-submit. */}
      {rejection && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Rejected:</span> {rejection}
            <span className="mt-1 block text-xs text-red-600/80">Please correct your answers and submit again.</span>
          </span>
        </div>
      )}

      {/* Read-only note for under-review / approved. */}
      {!fillable && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-blue-50 p-4 text-sm text-blue-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {status === 'APPROVED'
              ? 'This task was approved. It is read-only.'
              : 'This submission is under review. It is read-only until your admin responds.'}
          </span>
        </div>
      )}

      <div className="mt-5 space-y-5">
        {fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            onChange={onFieldChange}
            disabled={!fillable}
          />
        ))}
      </div>

      {fillable && (
        <div className="sticky bottom-0 -mx-4 mt-6 border-t border-gray-100 bg-gray-50/95 px-4 py-3 backdrop-blur">
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-4 text-lg font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Submitting…
              </>
            ) : status === 'REJECTED' ? (
              'Re-submit'
            ) : (
              'Submit'
            )}
          </button>
          {!complete && !submitting && (
            <p className="mt-2 text-center text-xs text-gray-400">
              Answer all required fields (marked *) to enable submit.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 active:scale-95 transition-transform"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  );
}
