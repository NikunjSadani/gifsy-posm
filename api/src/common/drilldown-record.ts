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
  // ── Execution-funnel badge (analytics drill-down; see {@link funnelBadge}) ─────
  /**
   * Clean label for what the outlet/record is waiting on in the EXECUTION FUNNEL, worded as the
   * NEXT ACTION due: Recce pending → ASM approval pending → HO approval pending → Installation
   * pending → Audit pending → Audited, plus the terminal Recce rejected / Install rejected rungs
   * (see {@link FUNNEL_BADGE}). Optional: the analytics drill-down populates it (+ {@link funnelTone});
   * the ASM approval funnel (already stage-segmented) omits both, so the FE renders this second badge
   * only when present.
   */
  funnelStage?: string;
  /** Tone for the funnel badge, matching the report's status-cell tones. */
  funnelTone?: FunnelTone;
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

// ── Execution-funnel ladder (ONE source of truth; see analytics.service geo + site drill-down) ──

/**
 * The execution-funnel ladder, as the owner-facing report's Activity Status: the positive rungs
 * NOT_STARTED → RECCE_SUBMITTED → ASM_APPROVED → HO_APPROVED → INSTALLED → AUDITED, plus the two
 * terminal failure rungs RECCE_REJECTED (a rejected recce that went no further) and INSTALL_REJECTED
 * (an installation the auditor rejected AND HO upheld). This is the internal enum; {@link funnelBadge}
 * maps it to the clean label + tone the UI shows.
 */
export type FunnelStage =
  | 'NOT_STARTED'
  | 'RECCE_SUBMITTED'
  | 'ASM_APPROVED'
  | 'HO_APPROVED'
  | 'INSTALLED'
  | 'AUDITED'
  | 'RECCE_REJECTED'
  | 'INSTALL_REJECTED';

/** A funnel-badge tone — same vocabulary as the report's `StatusTone` (outlet-execution.helper). */
export type FunnelTone = 'neutral' | 'pending' | 'approved' | 'rejected';

/**
 * Clean label + tone for one {@link FunnelStage}. The POSITIVE rungs read as the NEXT ACTION the
 * outlet is waiting on (so the badge answers "what needs to happen next, until it is audited?"):
 * Recce pending → ASM approval pending → HO approval pending → Installation pending → Audit pending
 * → Audited (the only terminal "done"). The two failure rungs stay as explicit rejected states.
 * Tones: neutral before any work, pending while an action is owed, approved only once Audited.
 */
const FUNNEL_BADGE: Record<FunnelStage, { funnelStage: string; funnelTone: FunnelTone }> = {
  NOT_STARTED: { funnelStage: 'Recce pending', funnelTone: 'neutral' },
  RECCE_SUBMITTED: { funnelStage: 'ASM approval pending', funnelTone: 'pending' },
  ASM_APPROVED: { funnelStage: 'HO approval pending', funnelTone: 'pending' },
  HO_APPROVED: { funnelStage: 'Installation pending', funnelTone: 'pending' },
  INSTALLED: { funnelStage: 'Audit pending', funnelTone: 'pending' },
  AUDITED: { funnelStage: 'Audited', funnelTone: 'approved' },
  RECCE_REJECTED: { funnelStage: 'Recce rejected', funnelTone: 'rejected' },
  INSTALL_REJECTED: { funnelStage: 'Install rejected', funnelTone: 'rejected' },
};

/** Map a {@link FunnelStage} to the drill-down row's `{ funnelStage, funnelTone }` badge fields. */
export function funnelBadge(stage: FunnelStage): { funnelStage: string; funnelTone: FunnelTone } {
  return FUNNEL_BADGE[stage];
}

/** Minimal recce shape the funnel fold reads (status + optional HO review outcome). */
export interface FunnelRecceInput {
  status: string | null | undefined;
  hoReviewStatus?: string | null | undefined;
}
/** Minimal installation shape the funnel fold reads (status + optional HO review outcome). */
export interface FunnelInstallInput {
  status: string | null | undefined;
  hoReviewStatus?: string | null | undefined;
}

/**
 * One recce's funnel stage with NO installation context (recce-stage drill-down rows). Mirrors
 * {@link recceLifecycleLabel}: rejected → HO approved → ASM approved → submitted; a null status
 * (no recce) → not started.
 */
export function recceFunnelStage(
  status: string | null | undefined,
  hoReviewStatus: string | null | undefined,
): FunnelStage {
  if (!status) return 'NOT_STARTED';
  if (status === 'REJECTED') return 'RECCE_REJECTED';
  if (hoReviewStatus === 'APPROVED') return 'HO_APPROVED';
  if (status === 'APPROVED') return 'ASM_APPROVED';
  return 'RECCE_SUBMITTED'; // SUBMITTED, HO not yet approved
}

/**
 * One installation's funnel stage (install-stage drill-down rows). Audited once the auditor
 * approved OR HO overruled to approved; the terminal INSTALL_REJECTED only when the auditor
 * rejected AND HO upheld that rejection; otherwise still in-flight → INSTALLED.
 */
export function installFunnelStage(
  status: string | null | undefined,
  hoReviewStatus: string | null | undefined,
): FunnelStage {
  if (status === 'AUDIT_APPROVED' || hoReviewStatus === 'APPROVED') return 'AUDITED';
  if (status === 'AUDIT_REJECTED' && hoReviewStatus === 'REJECTED') return 'INSTALL_REJECTED';
  return 'INSTALLED';
}

/** Rank the positive recce rungs so a site's MANY recces fold to the single furthest one reached. */
const POSITIVE_RECCE_RANK: Partial<Record<FunnelStage, number>> = {
  RECCE_SUBMITTED: 1,
  ASM_APPROVED: 2,
  HO_APPROVED: 3,
};

