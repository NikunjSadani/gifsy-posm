'use client';

/**
 * Manual tasks — the admin console list. Ad-hoc, admin-defined capture tasks targeted at a
 * fleet (or all fleets). Filter by status + target; each row shows its submission counts and
 * links into the task detail (submissions + edit). "New task" opens the builder.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, ChevronRight, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/admin/data-table';
import { TaskStatusPill } from '@/components/manual/status-pill';
import {
  type ManualTaskListItem,
  type TaskStatus,
  type VendorLite,
  manualApi,
  targetLabel,
  formatDate,
  isOverdue,
  ALL_FLEETS,
} from '@/lib/manual/admin-api';

const PAGE_SIZE = 20;

type StatusFilter = TaskStatus | 'ALL';

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
];

function CountChips({ counts }: { counts: ManualTaskListItem['submissionCounts'] }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700" title="Awaiting review">
        {counts.submitted} to review
      </span>
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700" title="Approved">
        {counts.approved} ✓
      </span>
      {counts.rejected > 0 && (
        <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700" title="Rejected">
          {counts.rejected} ✗
        </span>
      )}
    </div>
  );
}

export default function ManualTasksPage() {
  const [items, setItems] = useState<ManualTaskListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [vendorId, setVendorId] = useState<string>(ALL_FLEETS);
  const [vendors, setVendors] = useState<VendorLite[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await manualApi.listVendors();
      if (res.success) setVendors(res.data);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await manualApi.listTasks({
      status,
      vendorId: vendorId === ALL_FLEETS ? undefined : vendorId,
      page,
      limit: PAGE_SIZE,
    });
    if (res.success) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setLoadError(null);
    } else {
      setLoadError(res.error || 'Could not load manual tasks.');
    }
    setLoading(false);
  }, [status, vendorId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [status, vendorId]);

  const vendorOptions = useMemo(
    () => [
      { value: ALL_FLEETS, label: 'All fleets' },
      ...vendors.map((v) => ({ value: v.id, label: v.name || v.id })),
    ],
    [vendors],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<ManualTaskListItem>[] = [
    {
      key: 'title',
      header: 'Task',
      render: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{t.title}</p>
          {t.description && <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-gray-500">{t.description}</p>}
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      render: (t) => <span className="text-gray-700">{targetLabel(t.vendorName, t.vendorId)}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      render: (t) =>
        t.dueDate ? (
          <span className={isOverdue(t.dueDate) && t.status === 'OPEN' ? 'font-medium text-red-600' : 'text-gray-700'}>
            {formatDate(t.dueDate)}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    { key: 'status', header: 'Status', render: (t) => <TaskStatusPill status={t.status} /> },
    { key: 'counts', header: 'Submissions', render: (t) => <CountChips counts={t.submissionCounts} /> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (t) => (
        <Link
          href={`/admin/manual/${t.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          Open
          <ChevronRight className="h-4 w-4" />
        </Link>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <ClipboardList className="h-5 w-5 text-[var(--brand-primary)]" />
            Manual tasks
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">Ad-hoc capture tasks you define and review yourself.</p>
        </div>
        <Link href="/admin/manual/new">
          <Button variant="primary">
            <Plus className="h-4 w-4" />
            New task
          </Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={status}
            onValueChange={(v) => setStatus(v as StatusFilter)}
          />
        </div>
        <div className="w-56">
          <Select label="Target fleet" options={vendorOptions} value={vendorId} onValueChange={setVendorId} />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(t) => t.id}
        loading={loading}
        error={loadError}
        emptyTitle={status !== 'ALL' || vendorId !== ALL_FLEETS ? 'No matching tasks' : 'No manual tasks yet'}
        emptyDescription={
          status !== 'ALL' || vendorId !== ALL_FLEETS
            ? 'Try clearing the filters.'
            : 'Create your first task to send a capture form to the field.'
        }
      />

      {!loading && !loadError && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages} · {total} tasks
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
