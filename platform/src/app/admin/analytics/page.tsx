'use client';

/**
 * Admin analytics dashboard — the full tenant view: KPI cards, the execution funnel (click a
 * stage → drill-down), a geo heatmap of every site, and vendor scorecards (click a vendor →
 * drill-down). Plus an Excel export. Every widget loads/errors independently — a slow or failed
 * one never blanks the rest. The backend scopes the data to the admin's tenant automatically.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { KpiCards } from '@/components/analytics/KpiCards';
import { WaterfallFunnel } from '@/components/analytics/WaterfallFunnel';
import { GeoMap } from '@/components/analytics/GeoMap';
import { VendorScorecards } from '@/components/analytics/VendorScorecards';
import { ExportButton } from '@/components/analytics/ExportButton';
import { DrillDownPanel, type DrillTarget } from '@/components/analytics/DrillDownPanel';
import {
  fetchSummary,
  fetchVendorScorecards,
  fetchGeo,
  type AnalyticsSummary,
  type VendorScorecard,
  type GeoResult,
  type AnalyticsStage,
} from '@/lib/analytics/api';

interface Widget<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

const initial = <T,>(): Widget<T> => ({ loading: true, error: null, data: null });

export default function AdminAnalyticsPage() {
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

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Field execution performance across your vendors and sites.</p>
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

      <KpiCards kpis={summary.data?.kpis ?? null} byRecceMode={summary.data?.byRecceMode ?? null} loading={summary.loading} error={summary.error} onRetry={loadSummary} />

      <div className="grid lg:grid-cols-2 gap-4">
        <WaterfallFunnel
          waterfall={summary.data?.waterfall ?? null}
          loading={summary.loading}
          error={summary.error}
          onRetry={loadSummary}
          onStageClick={(d, label) => setDrill({ ...d, title: label })}
        />
        <GeoMap
          points={geo.data?.points ?? null}
          truncated={geo.data?.truncated}
          stage={stage}
          onStageChange={setStage}
          loading={geo.loading}
          error={geo.error}
          onRetry={() => loadGeo(stage)}
        />
      </div>

      <VendorScorecards
        items={scorecards.data}
        loading={scorecards.loading}
        error={scorecards.error}
        onRetry={loadScorecards}
        onVendorClick={(v) =>
          setDrill({ stage, vendorId: v.vendorId, title: `${v.vendorName} — records` })
        }
      />

      <DrillDownPanel target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
