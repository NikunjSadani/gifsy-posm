/**
 * The ONE shared enriched drill-down record shape + the pure helpers that build it.
 *
 * Returned IDENTICALLY by both drill-down sources so a dashboard tile's sheet (admin analytics,
 * Vendor-HO console) and the ASM funnel (approval) can never drift:
 *   - AnalyticsService.drilldown()  — the Analytics-dashboard tiles (admin + VENDOR_HO + ASM).
 *   - ApprovalService.records()     — the ASM approval funnel.
 *
 * Phase E enrichment (added on top of the original outlet code/name/town + status): the capture
 * date, the fleet vendor, an element-type summary, the element dimension(s), and a HUMAN status
 * label that reuses the SAME lifecycle vocabulary as the execution report (Not started / Submitted
 * / ASM approved / HO approved / Rejected). The helpers are pure (no Prisma, no Nest) so the two
 * services share the exact mapping and the xlsx exporter can reuse it verbatim.
 */

/** One enriched row behind a dashboard metric / funnel stage. Shared by both drill-down sources. */
export interface DrilldownRecordItem {
  id: string;
  outletCode: string;
  outletName: string;
  town: string | null;
  /** The recce id for an APP recce-based row (FE deep-links to it); null otherwise (manual / install / outlet). */
  recceId: string | null;
  /** Raw status (RecceStatus / InstallationStatus / SiteStatus) — kept for back-compat + chip tone. */
  status: string | null;
  // ── Phase E enrichment ───────────────────────────────────────────────────────
  /** Capture time of the recce / installation (ISO on the wire); null for the outlet universe. */
  recceDate: Date | null;
  /** The fleet vendor's name; null when the outlet carries no vendor. */
  vendorName: string | null;
  /** Element type name(s) summary, e.g. "Glow Sign Board, Banner (+2)"; null when no elements. */
  elementSummary: string | null;
  /** Element W×H dimension(s) summary, e.g. "4 × 3 ft"; null when no elements / none captured. */
  dimensions: string | null;
  /** Human lifecycle label (Not started / Submitted / ASM approved / HO approved / Rejected / …). */
  statusLabel: string | null;
}

/** An element-type line-count bucket in the drill-down breakdown. */
export interface ElementTypeCount {
  code: string;
  name: string;
  count: number;
}

/**
 * The scoped, KEYSET-paged enriched drill-down response for a dashboard tile / funnel stage.
 * No `page` number: paging is by `afterId` cursor (the client walks pages by the last row's id),
 * so a page index would be meaningless. `total` is the server-wide count (drives the FE header +
 * stop condition) and `limit` is the page size.
 */
export interface DrilldownResult {
  items: DrilldownRecordItem[];
  byElementType: ElementTypeCount[];
  total: number;
  limit: number;
}

/** How many distinct element-type names to spell out before collapsing the rest into "(+N)". */
const MAX_ELEMENT_NAMES = 2;
/** How many distinct dimension strings to spell out before collapsing the rest into "(+N)". */
const MAX_DIMENSIONS = 2;

/**
 * The HUMAN recce-lifecycle label, matching the execution report's `recceStatusCell` exactly:
 * Rejected → HO approved (terminal good) → ASM approved (mid-pipeline, awaiting HO) → Submitted.
 * A null status (an outlet with no recce) reads "Not started". Kept here (not imported from the
 * report helper) so this module stays a pure, self-contained source of truth for the drill-down.
 */
export function recceLifecycleLabel(
  status: string | null | undefined,
  hoReviewStatus: string | null | undefined,
): string {
  if (!status) return 'Not started';
  if (status === 'REJECTED') return 'Rejected';
  if (hoReviewStatus === 'APPROVED') return 'HO approved';
  if (status === 'APPROVED') return 'ASM approved';
  return 'Submitted'; // SUBMITTED, HO not yet approved
}

/**
 * The HUMAN installation-lifecycle label. The install lane has no ASM stage; an audit sign-off is
 * the terminal good state. SUBMITTED reads "Submitted" (awaiting audit); AUDIT_APPROVED → "Audited";
 * AUDIT_REJECTED → "Audit rejected". Any unexpected value falls back to a title-cased form.
 */
export function installLifecycleLabel(status: string | null | undefined): string {
  switch (status) {
    case 'SUBMITTED':
      return 'Submitted';
    case 'AUDIT_APPROVED':
      return 'Audited';
    case 'AUDIT_REJECTED':
      return 'Audit rejected';
    default:
      return titleCase(status);
  }
}

