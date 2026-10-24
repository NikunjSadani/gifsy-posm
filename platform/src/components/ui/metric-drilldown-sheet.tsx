'use client';

/**
 * MetricDrilldownSheet — a mobile-first bottom-sheet that lists the records behind a dashboard
 * metric. Built reusable: it takes a generic `fetcher` (any call that resolves to a records page
 * of `ApprovalRecord`s with an optional `byElementType` rollup) so later Phase-2 dashboards can
 * open the same sheet against their own endpoints.
 *
 * Behaviour:
 *   • opens on `open` → calls `fetcher()` once, shows a spinner, then the list;
 *   • `byElementType` (when non-empty) renders as a compact chip row ABOVE the outlet list;
 *   • each row shows outlet code + name + town + a status badge; a row whose `onItemHref` returns
 *     a non-null href is a `Link`, otherwise a plain row;
 *   • honest empty + error states (with retry), header with title + server-wide total + close.
 *
 * Accessibility: role="dialog" + aria-modal, focus moves into the panel on open and is trapped
 * (Tab / Shift+Tab wrap), Esc closes, focus returns to the trigger on close. Body scroll is locked
 * while open and the PRIOR overflow value is restored (never hard-resets someone else's lock).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X, ChevronRight, AlertTriangle, Inbox, Download, Calendar, Ruler, Building2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import type { ApiResponse } from '@/lib/api-client';
import type { ApprovalRecord, ElementTypeBreakdown } from '@/lib/review/api';

/** The minimal records-page shape the sheet needs; `byElementType` is optional for reuse. */
export interface DrilldownPage {
  items: ApprovalRecord[];
  total: number;
  byElementType?: ElementTypeBreakdown[];
}

export interface MetricDrilldownSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Resolves to one records page. Kept generic so other dashboards can supply their own call. */
  fetcher: () => Promise<ApiResponse<DrilldownPage>>;
  /** Optional per-row deep link; a non-null return makes the row a `Link`, else it's plain. */
  onItemHref?: (item: ApprovalRecord) => string | null;
  /**
   * Optional same-origin `.xlsx` URL for the CURRENTLY-drilled set (the full, uncapped export).
   * When provided, an "Export Excel" button appears in the header and downloads that URL via an
   * `<a href download>` (edge proxy injects auth) — scoped server-side exactly like the drill-down.
   */
  exportHref?: string | null;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Tone for the human status label (or raw status). REJECT is checked first so "Audit rejected"
 * reads red, not green; AUDIT/APPROVE → green; INSTALL → amber; SUBMIT → blue; "Not started" and
 * anything else → neutral grey (honest default, never a misleading colour).
 */
function statusTone(status: string | null): string {
  const s = (status ?? '').toUpperCase();
  if (s.includes('REJECT')) return 'bg-red-50 text-red-700';
  if (s.includes('INSTALL')) return 'bg-amber-50 text-amber-700';
  if (s.includes('AUDIT') || s.includes('APPROVE')) return 'bg-emerald-50 text-emerald-700';
  if (s.includes('SUBMIT')) return 'bg-blue-50 text-blue-700';
  return 'bg-gray-100 text-gray-600';
}

