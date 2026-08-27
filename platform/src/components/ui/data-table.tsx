'use client';

import React, { useState, useMemo } from 'react';
import { Search, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Spinner } from './spinner';
import { EmptyState } from './empty-state';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  exportable?: boolean;
  onExport?: () => void;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  rowKey?: (row: T) => string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  searchable = true,
  searchPlaceholder = 'Search...',
  exportable = false,
  onExport,
  pageSize = 10,
  emptyTitle = 'No data found',
  emptyDescription = 'There are no records to display.',
  className,
  rowKey,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((row) =>
      Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const getCellValue = (row: T, col: Column<T>): unknown => {
    const key = col.key as string;
    if (key.includes('.')) {
      return key.split('.').reduce((obj: unknown, k) => {
        if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[k];
        return undefined;
      }, row);
    }
    return row[key];
  };

  return (
    <div className={cn('bg-white rounded-xl border border-gray-200', className)}>
      {(searchable || exportable) && (
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-gray-100">
          {searchable && (
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={handleSearchChange}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 focus:border-[var(--brand-primary)]"
              />
            </div>
          )}
          {exportable && (
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="h-4 w-4" />
              Export
            </Button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" />
          </div>
        ) : paginated.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            className="py-12"
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {columns.map((col) => (
                  <th
                    key={String(col.key)}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider',
                      col.headerClassName,
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map((row, idx) => (
                <tr
                  key={rowKey ? rowKey(row) : idx}
                  className={cn(
                    'hover:bg-gray-50 transition-colors',
                    idx % 2 !== 0 ? 'bg-gray-50/40' : 'bg-white',
                  )}
                >
                  {columns.map((col) => {
                    const value = getCellValue(row, col);
                    return (
                      <td
                        key={String(col.key)}
                        className={cn('px-4 py-3 text-gray-800', col.className)}
                      >
                        {col.render ? col.render(value, row) : String(value ?? '—')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–
            {Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-700 font-medium">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
