'use client';

import { MapPin, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/field/status-chip';
import { formatDistance, type Site } from '@/lib/field/sites';

/**
 * A tappable site card — code, name, town, a status chip, and (on the Nearby tab) a distance.
 * `active:scale-[0.98]` gives the Kwality press feedback.
 */
export function SiteCard({
  site,
  distanceMeters,
  onClick,
}: {
  site: Site;
  distanceMeters?: number | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4',
        'flex items-center gap-3 active:scale-[0.98] transition-transform',
        'hover:border-gray-200',
      )}
    >
      <div className="shrink-0 h-10 w-10 rounded-xl bg-[var(--brand-primary-light)] flex items-center justify-center">
        <MapPin className="h-5 w-5 text-[var(--brand-primary)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-semibold text-gray-500 shrink-0">{site.code}</span>
          <StatusChip status={site.status} />
        </div>
        <p className="text-sm font-semibold text-gray-900 truncate mt-0.5">{site.name}</p>
        <p className="text-xs text-gray-500 truncate">
          {site.town || 'No town'}
          {typeof distanceMeters === 'number' && (
            <span className="text-[var(--brand-primary)] font-medium"> · {formatDistance(distanceMeters)}</span>
          )}
        </p>
      </div>
      <ChevronRight className="h-5 w-5 text-gray-300 shrink-0" />
    </button>
  );
}

export default SiteCard;
