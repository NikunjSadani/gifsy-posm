'use client';

/**
 * Manual task detail — edit the task via the builder (form locked once submissions exist) and
 * review its submissions. Status can be toggled Open/Closed. Each submission row links into the
 * review page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, ChevronRight, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { DataTable, type Column } from '@/components/admin/data-table';
import { TaskBuilder, type BuilderPayload } from '@/components/manual/task-builder';
import { TaskStatusPill, SubmissionStatusPill } from '@/components/manual/status-pill';
import { orderedFields } from '@/lib/manual/form-types';
import {
  type ManualTaskDetail,
  type TaskSubmissionRow,
  type VendorLite,
  manualApi,
  submitterName,
  formatDateTime,
  isoToDateInput,
} from '@/lib/manual/admin-api';

export default function ManualTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [detail, setDetail] = useState<ManualTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorsError, setVendorsError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await manualApi.getTask(id);
    if (res.success) {
      setDetail(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error || 'Could not load this task.');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await manualApi.listVendors();
      if (res.success) setVendors(res.data);
      else setVendorsError(res.error || 'Could not load fleets.');
      setVendorsLoading(false);
    })();
  }, []);

  const fieldsLocked = (detail?.submissions.length ?? 0) > 0;

  const initial = useMemo(() => {
    if (!detail) return null;
    const t = detail; // getTask returns the task fields FLAT (+ submissions), not wrapped in `task`
    return {
      title: t.title,
      description: t.description ?? '',
      vendorId: t.vendorId ?? '',
      dueDate: isoToDateInput(t.dueDate),
      fields: orderedFields(t.formSchema),
      captureGpsOnSubmit: !!t.formSchema?.captureGpsOnSubmit,
    };
  }, [detail]);

  const onSubmit = async (payload: BuilderPayload) => {
    setSubmitting(true);
    setSaveError(null);
    const res = await manualApi.updateTask(id, {
      title: payload.title,
      description: payload.description,
      vendorId: payload.vendorId,
      dueDate: payload.dueDate,
      ...(payload.formSchema ? { formSchema: payload.formSchema } : {}),
    });
    setSubmitting(false);
    if (!res.success) {
      setSaveError(
        res.status === 409
          ? 'This task already has submissions, so its capture form can no longer change. Reload to see the latest.'
          : res.error || 'Could not save your changes.',
      );
      return;
    }
    toast.success('Task saved');
    void load();
  };

  const toggleStatus = async () => {
    if (!detail) return;
    const next = detail.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    setStatusBusy(true);
    const res = await manualApi.updateTask(id, { status: next });
    setStatusBusy(false);
    if (!res.success) {
      toast.error(res.error || 'Could not change the status.');
      return;
    }
    toast.success(next === 'CLOSED' ? 'Task closed' : 'Task reopened');
    void load();
  };

  const submissionColumns: Column<TaskSubmissionRow>[] = [
    { key: 'by', header: 'Submitted by', render: (s) => <span className="font-medium text-gray-900">{submitterName(s.submittedBy)}</span> },
    { key: 'status', header: 'Status', render: (s) => <SubmissionStatusPill status={s.status} /> },
    { key: 'version', header: 'Version', render: (s) => <span className="text-gray-600">v{s.version}</span> },
    { key: 'submitted', header: 'Submitted', render: (s) => <span className="text-gray-600">{formatDateTime(s.createdAt)}</span> },
    { key: 'reviewed', header: 'Reviewed', render: (s) => <span className="text-gray-600">{formatDateTime(s.reviewedAt)}</span> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (s) => (
        <Link
          href={`/admin/manual/submissions/${s.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          Review
          <ChevronRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError || !detail || !initial) {
    return (
      <div>
        <Link href="/admin/manual" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" />
          Manual tasks
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-red-700">{loadError || 'Task not found.'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const task = detail;

  return (
    <div>
      <Link href="/admin/manual" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" />
        Manual tasks
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">{task.title}</h1>
          <TaskStatusPill status={task.status} />
        </div>
        <Button variant="outline" onClick={toggleStatus} loading={statusBusy}>
          {task.status === 'OPEN' ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          {task.status === 'OPEN' ? 'Close task' : 'Reopen task'}
        </Button>
      </div>

      <TaskBuilder
        mode="edit"
        initial={initial}
        vendors={vendors}
        vendorsLoading={vendorsLoading}
        vendorsError={vendorsError}
        fieldsLocked={fieldsLocked}
        submitting={submitting}
        error={saveError}
        submitLabel="Save changes"
        onSubmit={onSubmit}
        onCancel={() => router.push('/admin/manual')}
      />

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Submissions <span className="text-gray-400">({detail.submissions.length})</span>
        </h2>
        <DataTable
          columns={submissionColumns}
          rows={detail.submissions}
          rowKey={(s) => s.id}
          emptyTitle="No submissions yet"
          emptyDescription="Nothing has come in from the field for this task."
        />
      </div>
    </div>
  );
}
