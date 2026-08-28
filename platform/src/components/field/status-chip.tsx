import { Badge } from '@/components/ui/badge';
import type { SiteStatus } from '@/lib/field/sites';

/** A small status chip for a site (ACTIVE = green, INACTIVE = gray). */
export function StatusChip({ status }: { status: SiteStatus }) {
  return (
    <Badge variant={status === 'ACTIVE' ? 'success' : 'default'}>
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: status === 'ACTIVE' ? '#16a34a' : '#9ca3af' }}
      />
      {status === 'ACTIVE' ? 'Active' : 'Inactive'}
    </Badge>
  );
}

export default StatusChip;
