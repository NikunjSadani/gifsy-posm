import { Badge } from '@/components/ui/badge';
import {
  type TaskStatus,
  type SubmissionStatus,
  TASK_STATUS_LABELS,
  SUBMISSION_STATUS_LABELS,
} from '@/lib/manual/admin-api';

/** Open / Closed pill for a manual task. */
export function TaskStatusPill({ status }: { status: TaskStatus }) {
  return (
    <Badge variant={status === 'OPEN' ? 'success' : 'default'}>{TASK_STATUS_LABELS[status]}</Badge>
  );
}

/** Awaiting-review / Approved / Rejected pill for a submission. */
export function SubmissionStatusPill({ status }: { status: SubmissionStatus }) {
  const variant = status === 'APPROVED' ? 'success' : status === 'REJECTED' ? 'danger' : 'warning';
  return <Badge variant={variant}>{SUBMISSION_STATUS_LABELS[status]}</Badge>;
}
