'use client';

/**
 * Installation — the vendor field user's own post-submit recce/install jobs, grouped by status
 * with the right action per recce:
 *
 *   APPROVED  → "Start installation" → /field/install/[recceId] (the ONLY nav path to install).
 *   SUBMITTED → read-only "Awaiting ASM/HO approval".
 *
 * A rejected recce splits by how it was captured:
 *   - APP-rejected    → re-captured from "Recce to do" (/field/sites), whose list includes rejected
 *                       outlets; tapping one lands on the recce page in resubmit mode. These do NOT
 *                       appear here.
 *   - MANUAL-rejected → has NO outlet-list home (a manual outlet carries no RS/Beat and never shows
 *                       in Recce to do), so it WOULD be stranded. This screen gives it the only
 *                       re-capture surface: a 'Needs re-capture' entry → /field/recce/:siteId?recceId=.
 *
 * Data is `GET /api/recce` (vendor + submitter scoped server-side). Note: that list carries no
 * installation linkage, so an APPROVED recce always offers "Start installation"; a recce that
 * was already installed is caught honestly by the install screen (backend 409).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  MapPin,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle2,
  ShieldCheck,
  Hammer,
  RefreshCw,
  SlidersHorizontal,
  Search,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import {
  fetchMyRecces,
  groupRecces,
  groupInstallableByOutlet,
  rejectionLabel,
  type RecceListRow,
  type RecceGroup,
  type RecceGroupKey,
  type InstallableOutlet,
} from '@/lib/field/recce-api';
import { getOutletFilter, beatSummary, type OutletFilter } from '@/lib/field/outlet-filter';

// This screen handles the post-submit install pipeline PLUS the one re-capture case that has no other
// home: a MANUAL-rejected recce (APP-rejected is re-captured from "Recce to do", never here). So the
// group set is the full RecceGroupKey — but NEEDS_RECAPTURE is populated only by MANUAL rejects (see
// the APP-rejected filter before grouping).
type WorkGroupKey = RecceGroupKey;

const STATUS_META: Record<
  WorkGroupKey,
  { label: string; icon: typeof Clock; tint: string; dot: string }
> = {
  NEEDS_RECAPTURE: { label: 'Needs re-capture', icon: RefreshCw, tint: 'text-red-600', dot: '#dc2626' },
  READY_TO_INSTALL: { label: 'Ready to install', icon: CheckCircle2, tint: 'text-emerald-600', dot: '#16a34a' },
  AWAITING_HO: { label: 'Awaiting HO approval', icon: ShieldCheck, tint: 'text-sky-600', dot: '#0284c7' },
  AWAITING_ASM: { label: 'Awaiting ASM approval', icon: Clock, tint: 'text-amber-600', dot: '#d97706' },
};

export default function MyWorkPage() {
  const router = useRouter();

  // `undefined` = not yet read; `null` = read, none set (redirecting away); object = active.
  const [outlet, setOutlet] = useState<OutletFilter | null | undefined>(undefined);
  const [recces, setRecces] = useState<RecceListRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Gate: a device with no outlet filter is sent to the filter screen before any work loads.
  useEffect(() => {
    const f = getOutletFilter();
    if (!f) {
      setOutlet(null);
      router.replace('/field/sites');
      return;
    }
    setOutlet(f);
  }, [router]);

  const load = useCallback(async (f: OutletFilter) => {
    setLoading(true);
    setError(null);
    // Two fetches: the APP recces for the chosen RS/Beat (the beat chip governs these), PLUS the
    // exec's own MANUAL recces regardless of beat — a manual outlet has a null RS/Beat, so without
    // this a manual submission (including a rejected one that must be re-captured from this screen,
    // since manual outlets have no "Recce to do" home) would never show.
    const [appRes, manualRes] = await Promise.all([
      fetchMyRecces({ rsCode: f.rsCode, beatNames: f.beatNames }),
      fetchMyRecces({ recceMode: 'MANUAL' }),
    ]);
    if (appRes.success) {
      // Merge + dedupe by id (a manual recce could in principle surface in both lists), then sort
      // newest-first so the two sources interleave by capture/receive time, not by source.
      const byId = new Map<string, RecceListRow>();
      for (const r of appRes.data.recces ?? []) byId.set(r.id, r);
      if (manualRes.success) {
        for (const r of manualRes.data.recces ?? []) byId.set(r.id, r);
      }
      const merged = [...byId.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      setRecces(merged);
    } else {
      setError(
        appRes.status === 403
          ? 'Installation is not available for your account. Please ask your admin to grant access.'
          : appRes.error || 'Could not load your work. Please try again.',
      );
      setRecces(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (outlet) void load(outlet);
  }, [outlet, load]);

  // Client-side name/code search over the already-loaded (bounded) list — mirrors the recce
  // screen's search box. Filtering happens before grouping so empty status groups drop out.
  const q = query.trim().toLowerCase();
  const filtered = recces
    ? recces.filter((r) => !q || r.site.name.toLowerCase().includes(q) || r.site.code.toLowerCase().includes(q))
    : null;
  // Drop APP-rejected recces BEFORE grouping: those are re-captured from "Recce to do", not here.
  // What survives into NEEDS_RECAPTURE is therefore only MANUAL rejects — the strand-prone case that
  // has no outlet-list home and needs this screen's re-capture entry. (groupRecces drops the group
  // entirely when nothing is left, so a rep with no manual rejects sees no 'Needs re-capture'.)
  const forWork = filtered
    ? filtered.filter((r) => !(r.status === 'REJECTED' && r.recceMode === 'APP'))
    : null;
  const groups: RecceGroup[] = forWork ? groupRecces(forWork) : [];
  const hasAnyWork = !!recces && recces.length > 0;

  // Until the device filter has been read (and while redirecting when none is set), show a
  // spinner rather than flashing empty work.
  if (outlet === undefined || outlet === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <h1 className="mb-3 text-lg font-bold text-gray-900">Installation</h1>

      {/* Active outlet filter — RS code · Beat, with a Change control. */}
      <button
        type="button"
        onClick={() => router.push('/field/sites')}
        data-testid="work-filter-chip"
        className="mb-4 flex w-full items-center justify-between gap-2 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] px-3 py-2.5 text-left active:scale-[0.99] transition-transform"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
          <span className="truncate">
            RS <span className="font-semibold">{outlet.rsCode}</span> ·{' '}
            <span className="font-semibold">{beatSummary(outlet.beatNames)}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold text-[var(--brand-primary)]">Change</span>
      </button>

      {/* Outlet search — client-side over this rep's loaded work (mirrors the recce screen). */}
      {!loading && !error && hasAnyWork && (
        <div className="mb-4 flex items-center gap-2 bg-white rounded-2xl border border-gray-200 px-3 py-2.5 focus-within:border-[var(--brand-primary)] transition-colors">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="flex-1 text-sm text-gray-900 focus:outline-none bg-transparent"
          />
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your work…
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] p-4">
          <div className="flex items-start gap-2 text-sm text-gray-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-primary)]" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void load(outlet)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-bold text-white active:scale-95 transition-transform"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && groups.length === 0 && hasAnyWork && (
        <div className="text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <MapPin className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No matching outlets</p>
          <p className="text-xs text-gray-500 mt-1">Try a different search.</p>
        </div>
      )}

      {!loading && !error && groups.length === 0 && !hasAnyWork && (
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-primary-light)]">
            <ClipboardList className="h-7 w-7 text-[var(--brand-primary)]" />
          </div>
          <h2 className="text-base font-bold text-gray-900">No work yet</h2>
          <p className="mt-1.5 text-sm text-gray-500">
            Start a recce at one of your outlets and it will show up here with its status.
          </p>
          <Link
            href="/field/sites"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[var(--brand-primary)] px-5 py-3 font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
          >
            <MapPin className="h-4 w-4" />
            Browse my outlets
          </Link>
        </div>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className="space-y-6 pb-4">
          {groups.map((group) => {
            const meta = STATUS_META[group.key];
            const Icon = meta.icon;
            // Ready-to-install collapses by OUTLET: an outlet with one installable recce links
            // straight to capture (unchanged); an outlet with several (manual) opens the picker.
            const installOutlets =
              group.key === 'READY_TO_INSTALL' ? groupInstallableByOutlet(group.recces) : null;
            const headerCount = installOutlets ? installOutlets.length : group.recces.length;
            return (
              <section key={group.key}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${meta.tint}`} />
                  <h2 className="text-sm font-bold text-gray-700">{meta.label}</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                    {headerCount}
                  </span>
                </div>
                <div className="space-y-3">
                  {installOutlets
                    ? installOutlets.map((outlet) => (
                        <InstallOutletCard key={outlet.site.id} outlet={outlet} />
                      ))
                    : group.recces.map((recce) => (
                        <RecceCard key={recce.id} recce={recce} groupKey={group.key} />
                      ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── One recce row with its group-specific action ──────────────────────────────
// Reached by the read-only waiting states, the defensive install fallback, AND the MANUAL-rejected
// 'Needs re-capture' case (its re-capture action is the only home a manual reject has — APP rejects
// are filtered out before grouping and re-captured from "Recce to do" instead).
function RecceCard({ recce, groupKey }: { recce: RecceListRow; groupKey: WorkGroupKey }) {
  const key = groupKey;
  const meta = STATUS_META[key];
  const posmLabel = `${recce.posmCount} Element${recce.posmCount === 1 ? '' : 's'}`;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-gray-900">{recce.site.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            <span className="font-mono text-gray-400">{recce.site.code}</span>
            {recce.site.town && <span> · {recce.site.town}</span>}
            <span> · {posmLabel}</span>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
          {meta.label}
        </span>
      </div>

      {/* MANUAL-rejected re-capture — the only re-capture surface for a manual reject (no "Recce to
          do" home). Carries the recceId so the recce page loads THIS rejected recce and re-captures
          with element type + dimensions locked to the original. */}
      {key === 'NEEDS_RECAPTURE' && (
        <>
          {rejectionLabel(recce.hoRejectionReasonCode ?? recce.rejectionReasonCode) && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sent back: {rejectionLabel(recce.hoRejectionReasonCode ?? recce.rejectionReasonCode)}
            </p>
          )}
          <Link
            href={`/field/recce/${encodeURIComponent(recce.site.id)}?recceId=${encodeURIComponent(recce.id)}`}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-3 text-sm font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
          >
            <RefreshCw className="h-4 w-4" />
            Re-capture
          </Link>
        </>
      )}

      {key === 'AWAITING_ASM' && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
          <Clock className="h-3.5 w-3.5" />
          Awaiting ASM approval.
        </p>
      )}

      {/* Awaiting Head-Office sign-off — read-only, no install action yet. A manual recce lands
          here straight from submit (it never passes through the ASM), so don't claim ASM approval. */}
      {key === 'AWAITING_HO' && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-sky-700">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          {recce.recceMode === 'MANUAL'
            ? 'Manual recce — awaiting Head-Office approval before installation.'
            : 'Approved by ASM — awaiting Head-Office approval before installation.'}
        </p>
      )}

      {/* Install is offered ONLY once the recce is fully approved (ASM + HO). READY_TO_INSTALL is
          normally rendered by InstallOutletCard (grouped by outlet); this stays as a defensive
          per-recce fallback. */}
      {key === 'READY_TO_INSTALL' && (
        <Link
          href={`/field/install/${encodeURIComponent(recce.id)}`}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-3 text-sm font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
        >
          <Hammer className="h-4 w-4" />
          Start installation
        </Link>
      )}
    </div>
  );
}

// ── One installable OUTLET (ready-to-install, collapsed by outlet) ─────────────
// An outlet with a single installable recce links straight to its capture screen (unchanged app
// behaviour); an outlet with several recces (only possible for manual) opens the recce picker.
function InstallOutletCard({ outlet }: { outlet: InstallableOutlet }) {
  const { site, recces } = outlet;
  const many = recces.length > 1;
  const href = many
    ? `/field/install/select/${encodeURIComponent(site.id)}`
    : `/field/install/${encodeURIComponent(recces[0].id)}`;
  const meta = STATUS_META.READY_TO_INSTALL;
  const subtitle = many
    ? `${recces.length} recces ready`
    : `${recces[0].posmCount} Element${recces[0].posmCount === 1 ? '' : 's'}`;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-gray-900">{site.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            <span className="font-mono text-gray-400">{site.code}</span>
            {site.town && <span> · {site.town}</span>}
            <span> · {subtitle}</span>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
          {meta.label}
        </span>
      </div>

      <Link
        href={href}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] py-3 text-sm font-bold text-white transition-all hover:bg-[var(--brand-primary-dark)] active:scale-95"
      >
        <Hammer className="h-4 w-4" />
        {many ? 'Choose recce to install' : 'Start installation'}
      </Link>
    </div>
  );
}
