'use client';

/**
 * "Element wise execution funnel" — the SAME execution funnel broken down per element type
 * (PosmType), at element grain (element LINES, not recces). One row per element type with the
 * stage counts (Recce → ASM approved → HO approved → Pending install → Installed), fed from
 * `summary.elementFunnels`. Shown ONLY on the ASM console and the Vendor-HO dashboard.
 *
 * Mobile-safe: the table scrolls horizontally inside its own container (the element name column
 * stays pinned), so the page never gains a horizontal scrollbar at phone width. Owns its own
 * loading / error / empty states, mirroring the sibling analytics widgets.
 */

import { AlertTriangle, Boxes } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { stageColor, type ElementFunnelRow } from '@/lib/analytics/api';
import { cn } from '@/lib/utils';

/** Stage columns in funnel order, each tinted to match the waterfall funnel's stage colours. */
const STAGE_COLUMNS = [
  { key: 'recced', label: 'Recce', color: stageColor('RECCED') },
  { key: 'asmApproved', label: 'ASM approved', color: stageColor('ASM_APPROVED') },
  { key: 'hoApproved', label: 'HO approved', color: stageColor('HO_APPROVED') },
  // "Pending install" has no furthest-stage colour; use the same orange the review funnel tile uses.
  { key: 'pendingInstall', label: 'Pending install', color: '#f97316' },
  { key: 'installed', label: 'Installed', color: stageColor('INSTALLED') },
] as const satisfies readonly { key: keyof ElementFunnelRow; label: string; color: string }[];

export function ElementFunnel({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: ElementFunnelRow[] | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-gray-400">
          <Boxes className="h-4 w-4" aria-hidden />
        </span>
        <h2 className="text-sm font-bold text-gray-900">Element wise execution funnel</h2>
        {/* Grain disclosure: these are ELEMENT-LINE counts, not recce/outlet counts — so they won't
            (and shouldn't) tie out to the funnel above, where a recce with N elements counts once. */}
        <span className="text-xs text-gray-400 w-full sm:w-auto sm:ml-auto">
          counts are element lines — a recce with N elements counts N
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-gray-800">Couldn&apos;t load the element funnel</p>
          {error && <p className="text-sm text-gray-500 mt-1 max-w-md">{error}</p>}
          {onRetry && (
            <button onClick={onRetry} className="mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline">
              Try again
            </button>
          )}
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center" data-testid="element-funnel-empty">
          <div className="p-4 bg-gray-100 rounded-full mb-3 text-gray-400">
            <Boxes className="h-6 w-6" />
          </div>
          <p className="text-base font-semibold text-gray-900">No elements yet</p>
          <p className="text-sm text-gray-500 mt-1">
            The per-element funnel will populate as recces with elements come in.
          </p>
        </div>
      ) : (
        // Horizontal scroll is confined to THIS container → no page-level horizontal scroll on mobile.
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">
                  Element
                </th>
                {STAGE_COLUMNS.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-right font-semibold text-gray-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: c.color }}
                        aria-hidden
                      />
                      {c.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.code || r.name}
                  data-testid={`element-funnel-row-${r.code}`}
                  className="border-b border-gray-100 last:border-0"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-medium text-gray-900 whitespace-nowrap"
                  >
                    {r.name}
                    {r.code && <span className="ml-1.5 text-xs font-normal text-gray-400">{r.code}</span>}
                  </th>
                  {STAGE_COLUMNS.map((c) => {
                    const value = r[c.key] as number;
                    return (
                      <td
                        key={c.key}
                        data-testid={`ef-${r.code}-${c.key}`}
                        className={cn(
                          'px-4 py-3 text-right tabular-nums',
                          value > 0 ? 'text-gray-800' : 'text-gray-300',
                        )}
                      >
                        {value.toLocaleString()}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ElementFunnel;
