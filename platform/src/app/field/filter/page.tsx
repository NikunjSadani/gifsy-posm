'use client';

/**
 * Outlet filter — the mandatory landing screen for the field (VENDOR_FIELD) app.
 *
 * A rep must pick an RS code and then a Beat before any outlets are shown. The choice is
 * stored PER-DEVICE (localStorage) — the same vendor login is shared across many reps on
 * different phones, so this must never be persisted server-side (see lib/field/outlet-filter).
 *
 * Beat has no id — beats are identified by name — so both dropdowns are plain string lists.
 * The Beat dropdown is disabled until an RS code is chosen, and the chosen beat is cleared
 * whenever the RS code changes (its beat list no longer applies).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, MapPin, AlertCircle, RefreshCw } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { fetchRsCodes, fetchBeats } from '@/lib/field/sites';
import { getOutletFilter, setOutletFilter } from '@/lib/field/outlet-filter';

const FIELD_CLASS =
  'w-full text-sm text-gray-900 bg-white rounded-xl border border-gray-200 pl-3 py-2.5 focus:outline-none focus:border-[var(--brand-primary)] transition-colors';

export default function OutletFilterPage() {
  const router = useRouter();

  const [rsCode, setRsCode] = useState('');
  const [beatName, setBeatName] = useState('');

  const [rsCodes, setRsCodes] = useState<string[]>([]);
  const [rsLoading, setRsLoading] = useState(true);
  const [rsError, setRsError] = useState<string | null>(null);

  const [beats, setBeats] = useState<string[]>([]);
  const [beatsLoading, setBeatsLoading] = useState(false);
  const [beatsError, setBeatsError] = useState<string | null>(null);

  // Load the vendor's RS codes, and pre-fill both dropdowns from the device's saved filter.
  const loadRsCodes = async () => {
    setRsLoading(true);
    setRsError(null);
    const res = await fetchRsCodes();
    if (res.success) {
      setRsCodes(res.data.rsCodes ?? []);
    } else {
      setRsError(res.error || 'Could not load your RS codes. Please try again.');
      setRsCodes([]);
    }
    setRsLoading(false);
  };

  useEffect(() => {
    void loadRsCodes();
    // Pre-fill from the saved per-device filter. If an RS code was saved, load its beats so
    // the saved beat renders as selected rather than being silently dropped.
    const saved = getOutletFilter();
    if (saved) {
      setRsCode(saved.rsCode);
      setBeatName(saved.beatName);
      void loadBeats(saved.rsCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guards against an out-of-order beats response: if the rep switches RS code while a beats
  // request is in flight, the stale response must not overwrite the newer RS code's beat list
  // (which would let them submit a mismatched RS+Beat pair).
  const beatsReq = useRef(0);

  const loadBeats = async (code: string) => {
    if (!code) {
      setBeats([]);
      return;
    }
    const seq = ++beatsReq.current;
    setBeatsLoading(true);
    setBeatsError(null);
    const res = await fetchBeats(code);
    if (seq !== beatsReq.current) return; // a newer RS selection superseded this request
    if (res.success) {
      setBeats(res.data.beats ?? []);
    } else {
      setBeatsError(res.error || 'Could not load beats for this RS code.');
      setBeats([]);
    }
    setBeatsLoading(false);
  };

  // RS change: clear the dependent beat (its list no longer applies) and reload beats.
  const onRsChange = (next: string) => {
    setRsCode(next);
    setBeatName('');
    setBeats([]);
    setBeatsError(null);
    if (next) void loadBeats(next);
  };

  const canSubmit = rsCode.trim() !== '' && beatName.trim() !== '';

  const submit = () => {
    if (!canSubmit) return;
    setOutletFilter({ rsCode, beatName });
    router.push('/field/sites');
  };

  return (
    <div className="px-4 pt-4">
      <div className="mb-1 flex items-center gap-2">
        <Filter className="h-5 w-5 text-[var(--brand-primary)]" />
        <h1 className="text-lg font-bold text-gray-900">Choose your outlets</h1>
      </div>
      <p className="mb-5 text-sm text-gray-500">
        Pick your RS code and beat to see the outlets assigned to you. You can change this
        anytime.
      </p>

      {rsLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : rsError ? (
        <div className="mt-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4">
          <div className="flex items-start gap-2 text-sm text-gray-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
            <span>{rsError}</span>
          </div>
          <button
            onClick={() => void loadRsCodes()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white active:scale-95 transition-transform"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      ) : rsCodes.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <MapPin className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No outlets assigned to you yet</p>
          <p className="text-xs text-gray-500 mt-1">
            Contact your admin to get outlets assigned to your account.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-700">RS code</label>
            <SearchableSelect
              value={rsCode}
              onChange={onRsChange}
              options={rsCodes}
              placeholder="Select RS code…"
              testIdPrefix="filter-rs"
              aria-label="RS code"
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-700">Beat</label>
            <SearchableSelect
              value={beatName}
              onChange={setBeatName}
              options={beats}
              placeholder={rsCode ? 'Select beat…' : 'Choose an RS code first'}
              disabled={!rsCode || beatsLoading}
              testIdPrefix="filter-beat"
              aria-label="Beat"
              className={FIELD_CLASS}
            />
            {beatsLoading && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400">
                <Spinner size="sm" />
                Loading beats…
              </p>
            )}
            {!beatsLoading && beatsError && (
              <p className="mt-1.5 text-xs text-[var(--brand-primary)]">{beatsError}</p>
            )}
            {!beatsLoading && !beatsError && rsCode && beats.length === 0 && (
              <p className="mt-1.5 text-xs text-gray-500">No beats found for this RS code.</p>
            )}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="filter-submit"
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-3 text-sm font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95 disabled:opacity-40 disabled:active:scale-100"
          >
            <MapPin className="h-4 w-4" />
            Show outlets
          </button>
        </div>
      )}
    </div>
  );
}