/**
 * Fold ALL of a site's recces + installs into the single FURTHEST execution-funnel stage it has
 * reached — the ONE source of truth shared by the analytics geo heatmap (via {@link funnelStageToGeo})
 * and the "Total outlets" site drill-down. An installation is downstream of the recce ladder, so an
 * installed/audited outlet rolls up past the recce rungs; a site whose ONLY install is a terminal
 * HO-upheld rejection reads INSTALL_REJECTED, and a site with only rejected recce(s) (no install)
 * reads RECCE_REJECTED. A missing `hoReviewStatus` (e.g. the lean geo install select) is tolerated.
 */
export function siteFunnelStage(
  recces: FunnelRecceInput[],
  installs: FunnelInstallInput[],
): FunnelStage {
  // Installs first — they dominate the recce rungs.
  let anyInstall = false;
  let anyAudited = false;
  let anyLiveInstall = false; // an install that is NOT a terminal HO-upheld rejection
  for (const i of installs ?? []) {
    anyInstall = true;
    const st = installFunnelStage(i.status, i.hoReviewStatus);
    if (st === 'AUDITED') anyAudited = true;
    else if (st === 'INSTALLED') anyLiveInstall = true;
    // INSTALL_REJECTED contributes to neither (terminal fail).
  }
  if (anyAudited) return 'AUDITED';
  if (anyLiveInstall) return 'INSTALLED';
  if (anyInstall) return 'INSTALL_REJECTED'; // installs exist but ALL terminal-rejected

  // No installation — the furthest recce rung reached.
  let best: FunnelStage | null = null;
  let anyRejected = false;
  let anyRecce = false;
  for (const r of recces ?? []) {
    anyRecce = true;
    const st = recceFunnelStage(r.status, r.hoReviewStatus);
    if (st === 'RECCE_REJECTED') {
      anyRejected = true;
      continue;
    }
    if (st === 'NOT_STARTED') continue; // null-status recce (pathological) — ignore
    const rank = POSITIVE_RECCE_RANK[st] ?? 0;
    const bestRank = best ? (POSITIVE_RECCE_RANK[best] ?? 0) : -1;
    if (rank > bestRank) best = st;
  }
  if (best) return best;
  if (anyRejected) return 'RECCE_REJECTED';
  if (anyRecce) return 'RECCE_SUBMITTED'; // defensive: a recce present but unrankable
  return 'NOT_STARTED';
}

/** One recce for the LATEST-recce fold: a sort date + the recce's own installation (if any). */
export interface LatestRecceInput extends FunnelRecceInput {
  capturedAt?: Date | string | null;
  receivedAt?: Date | string | null;
  /** The recce's own installation (to-one), or null/absent until it is installed. */
  installation?: FunnelInstallInput | null;
}

/**
 * The execution-funnel stage of the outlet's LATEST recce (by capture date), for the "Total outlets"
 * drill-down BADGE — a RECORD view answering "what is the current state of work at this outlet". This
 * is deliberately NOT {@link siteFunnelStage} (the furthest-stage fold that still drives the geo
 * heatmap): here the single most-recent recce is shown as-is, with its OWN installation folded in
 * exactly like the report's per-recce Activity Status column — so a newer recce is never masked by an
 * older one, and vice-versa. No recces → NOT_STARTED. Ties on date keep the first-seen recce.
 */
export function latestRecceFunnelStage(recces: LatestRecceInput[]): FunnelStage {
  if (!recces || recces.length === 0) return 'NOT_STARTED';
  const timeOf = (r: LatestRecceInput) => {
    const d = r.capturedAt ?? r.receivedAt ?? null;
    const t = d ? new Date(d).getTime() : NaN;
    return Number.isNaN(t) ? -Infinity : t; // undated recces sort oldest
  };
  let latest = recces[0];
  let latestT = timeOf(latest);
  for (let i = 1; i < recces.length; i++) {
    const t = timeOf(recces[i]);
    if (t > latestT) { latest = recces[i]; latestT = t; }
  }
  return latest.installation
    ? installFunnelStage(latest.installation.status, latest.installation.hoReviewStatus)
    : recceFunnelStage(latest.status, latest.hoReviewStatus);
}

/** The 6-value furthest-stage heatmap vocabulary (NO rejected rungs — see analytics geo). */
export type SiteFurthestStage =
  | 'NONE'
  | 'RECCED'
  | 'ASM_APPROVED'
  | 'HO_APPROVED'
  | 'INSTALLED'
  | 'AUDITED';

/**
 * Collapse the full {@link FunnelStage} to the 6-value heatmap vocabulary the geo map uses: a
 * rejected recce still counts as coverage (→ RECCED) and any installation (even a rejected one)
 * still counts as INSTALLED — preserving the map's original furthest-stage semantics exactly.
 */
const FUNNEL_TO_GEO: Record<FunnelStage, SiteFurthestStage> = {
  NOT_STARTED: 'NONE',
  RECCE_SUBMITTED: 'RECCED',
  RECCE_REJECTED: 'RECCED',
  ASM_APPROVED: 'ASM_APPROVED',
  HO_APPROVED: 'HO_APPROVED',
  INSTALLED: 'INSTALLED',
  INSTALL_REJECTED: 'INSTALLED',
  AUDITED: 'AUDITED',
};

/** The geo heatmap's furthest stage for a site — {@link siteFunnelStage} collapsed to 6 values. */
export function funnelStageToGeo(stage: FunnelStage): SiteFurthestStage {
  return FUNNEL_TO_GEO[stage];
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
