'use client';

/**
 * Honest geo-fence status chip. Renders exactly what the backend reported via the tri-state
 * `geoFenceOk` (true / false / null) — it never claims "GPS verified" when the backend did
 * not confirm an in-fence fix.
 */

import { MapPin, MapPinOff, MapPinnedIcon } from 'lucide-react';
import { geoStatus, geoStatusLabel } from '@/lib/audit/api';

export function GeoBadge({
  geoFenceOk,
  className = '',
}: {
  geoFenceOk: boolean | null | undefined;
  className?: string;
}) {
  const status = geoStatus(geoFenceOk);
  const label = geoStatusLabel(geoFenceOk);

  // Honest colour framing: inside = green (good), outside = amber (an advisory flag, NOT a
  // proven fail), not-verified = gray/neutral (the backend never confirmed a fix).
  const styles =
    status === 'inside'
      ? 'bg-green-50 text-green-700 border-green-200'
      : status === 'outside'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-gray-100 text-gray-600 border-gray-200';

  const Icon = status === 'inside' ? MapPin : status === 'outside' ? MapPinOff : MapPinnedIcon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${styles} ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export default GeoBadge;
