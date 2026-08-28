'use client';

import React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export interface Column<T> {
  /** Stable key (also used for the React key of the header cell). */
  key: string;
  header: string;
  /** Cell renderer. */
  render: (row: T) => React.ReactNode;
  /** Optional extra classes on the cell + header (e.g. right-align actions). */
  className?: string;
  /** Header-only extra classes. */
  headerClassName?: string;
}

/**
 * A desktop-first masters table with first-class loading / empty / error states so every
 * list page renders them consistently and honestly. Horizontally scrolls inside its own
 * container on narrow viewports (the page never scrolls sideways).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-gray-800">Couldn&apos;t load this list</p>
        <p className="text-sm text-gray-500 mt-1 max-w-md">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="p-4 bg-gray-100 rounded-full mb-3 text-gray-400">
          <Inbox className="h-6 w-6" />
        </div>
        <p className="text-base font-semibold text-gray-900">{emptyTitle}</p>
        {emptyDescription && (
          <p className="text-sm text-gray-500 mt-1 max-w-md">{emptyDescription}</p>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap',
                  c.headerClassName,
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                'border-b border-gray-100 last:border-0 hover:bg-gray-50/70 transition-colors',
                rowClassName?.(row),
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-3 text-gray-800 align-middle', c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
