'use client';

/**
 * Cell renderers for the admin Recce Report table. The server hands a typed `Cell` per column
 * (see `@/lib/reports/outlet-execution`); this renders each by its `t` discriminant into a
 * curated, scannable cell rather than raw text:
 *   - text   → plain text (blank → muted dash)
 *   - status → a colored status chip (approved=green, pending=amber, rejected=red, neutral=gray)
 *   - photo  → a small inline thumbnail (click to open full) + a GPS-pin link when geotagged
 *   - empty  → a muted dash
 *
 * The photo cell is stateless about the enlarged view: it calls `onOpenPhoto(src, alt)` and the
 * table owns the lightbox (reusing the audit Lightbox), so one lightbox serves the whole grid.
 */

import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reportMediaSrc, gpsMapsUrl, type Cell, type CellTone } from '@/lib/reports/outlet-execution';

/** Chip styling per tone. A tone outside the known set falls back to neutral. */
const TONE_STYLES: Record<CellTone, { chip: string; dot: string }> = {
  approved: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  pending: { chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  rejected: { chip: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  neutral: { chip: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
};

export function StatusChip({ label, tone }: { label: string; tone: CellTone }) {
  const s = TONE_STYLES[tone] ?? TONE_STYLES.neutral;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        s.chip,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', s.dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyDash() {
  return <span className="text-gray-300">—</span>;
}

export function ReportCell({
  cell,
  label,
  onOpenPhoto,
}: {
  cell: Cell;
  /** The column label — used as the photo's alt text / aria-label. */
  label: string;
  onOpenPhoto: (src: string, alt: string) => void;
}) {
  switch (cell.t) {
    case 'text':
      return cell.v ? <span className="text-gray-700">{cell.v}</span> : <EmptyDash />;

    case 'status':
      return <StatusChip label={cell.v} tone={cell.tone} />;

    case 'photo': {
      const src = reportMediaSrc(cell.viewPath);
      const hasGeo = typeof cell.lat === 'number' && typeof cell.lng === 'number';
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenPhoto(src, label)}
            aria-label={`Open ${label} photo`}
            className="block shrink-0 overflow-hidden rounded-md ring-1 ring-gray-200 transition-all hover:ring-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] active:scale-95"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated dynamic media stream, not an optimizable static asset */}
            <img src={src} alt={label} loading="lazy" className="block h-11 w-11 object-cover bg-gray-100" />
          </button>
          {hasGeo && (
            <a
              href={gpsMapsUrl(cell.lat as number, cell.lng as number)}
              target="_blank"
              rel="noopener noreferrer"
              title={`GPS: ${(cell.lat as number).toFixed(5)}, ${(cell.lng as number).toFixed(5)}`}
              aria-label={`Open ${label} location in Google Maps`}
              className="text-gray-400 transition-colors hover:text-[var(--brand-primary)]"
            >
              <MapPin className="h-4 w-4" />
            </a>
          )}
        </div>
      );
    }

    case 'empty':
    default:
      return <EmptyDash />;
  }
}

export default ReportCell;