/** Short, locale-stable date for a recce/install capture ISO; '' when absent/unparseable. */
function formatRecceDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A compact, icon-led meta chip (vendor / date / elements / dimensions). Hidden when no value. */
function MetaChip({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 min-w-0">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

function RecordRow({ item, href }: { item: ApprovalRecord; href: string | null }) {
  const statusText = item.statusLabel ?? item.status;
  const recceDate = formatRecceDate(item.recceDate);
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {item.outletName}
            <span className="ml-1.5 text-xs font-normal text-gray-400">{item.outletCode}</span>
          </p>
          {statusText && (
            <span
              className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(statusText)}`}
            >
              {statusText}
            </span>
          )}
        </div>
        {/* Line 2: town + vendor + capture date */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {item.town && <MetaChip>{item.town}</MetaChip>}
          {item.vendorName && (
            <MetaChip icon={<Building2 className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />}>
              {item.vendorName}
            </MetaChip>
          )}
          {recceDate && (
            <MetaChip icon={<Calendar className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />}>
              {recceDate}
            </MetaChip>
          )}
        </div>
        {/* Line 3: element summary + dimensions (only when the metric has elements) */}
        {(item.elementSummary || item.dimensions) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {item.elementSummary && (
              <MetaChip>
                <span className="font-medium text-gray-600">{item.elementSummary}</span>
              </MetaChip>
            )}
            {item.dimensions && (
              <MetaChip icon={<Ruler className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />}>
                {item.dimensions}
              </MetaChip>
            )}
          </div>
        )}
      </div>
      {href && <ChevronRight className="h-4 w-4 shrink-0 self-center text-gray-300" aria-hidden />}
    </>
  );

  const rowClass =
    'flex items-start gap-3 py-3 border-b border-gray-100 last:border-0 -mx-5 px-5';

  if (href) {
    return (
      <Link href={href} className={`${rowClass} hover:bg-gray-50 active:bg-gray-100 transition-colors`}>
        {inner}
      </Link>
    );
  }
  return <div className={rowClass}>{inner}</div>;
}

export function MetricDrilldownSheet({ open, title, onClose, fetcher, onItemHref, exportHref }: MetricDrilldownSheetProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ApprovalRecord[]>([]);
  const [breakdown, setBreakdown] = useState<ElementTypeBreakdown[]>([]);
  const [total, setTotal] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest fetcher/onClose without re-running the load/focus effects when the parent
  // passes a fresh inline closure on every render.
  const fetcherRef = useRef(fetcher);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    fetcherRef.current = fetcher;
    onCloseRef.current = onClose;
  });

  // Load on open (and when the title/stage changes, or a retry is requested).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setBreakdown([]);
    setTotal(0);
    void (async () => {
      const res = await fetcherRef.current();
      if (cancelled) return;
      if (res.success) {
        setItems(res.data.items);
        setBreakdown(res.data.byElementType ?? []);
        setTotal(res.data.total);
      } else {
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, title, reloadNonce]);

  // Lock body scroll while open; restore the prior value on close (never hard-reset).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus management + Tab trap + Esc-to-close while open.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = (): HTMLElement[] =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    (focusables()[0] ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = !!panel && panel.contains(active);
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[85vh] fade-in focus:outline-none"
      >
        {/* Grab handle (mobile affordance) */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1" aria-hidden>
          <span className="h-1.5 w-10 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-5 pt-3 pb-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 truncate">{title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {loading ? 'Loading…' : `${total.toLocaleString()} record${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            {/* Export the FULL (uncapped) drilled set; scoped server-side like the sheet. Hidden
                until the first load resolves with at least one record. */}
            {exportHref && !loading && !error && total > 0 && (
              <a
                href={exportHref}
                download
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-xs font-semibold px-2.5 py-2 hover:bg-gray-50 active:scale-95 transition-all"
                aria-label="Export these records to Excel"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export Excel</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 active:scale-95 transition-all"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 px-2 text-center">
              <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-gray-800">Couldn&apos;t load these records</p>
              <p className="text-sm text-gray-500 mt-1">{error}</p>
              <button onClick={retry} className="mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline">
                Try again
              </button>
            </div>
          ) : (
            <>
              {breakdown.length > 0 && (
                <div className="pt-3 pb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                    Elements
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {breakdown.map((b) => (
                      <span
                        key={b.code}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                      >
                        <span className="font-medium">{b.name}</span>
                        <span className="text-gray-400">×</span>
                        <span className="font-semibold tabular-nums">{b.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-2 text-center">
                  <div className="p-4 bg-gray-100 rounded-full mb-3 text-gray-400">
                    <Inbox className="h-6 w-6" />
                  </div>
                  <p className="text-base font-semibold text-gray-900">No records</p>
                  <p className="text-sm text-gray-500 mt-1">Nothing to show for this metric yet.</p>
                </div>
              ) : (
                <div className={breakdown.length > 0 ? 'mt-2 border-t border-gray-100' : ''}>
                  {items.map((item) => (
                    <RecordRow key={item.id} item={item} href={onItemHref ? onItemHref(item) : null} />
                  ))}
                  {total > items.length && (
                    <p className="py-3 text-center text-xs text-gray-400">
                      Showing the first {items.length.toLocaleString()} of {total.toLocaleString()}.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default MetricDrilldownSheet;