/** The HUMAN site-status label for the outlet universe metric (ACTIVE → "Active", …). */
export function siteStatusLabel(status: string | null | undefined): string {
  return titleCase(status);
}

/** UPPER_SNAKE / lowercase → "Title case"; empty / null → "". */
function titleCase(v: string | null | undefined): string {
  if (!v) return '';
  return v
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Summarise the element-type names on a record into one short, de-duplicated string. Preserves
 * first-seen order, spells out up to {@link MAX_ELEMENT_NAMES} distinct names, then collapses the
 * remainder into a "(+N)" suffix. Returns null when there are no named elements.
 */
export function summarizeElementNames(names: (string | null | undefined)[]): string | null {
  const distinct: string[] = [];
  for (const n of names) {
    const name = (n ?? '').trim();
    if (name && !distinct.includes(name)) distinct.push(name);
  }
  if (distinct.length === 0) return null;
  const shown = distinct.slice(0, MAX_ELEMENT_NAMES).join(', ');
  const extra = distinct.length - MAX_ELEMENT_NAMES;
  return extra > 0 ? `${shown} (+${extra})` : shown;
}

/**
 * Format one stored dimensions value (`{ width, height, unit }`, or a legacy string) into a
 * "W × H unit" label, or null when nothing renderable. Mirrors the FE `dimensionsLabel` so the
 * drill-down list and the export agree with the recce detail view.
 */
export function formatDimensions(dimensions: unknown): string | null {
  if (!dimensions) return null;
  if (typeof dimensions === 'string') return dimensions.trim() || null;
  if (typeof dimensions === 'object') {
    const d = dimensions as Record<string, unknown>;
    const w = d.width ?? d.w;
    const h = d.height ?? d.h;
    if (w != null && h != null) {
      const unit = typeof d.unit === 'string' && d.unit.trim() ? ` ${d.unit.trim()}` : '';
      return `${String(w)} × ${String(h)}${unit}`;
    }
  }
  return null;
}

/**
 * Summarise a record's element dimensions into one short, de-duplicated string. Formats each
 * element's dimensions, de-dupes (a common case: every element shares one size), spells out up to
 * {@link MAX_DIMENSIONS} distinct values, then collapses the remainder into "(+N)". Null when none.
 */
export function summarizeDimensions(dimensions: unknown[]): string | null {
  const distinct: string[] = [];
  for (const d of dimensions) {
    const label = formatDimensions(d);
    if (label && !distinct.includes(label)) distinct.push(label);
  }
  if (distinct.length === 0) return null;
  const shown = distinct.slice(0, MAX_DIMENSIONS).join(', ');
  const extra = distinct.length - MAX_DIMENSIONS;
  return extra > 0 ? `${shown} (+${extra})` : shown;
}

/** A single element line as the mappers below consume it (name + raw dimensions). */
export interface ElementLineInput {
  name: string | null | undefined;
  dimensions: unknown;
}

/** The `{ elementSummary, dimensions }` pair for a record, from its element lines. */
export function summarizeElements(lines: ElementLineInput[]): {
  elementSummary: string | null;
  dimensions: string | null;
} {
  return {
    elementSummary: summarizeElementNames(lines.map((l) => l.name)),
    dimensions: summarizeDimensions(lines.map((l) => l.dimensions)),
  };
}

/** Column headers for the drill-down xlsx export, in order. Shared so FE/BE never drift. */
export const DRILLDOWN_XLSX_HEADERS = [
  'Outlet Code',
  'Outlet Name',
  'Town',
  'Vendor',
  'Element(s)',
  'W × H',
  'Recce Date',
  'Status',
] as const;

/** IST calendar date (YYYY-MM-DD) for an xlsx cell, or '' when absent. */
export function xlsxDate(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Project one enriched item onto the export's column record (keys = {@link DRILLDOWN_XLSX_HEADERS}). */
export function drilldownXlsxRow(item: DrilldownRecordItem): Record<string, string> {
  return {
    'Outlet Code': item.outletCode ?? '',
    'Outlet Name': item.outletName ?? '',
    Town: item.town ?? '',
    Vendor: item.vendorName ?? '',
    'Element(s)': item.elementSummary ?? '',
    'W × H': item.dimensions ?? '',
    'Recce Date': xlsxDate(item.recceDate),
    Status: item.statusLabel ?? item.status ?? '',
  };
}
