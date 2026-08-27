import React from 'react';
import { cn } from '@/lib/utils';

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
}

export function Table({ className, children, ...props }: TableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn('w-full text-sm text-left', className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('bg-gray-50 border-b border-gray-200', className)}
      {...props}
    >
      {children}
    </thead>
  );
}

export function TableBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn('divide-y divide-gray-100', className)}
      {...props}
    >
      {children}
    </tbody>
  );
}

interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  striped?: boolean;
  index?: number;
}

export function TableRow({ className, striped, index, children, ...props }: TableRowProps) {
  return (
    <tr
      className={cn(
        'transition-colors hover:bg-gray-50',
        striped && index !== undefined && index % 2 !== 0 ? 'bg-gray-50/50' : 'bg-white',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableHead({
  className,
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({
  className,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-4 py-3 text-gray-800', className)}
      {...props}
    >
      {children}
    </td>
  );
}

export default Table;
