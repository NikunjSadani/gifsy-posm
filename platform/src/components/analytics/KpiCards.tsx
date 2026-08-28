'use client';

/**
 * KPI grid for the analytics dashboards (admin + vendor share this). Each tile shows one
 * headline number with honest formatting — a not-applicable rate reads "—", never "0%".
 * Owns its own loading / error state so a failed summary call never blanks the page.
 */

import {
  CheckCircle2,
  ShieldCheck,
  MapPin,
  Clock,
  Hourglass,
  ClipboardCheck,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { formatPct, formatDays, type SummaryKpis } from '@/lib/analytics/api';

interface Tile {
  label: string;
  value: string;
  icon: typeof CheckCircle2;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  hint?: string;
}

const TONE: Record<Tile['tone'], string> = {
  good: 'text-emerald-600 bg-emerald-50',
  warn: 'text-amber-600 bg-amber-50',
  bad: 'text-red-600 bg-red-50',
  neutral: 'text-gray-600 bg-gray-100',
};

function tilesFor(k: SummaryKpis): Tile[] {
  return [
    { label: 'Recce approval rate', value: formatPct(k.recceApprovalRatePct), icon: CheckCircle2, tone: 'good' },
    { label: 'Install audit pass rate', value: formatPct(k.installAuditApprovalRatePct), icon: ShieldCheck, tone: 'good' },
    { label: 'Geo-fence pass rate', value: formatPct(k.geoFencePassRatePct), icon: MapPin, tone: 'good' },
    { label: 'Avg turnaround', value: formatDays(k.avgTurnaroundDays), icon: Clock, tone: 'neutral' },
    { label: 'Pending recce review', value: String(k.pendingRecceReview), icon: Hourglass, tone: k.pendingRecceReview > 0 ? 'warn' : 'neutral' },
    { label: 'Pending install audit', value: String(k.pendingInstallAudit), icon: ClipboardCheck, tone: k.pendingInstallAudit > 0 ? 'warn' : 'neutral' },
    { label: 'Rejected recces', value: String(k.rejectedRecce), icon: XCircle, tone: k.rejectedRecce > 0 ? 'bad' : 'neutral' },
    { label: 'Rejected installs', value: String(k.rejectedInstall), icon: XCircle, tone: k.rejectedInstall > 0 ? 'bad' : 'neutral' },
  ];
}

export function KpiCards({
  kpis,
  loading,
  error,
  onRetry,
}: {
  kpis: SummaryKpis | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-gray-800">Couldn&apos;t load the KPIs</p>
        <p className="text-sm text-gray-500 mt-1 max-w-md">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!kpis) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tilesFor(kpis).map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <span className={`p-2 rounded-xl ${TONE[t.tone]}`}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-black text-gray-900 tabular-nums">{t.value}</p>
            <p className="text-xs font-medium text-gray-500 mt-0.5">{t.label}</p>
          </div>
        );
      })}
    </div>
  );
}

export default KpiCards;
