'use client';

import Link from 'next/link';
import { AlertTriangle, ChevronRight, ImageOff } from 'lucide-react';
import type { RecceQueueItem } from '@/lib/review/api';
import { mediaSrc, recceFlags, photoCount } from '@/lib/review/api';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * One row in the ASM approval queue. A leading checkbox drives bulk-approve selection; the rest
 * of the row links through to the recce detail. Shows site, town, vendor, when it was received,
 * POSM/photo count, small photo thumbnails and any integrity flags so the ASM can triage fast.
 */
export function RecceRow({
  item,
  selected,
  onToggle,
}: {
  item: RecceQueueItem;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const flags = recceFlags(item);
  const photos = item.posms.filter((p) => p.photo != null).slice(0, 3);
  const received = item.receivedAt ?? item.capturedAt;

  return (
    <div
      className={cn(
        'flex items-stretch gap-3 rounded-2xl border bg-white p-3 sm:p-4 transition-colors',
        selected ? 'border-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]' : 'border-gray-100',
      )}
    >
      <label className="flex items-center pl-1 cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(item.id)}
          aria-label={`Select ${item.site.code} for bulk approval`}
          className="w-4 h-4 accent-[var(--brand-primary)] cursor-pointer"
        />
      </label>

      {/* Thumbnails */}
      <div className="flex -space-x-2 shrink-0 items-center">
        {photos.length === 0 ? (
          <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
            <ImageOff className="h-5 w-5" />
          </div>
        ) : (
          photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.id}
              src={mediaSrc(p.photo!.key)}
              alt=""
              className="h-12 w-12 rounded-lg object-cover border-2 border-white bg-gray-100"
              loading="lazy"
            />
          ))
        )}
      </div>

      <Link href={`/review/recces/${item.id}`} className="flex-1 min-w-0 flex items-center gap-2 group">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">{item.site.name}</p>
            <span className="text-xs font-medium text-gray-400">{item.site.code}</span>
            {item.version > 1 && (
              <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-1.5 py-px">
                v{item.version}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {item.site.town ?? 'Unknown town'}
            {item.submittedBy && <> · {item.submittedBy.name}</>}
            {received && <> · {formatRelativeTime(received)}</>}
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs text-gray-600">
              {photoCount(item)} / {item.posms.length} Element photo{item.posms.length === 1 ? '' : 's'}
            </span>
            {flags.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                <AlertTriangle className="h-3 w-3" />
                {flags.length} flag{flags.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-gray-400 shrink-0" />
      </Link>
    </div>
  );
}

export default RecceRow;
