'use client';

/**
 * Sortable vendor scorecard table. Admin sees every vendor; a VENDOR_HO gets only their own
 * row (the backend scopes it). Clicking a row calls `onVendorClick` to open that vendor's
 * drill-down. Rates render honestly ("—" when not applicable). Owns loading / empty / error.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Inbox, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { formatPct, formatDays, type VendorScorecard } from '@/lib/analytics/api';
import { cn } from '@/lib/utils';

type SortKey =
  | 'vendorName'
  | 'sites'
  | 'recced'
  | 'approved'
  | 'hoApproved'
  | 'installed'
  | 'audited'
  | 'recceApprovalRatePct'
  | 'geoFencePassPct'
  | 'avgTurnaroundDays'
  | 'rejectedCount';

interface ColDef {
  key: SortKey;
  header: string;
  numeric: boolean;
  render: (r: VendorScorecard) => React.ReactNode;
}

const COLS: ColDef[] = [
  { key: 'vendorName', header: 'Vendor', numeric: false, render: (r) => (
    <span className="font-medium text-gray-900">
      {r.vendorName}
      <span className="ml-1.5 text-xs text-gray-400">{r.vendorCode}</span>
    </span>
  ) },
  { key: 'sites', header: 'Sites', numeric: true, render: (r) => r.sites.toLocaleString() },
  { key: 'recced', header: 'Recced', numeric: true, render: (r) => r.recced.toLocaleString() },
  { key: 'approved', header: 'ASM approved', numeric: true, render: (r) => r.approved.toLocaleString() },
  { key: 'hoApproved', header: 'HO approved', numeric: true, render: (r) => r.hoApproved.toLocaleString() },
  { key: 'installed', header: 'Installed', numeric: true, render: (r) => r.installed.toLocaleString() },
  { key: 'audited', header: 'Audited', numeric: true, render: (r) => r.audited.toLocaleString() },
  { key: 'recceApprovalRatePct', header: 'ASM approval %', numeric: true, render: (r) => formatPct(r.recceApprovalRatePct) },
  { key: 'geoFencePassPct', header: 'Geo-fence %', numeric: true, render: (r) => formatPct(r.geoFencePassPct) },
  { key: 'avgTurnaroundDays', header: 'Turnaround', numeric: true, render: (r) => formatDays(r.avgTurnaroundDays) },
  { key: 'rejectedCount', header: 'Rejected', numeric: true, render: (r) => (
    <span className={r.rejectedCount > 0 ? 'text-red-600 font-medium' : ''}>{r.rejectedCount.toLocaleString()}</span>
  ) },
];

/** null / undefined sort last regardless of direction. */
function compare(a: VendorScorecard, b: VendorScorecard, key: SortKey, dir: 1 | -1): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
  return ((av as number) - (bv as number)) * dir;
}

export function VendorScorecards({
  items,
  loading,
  error,
  onRetry,
  onVendorClick,
  title = 'Vendor scorecards',
}: {
  items: VendorScorecard[] | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onVendorClick?: (vendor: VendorScorecard) => void;
  title?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('sites');
  const [dir, setDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => compare(a, b, sortKey, dir));
  }, [items, sortKey, dir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setDir(key === 'vendorName' ? 1 : -1);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
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
          <p className="text-sm font-medium text-gray-800">Couldn&apos;t load the scorecards</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md">{error}</p>
          {onRetry && (
            <button onClick={onRetry} className="mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline">
              Try again
            </button>
          )}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <div className="p-4 bg-gray-100 rounded-full mb-3 text-gray-400">
            <Inbox className="h-6 w-6" />
          </div>
          <p className="text-base font-semibold text-gray-900">No vendors yet</p>
          <p className="text-sm text-gray-500 mt-1">Scorecards appear once vendors have sites assigned.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {COLS.map((c) => {
                  const active = c.key === sortKey;
                  const Arrow = active ? (dir === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown;
                  return (
                    <th
                      key={c.key}
                      className={cn(
                        'px-4 py-3 font-semibold text-gray-600 whitespace-nowrap select-none cursor-pointer hover:text-gray-900',
                        c.numeric ? 'text-right' : 'text-left',
                      )}
                      onClick={() => toggleSort(c.key)}
                      aria-sort={active ? (dir === 1 ? 'ascending' : 'descending') : 'none'}
                    >
                      <span className={cn('inline-flex items-center gap-1', c.numeric && 'flex-row-reverse')}>
                        {c.header}
                        <Arrow className={cn('h-3.5 w-3.5', active ? 'text-gray-700' : 'text-gray-300')} />
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.vendorId}
                  className={cn(
                    'border-b border-gray-100 last:border-0 transition-colors',
                    onVendorClick ? 'hover:bg-gray-50/70 cursor-pointer' : '',
                  )}
                  onClick={onVendorClick ? () => onVendorClick(r) : undefined}
                >
                  {COLS.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 text-gray-800 whitespace-nowrap tabular-nums', c.numeric ? 'text-right' : 'text-left')}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default VendorScorecards;
