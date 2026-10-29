'use client';

import { MapPin, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/field/status-chip';
import { formatDistance, type Site } from '@/lib/field/sites';

/**
 * A tappable site card — code, name, town, a status chip, and (when sorting by distance) a distance
 * chip. `active:scale-[0.98]` gives the Kwality press feedback.
 *
 * Distance display: when `distanceMeters` is a number, a "1.2 km" chip renders. When `noLocation`
 * is set (a device fix exists but this outlet has no geotag, so it can't be ranked), a muted "No
 * location" tag renders instead — the rep sees why it sorted to the bottom.
 */
export function SiteCard({
  site,
  distanceMeters,
  noLocation = false,
  onClick,
}: {
  site: Site;
  distanceMeters?: number | null;
  noLocation?: boolean;
  onClick: () => void;
}) {
  // A rejected recce (needs re-capture) gets a red border + "Sent back" chip so it stands out from
  // the never-recced outlets it sits beside in "Recce to do".
  const rejected = site.hasRejectedRecce === true;
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left bg-white rounded-2xl border shadow-sm p-4',
        'flex items-center gap-3 active:scale-[0.98] transition-transform',
        rejected ? 'border-red-300 bg-red-50/40 hover:border-red-400' : 'border-gray-100 hover:border-gray-200',
      )}
    >
      <div className={cn(
        'shrink-0 h-10 w-10 rounded-xl flex items-center justify-center',
        rejected ? 'bg-red-100' : 'bg-[var(--brand-primary-light)]',
      )}>
        <MapPin className={cn('h-5 w-5', rejected ? 'text-red-500' : 'text-[var(--brand-primary)]')} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-semibold text-gray-500 shrink-0">{site.code}</span>
          <StatusChip status={site.status} />
          {rejected && (
            <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
              Sent back
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-gray-900 truncate mt-0.5">{site.name}</p>
        <p className="text-xs text-gray-500 truncate">{site.town || 'No town'}</p>
        {/* Distance on its OWN line (not sharing the truncated town line) so it is never clipped. */}
        {typeof distanceMeters === 'number' ? (
          <p className="text-xs font-medium text-[var(--brand-primary)]">{formatDistance(distanceMeters)}</p>
        ) : (
          noLocation && <p className="text-xs text-gray-400">No location</p>
        )}
      </div>
      <ChevronRight className="h-5 w-5 text-gray-300 shrink-0" />
    </button>
  );
}

export default SiteCard;
