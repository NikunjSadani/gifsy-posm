'use client';

import { Navigation, ArrowDownAZ } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldSortMode } from '@/lib/field/sites';

/**
 * A compact, touch-friendly segmented control for the field outlet lists: order by distance from
 * the device ("Nearest") or alphabetically ("A–Z"). Mobile-first — full-width, large tap targets.
 *
 * When the device has no location fix yet (`hasFix === false`) the "Nearest" option stays visible
 * and selectable (the parent keeps the list in its natural order until a fix arrives), and a subtle
 * hint nudges the rep to enable location. The control NEVER blocks or empties the list.
 */
export function SortToggle({
  mode,
  onChange,
  hasFix,
  locating = false,
  onRetryLocation,
  className,
}: {
  mode: FieldSortMode;
  onChange: (mode: FieldSortMode) => void;
  /** Whether a device location fix is currently available (drives the hint + the Nearest sub-label). */
  hasFix: boolean;
  /** True while the first fix is still being acquired — softens the hint from "enable" to "finding". */
  locating?: boolean;
  /** When given, the no-fix hint becomes a tappable button that re-requests the device location. */
  onRetryLocation?: () => void;
  className?: string;
}) {
  const options: { value: FieldSortMode; label: string; icon: typeof Navigation }[] = [
    { value: 'nearest', label: 'Nearest', icon: Navigation },
    { value: 'name', label: 'A–Z', icon: ArrowDownAZ },
  ];

  return (
    <div className={className}>
      {/* A 2-option selector is a radiogroup, not tabs (there is no tabpanel). */}
      <div
        role="radiogroup"
        aria-label="Sort outlets"
        className="inline-flex w-full items-center rounded-xl border border-gray-200 bg-gray-50 p-0.5"
      >
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            data-testid={`sort-${value}`}
            onClick={() => onChange(value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all active:scale-[0.98]',
              mode === value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Honest hint when distance sorting can't apply yet — never hides or blocks the list. When a
          retry handler is given and we're not already locating, it becomes a tappable action so the
          "enable location" nudge is something the rep can actually do (no page reload needed). */}
      {!hasFix && (
        <div className="mt-1.5" aria-live="polite">
          {locating ? (
            <p className="text-xs text-gray-400" data-testid="sort-geo-hint">Finding your location…</p>
          ) : onRetryLocation ? (
            <button
              type="button"
              onClick={onRetryLocation}
              data-testid="sort-geo-retry"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)] active:scale-95"
            >
              <Navigation className="h-3.5 w-3.5" />
              Use my location to sort by distance
            </button>
          ) : (
            <p className="text-xs text-gray-400" data-testid="sort-geo-hint">Enable location to sort by distance</p>
          )}
        </div>
      )}
    </div>
  );
}

export default SortToggle;
