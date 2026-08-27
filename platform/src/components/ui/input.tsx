'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type InputVariant = 'default' | 'error';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  variant?: InputVariant;
}

export function Input({
  label,
  error,
  helperText,
  variant,
  className,
  id,
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  const hasError = variant === 'error' || !!error;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-gray-700"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        className={cn(
          'w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
          'placeholder:text-gray-400',
          'focus:outline-none focus:ring-2 focus:ring-offset-0',
          'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
          'transition-colors',
          hasError
            ? 'border-red-400 focus:border-red-400 focus:ring-red-200'
            : 'border-gray-300 focus:border-[var(--brand-primary)] focus:ring-[var(--brand-primary)]/20',
          className,
        )}
      />
      {hasError && error && (
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
      {!hasError && helperText && (
        <p className="text-xs text-gray-500">{helperText}</p>
      )}
    </div>
  );
}

export default Input;
