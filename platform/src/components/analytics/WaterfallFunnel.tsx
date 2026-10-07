'use client';

/**
 * Six-stage execution funnel (Total sites → Recced → ASM approved → HO approved → Installed →
 * Audited) drawn as horizontal bars whose width is each stage's share of total sites, with the
 * step-to-step conversion % annotated. ASM approved (status APPROVED) is shown distinctly from
 * HO approved (installable: status APPROVED && hoReviewStatus APPROVED). Clicking a drillable
 * stage calls `onStageClick` so the page can open the evidence drill-down. Owns its own
 * loading / error state.
 */

import { AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import {
  buildFunnel,
  formatPct,
  stageColor,
  type SummaryWaterfall,
  type FunnelStage,
  type AnalyticsStage,
} from '@/lib/analytics/api';

// Bar colour per funnel stage, aligned to the map heatmap where a stage maps cleanly.
const STAGE_BAR: Record<FunnelStage['key'], string> = {
  totalSites: '#6b7280', // slate — the universe
  recced: stageColor('RECCED'),
  approved: stageColor('ASM_APPROVED'),
  hoApproved: stageColor('HO_APPROVED'),
  installed: stageColor('INSTALLED'),
  audited: stageColor('AUDITED'),
};

export function WaterfallFunnel({
  waterfall,
  loading,
  error,
  onRetry,
  onStageClick,
}: {
  waterfall: SummaryWaterfall | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onStageClick?: (drill: { stage: AnalyticsStage; status?: string }, label: string) => void;
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
        <p className="text-sm font-medium text-gray-800">Couldn&apos;t load the funnel</p>
        <p className="text-sm text-gray-500 mt-1 max-w-md">{error}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline">
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!waterfall) return null;

  const stages = buildFunnel(waterfall);
  const isEmpty = waterfall.totalSites === 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2 mb-4">
        <h2 className="text-sm font-bold text-gray-900">Execution funnel</h2>
        <span className="text-xs text-gray-400">width = share of total sites</span>
      </div>

      {isEmpty ? (
        <p className="text-sm text-gray-500 py-6 text-center">No sites yet — the funnel will populate as recces come in.</p>
      ) : (
        <ul className="space-y-3">
          {stages.map((s) => {
            const width = s.pctOfTotal == null ? 0 : Math.max(s.pctOfTotal, 2); // keep a sliver visible
            const clickable = !!(s.drill && onStageClick);
            const Row = (
              <div className="w-full">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-800">{s.label}</span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    {s.count.toLocaleString()}
                    {s.conversionFromPrev != null && (
                      <span className="ml-2 text-xs font-normal text-gray-400">{formatPct(s.conversionFromPrev)} of prev</span>
                    )}
                  </span>
                </div>
                <div className="h-6 w-full rounded-lg bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-lg transition-all"
                    style={{ width: `${width}%`, backgroundColor: STAGE_BAR[s.key] }}
                  />
                </div>
              </div>
            );
            return (
              <li key={s.key}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onStageClick!(s.drill!, s.label)}
                    className="w-full text-left rounded-xl px-1 py-1 -mx-1 hover:bg-gray-50 active:scale-[0.99] transition-all cursor-pointer"
                    aria-label={`View ${s.label} records`}
                  >
                    {Row}
                  </button>
                ) : (
                  <div className="px-1 py-1">{Row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default WaterfallFunnel;
