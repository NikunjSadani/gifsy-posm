'use client';

/**
 * My Tasks — the vendor's assigned manual (ad-hoc) tasks. Each card shows the title, due date,
 * and a status chip (New / Submitted / Approved / Rejected); a rejected task surfaces the
 * admin's rejection reason and stays tappable so the vendor can re-fill and re-submit. Approved
 * and under-review tasks open read-only.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, ChevronRight, AlertCircle, RotateCw } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { TaskStatusChip } from '@/components/field/tasks/TaskStatusChip';
import { fetchMyTasks, taskDisplayStatus, type ManualTask } from '@/lib/manual/field-api';

/** Friendly due-date line, or null when the task has no due date. */
function formatDue(dueDate?: string | null): string | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<ManualTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchMyTasks();
    if (res.success) {
      setTasks(res.data.items ?? []);
      setError(null);
    } else {
      setError(
        res.status === 403
          ? 'Tasks are not available for your account. Please ask your admin to grant access.'
          : res.error || 'Could not load your tasks.',
      );
      setTasks([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="px-4 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">My Tasks</h1>
        {!loading && !error && tasks.length > 0 && (
          <button
            onClick={load}
            aria-label="Refresh"
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 active:scale-95 transition-transform"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="text-center py-16 px-6">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-primary-light)]">
            <AlertCircle className="h-6 w-6 text-[var(--brand-primary)]" />
          </div>
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={load}
            className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 py-3 text-sm font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
          >
            <RotateCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
            <ClipboardList className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No tasks assigned</p>
          <p className="mt-1 text-xs text-gray-500">New tasks assigned to you will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2.5 pb-4">
          {tasks.map((task) => {
            const status = taskDisplayStatus(task);
            const due = formatDue(task.dueDate);
            const rejection = status === 'REJECTED' ? task.mySubmission?.rejectionReason : null;
            return (
              <Link
                key={task.id}
                href={`/field/tasks/${task.id}`}
                className="block rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-transform active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-bold text-gray-900">{task.title}</h2>
                    {task.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{task.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <TaskStatusChip status={status} />
                      {due && <span className="text-xs text-gray-400">Due {due}</span>}
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                </div>

                {rejection && (
                  <div className="mt-3 flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <span className="font-semibold">Rejected:</span> {rejection}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
