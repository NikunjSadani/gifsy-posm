'use client';

/**
 * VENDOR-HO fleet dashboard — the read-only mirror of the admin analytics page, scoped by the
 * backend to THIS vendor's fleet (same endpoints, fleet-scoped data returned automatically).
 * Reuses the exact same shared widgets: KPI cards, execution funnel (→ drill-down), a map of
 * their sites, their single scorecard row (→ drill-down). No admin-only actions; Export still
 * downloads the vendor's own fleet data (backend-scoped). Every widget loads/errors on its own.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { KpiCards } from '@/components/analytics/KpiCards';
import { WaterfallFunnel } from '@/components/analytics/WaterfallFunnel';
import { GeoMap } from '@/components/analytics/GeoMap';
import { VendorScorecards } from '@/components/analytics/VendorScorecards';
import { ExportButton } from '@/components/analytics/ExportButton';
import { MetricDrilldownSheet } from '@/components/ui/metric-drilldown-sheet';
import {
  fetchSummary,
  fetchVendorScorecards,
  fetchGeo,
  fetchAnalyticsDrilldown,
  type AnalyticsSummary,
  type VendorScorecard,
  type GeoResult,
  type AnalyticsStage,
  type AnalyticsMetric,
} from '@/lib/analytics/api';

interface Widget<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

const initial = <T,>(): Widget<T> => ({ loading: true, error: null, data: null });

/** The active drill-down target for the shared sheet, or null when closed. */
interface DrillTarget {
  metric: AnalyticsMetric;
  title: string;
  vendorId?: string;
}

export default function VendorDashboardPage() {
  const [summary, setSummary] = useState<Widget<AnalyticsSummary>>(initial);
  const [scorecards, setScorecards] = useState<Widget<VendorScorecard[]>>(initial);
  const [geo, setGeo] = useState<Widget<GeoResult>>(initial);
  const [stage, setStage] = useState<AnalyticsStage>('recce');
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    const res = await fetchSummary();
    setSummary(res.success ? { loading: false, error: null, data: res.data } : { loading: false, error: res.error, data: null });
  }, []);

  const loadScorecards = useCallback(async () => {
    setScorecards((s) => ({ ...s, loading: true, error: null }));
    const res = await fetchVendorScorecards();
    setScorecards(res.success ? { loading: false, error: null, data: res.data.items } : { loading: false, error: res.error, data: null });
  }, []);

  const loadGeo = useCallback(async (st: AnalyticsStage) => {
    setGeo((s) => ({ ...s, loading: true, error: null }));
    const res = await fetchGeo(st);
    setGeo(res.success ? { loading: false, error: null, data: res.data } : { loading: false, error: res.error, data: null });
  }, []);

  useEffect(() => {
    void loadSummary();
    void loadScorecards();
  }, [loadSummary, loadScorecards]);

  useEffect(() => {
    void loadGeo(stage);
  }, [stage, loadGeo]);

  const refreshAll = () => {
    void loadSummary();
    void loadScorecards();
    void loadGeo(stage);
  };

  // One fetcher for the single shared sheet; rebuilt when the target metric/vendor changes.
  const drillFetcher = useMemo(
    () => () => fetchAnalyticsDrilldown(drill?.metric ?? 'total-outlets', { vendorId: drill?.vendorId, limit: 200 }),
    [drill?.metric, drill?.vendorId],
  );

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Fleet analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your team&apos;s field execution — recce, approval, install and audit.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium px-3 py-2.5 hover:bg-gray-50 active:scale-95 transition-all"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <ExportButton />
        </div>
      </div>

      <KpiCards
        kpis={summary.data?.kpis ?? null}
        loading={summary.loading}
        error={summary.error}
        onRetry={loadSummary}
        onMetricClick={(metric, label) => setDrill({ metric, title: label })}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <WaterfallFunnel
          waterfall={summary.data?.waterfall ?? null}
          loading={summary.loading}
          error={summary.error}
          onRetry={loadSummary}
          onStageClick={(metric, label) => setDrill({ metric, title: label })}
        />
        <GeoMap
          points={geo.data?.points ?? null}
          truncated={geo.data?.truncated}
          stage={stage}
          onStageChange={setStage}
          loading={geo.loading}
          error={geo.error}
          onRetry={() => loadGeo(stage)}
          title="Your outlets"
        />
      </div>

      <VendorScorecards
        items={scorecards.data}
        loading={scorecards.loading}
        error={scorecards.error}
        onRetry={loadScorecards}
        title="Your scorecard"
        onVendorClick={(v) => setDrill({ metric: 'recce', vendorId: v.vendorId, title: `${v.vendorName} — records` })}
      />

      {/* Unified drill-down sheet for every drillable tile (fleet-scoped server-side). */}
      <MetricDrilldownSheet
        open={drill !== null}
        title={drill?.title ?? ''}
        onClose={() => setDrill(null)}
        fetcher={drillFetcher}
      />
    </div>
  );
}
