'use client';

import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export interface TabItem {
  value: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  items: TabItem[];
  className?: string;
}

export function Tabs({ defaultValue, value, onValueChange, items, className }: TabsProps) {
  return (
    <TabsPrimitive.Root
      defaultValue={defaultValue ?? items[0]?.value}
      value={value}
      onValueChange={onValueChange}
      className={className}
    >
      <TabsPrimitive.List className="flex border-b border-gray-200 gap-0 overflow-x-auto">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'px-4 py-2.5 text-sm font-medium text-gray-500 whitespace-nowrap',
              'border-b-2 border-transparent -mb-px',
              'hover:text-gray-700 transition-colors',
              'data-[state=active]:text-[var(--brand-primary)] data-[state=active]:border-[var(--brand-primary)]',
              'focus:outline-none',
            )}
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content key={item.value} value={item.value} className="pt-4">
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

export { TabsPrimitive };
export default Tabs;
