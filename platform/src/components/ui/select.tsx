'use client';

import React, { useId } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  label?: string;
  error?: string;
  placeholder?: string;
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Accessible name when there is no visible `label` (e.g. compact filter selects). */
  'aria-label'?: string;
}

export function Select({
  label,
  error,
  placeholder = 'Select...',
  options,
  value,
  onValueChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: SelectProps) {
  // A stable id ties the visible <label> to the Radix trigger (which is not a native
  // <select>, so `htmlFor` alone won't focus it — we also set aria-labelledby on the trigger).
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const labelId = `${generatedId}-label`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label id={labelId} htmlFor={triggerId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <SelectPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          id={triggerId}
          aria-labelledby={label ? labelId : undefined}
          aria-label={!label ? ariaLabel : undefined}
          className={cn(
            'flex items-center justify-between w-full rounded-lg border px-3 py-2.5 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
            'transition-colors',
            error
              ? 'border-red-400 focus:border-red-400 focus:ring-red-200'
              : 'border-gray-300 focus:border-[var(--brand-primary)] focus:ring-[var(--brand-primary)]/20',
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} className="text-gray-500" />
          <SelectPrimitive.Icon>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="z-50 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
            position="popper"
            sideOffset={4}
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-md text-sm',
                    'cursor-pointer select-none outline-none',
                    'text-gray-700 hover:bg-gray-50 focus:bg-gray-50',
                    'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
                    'data-[highlighted]:bg-[var(--brand-primary)]/5 data-[highlighted]:text-[var(--brand-primary)]',
                  )}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check className="h-4 w-4" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

export default Select;
