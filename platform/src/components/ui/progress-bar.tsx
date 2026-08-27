import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercentage?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

function getColor(pct: number): string {
  if (pct < 50) return 'bg-[var(--brand-primary)]';
  if (pct <= 80) return 'bg-amber-500';
  return 'bg-emerald-500';
}

const heightMap = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' };

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercentage = true,
  className,
  size = 'md',
}: ProgressBarProps) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const colorClass = getColor(pct);

  return (
    <div className={cn('w-full', className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && <span className="text-sm text-gray-600">{label}</span>}
          {showPercentage && (
            <span className="text-sm font-medium text-gray-900">{pct}%</span>
          )}
        </div>
      )}
      <div
        className={cn(
          'w-full bg-gray-100 rounded-full overflow-hidden',
          heightMap[size],
        )}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
