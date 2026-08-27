'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  default:
    'bg-gray-900 text-white hover:bg-gray-700 focus-visible:outline-gray-900',
  primary:
    'bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-dark)] active:scale-95 focus-visible:outline-[var(--brand-primary)]',
  secondary:
    'bg-[var(--brand-accent)] text-gray-900 hover:brightness-95 active:scale-95 focus-visible:outline-[var(--brand-accent)]',
  destructive:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
  ghost:
    'bg-transparent text-gray-700 hover:bg-gray-100 focus-visible:outline-gray-400',
  outline:
    'bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline-gray-400',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md: 'px-4 py-2.5 text-sm rounded-xl gap-2',
  lg: 'px-6 py-3.5 text-base rounded-2xl gap-2',
};

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}

export default Button;
