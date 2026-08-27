import React from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatsCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  className?: string;
  accentColor?: string;
}

export function StatsCard({
  icon,
  title,
  value,
  change,
  changeLabel = 'vs last period',
  className,
  accentColor = 'var(--brand-primary)',
}: StatsCardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const isNeutral = change === undefined || change === 0;

  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-gray-200 shadow-sm p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div
          className="p-2.5 rounded-lg"
          style={{ backgroundColor: `${accentColor}15` }}
        >
          <div style={{ color: accentColor }}>{icon}</div>
        </div>
        {change !== undefined && (
          <div
            className={cn(
              'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full',
              isPositive && 'bg-emerald-50 text-emerald-700',
              isNegative && 'bg-red-50 text-red-700',
              isNeutral && 'bg-gray-100 text-gray-600',
            )}
          >
            {isPositive && <TrendingUp className="h-3 w-3" />}
            {isNegative && <TrendingDown className="h-3 w-3" />}
            {isNeutral && <Minus className="h-3 w-3" />}
            {change !== undefined
              ? `${isPositive ? '+' : ''}${change.toFixed(1)}%`
              : '—'}
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        {change !== undefined && (
          <p className="text-xs text-gray-400 mt-1">{changeLabel}</p>
        )}
      </div>
    </div>
  );
}

export default StatsCard;
