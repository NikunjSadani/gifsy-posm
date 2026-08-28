import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type { TaskDisplayStatus } from '@/lib/manual/field-api';

/** Chip styling per task status (dot colour + label + Badge variant). */
const STATUS_META: Record<
  TaskDisplayStatus,
  { label: string; variant: BadgeVariant; dot: string }
> = {
  NEW: { label: 'New', variant: 'info', dot: '#2563eb' },
  SUBMITTED: { label: 'Submitted', variant: 'warning', dot: '#d97706' },
  APPROVED: { label: 'Approved', variant: 'success', dot: '#16a34a' },
  REJECTED: { label: 'Rejected', variant: 'danger', dot: '#dc2626' },
};

/** A small status chip for a manual task (New / Submitted / Approved / Rejected). */
export function TaskStatusChip({ status }: { status: TaskDisplayStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
      {meta.label}
    </Badge>
  );
}

export default TaskStatusChip;
