import { Badge } from '@/components/ui/badge';

/** Active / Inactive pill shared by every masters table (isActive boolean or a site status). */
export function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? 'success' : 'default'}>{active ? 'Active' : 'Inactive'}</Badge>
  );
}

export default StatusBadge;
