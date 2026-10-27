/**
 * outlet-execution.helper.ts — the PURE column contract + row builder for the admin "Recce Report"
 * (curated redesign, 2026-10-24; supersedes the flat 39-column string sheet). No Nest/Prisma imports
 * so it is trivially unit-testable; the service loads the Sites with the right includes and hands
 * each one here.
 *
 * NEW CONTRACT — the report is now a `{ columns: ReportColumn[], rows: ReportRow[] }` pair the FE
 * table renders verbatim. A row's `cells` is a map keyed by the column `key`; each cell is a small
 * discriminated union ({@link Cell}) so the FE can render text, a toned status chip, or a tappable
 * photo (with its geotag) without re-deriving anything. One ROW PER RECCE (unchanged grain):
 *   - an app-only outlet (1 app recce)       → 1 row;
 *   - an outlet with 1 app + N manual recces → 1 + N rows (outlet-identity cells repeat; each row's
 *                                                element + status cells are THAT recce's own facts);
 *   - an outlet with NO recce yet            → still 1 row (a neutral "Not started" recce status).
 *
 * Column ORDER is the order of {@link CURATED_COLUMNS}; the FE reads that array for the header. The
 * EXCEL-ONLY `audit` group (excelOnly:true) carries the approval audit trail — the FE table skips
 * those columns, but the .xlsx export includes them so the download is a self-contained audit record.
 */

// ── Column + cell contract (authoritative — the FE builds to this verbatim) ────────────────────

/** The display group a column belongs to (drives the FE's grouped header). `install` is the
 *  installed-variant group (appended after the element groups, before `overall`); it is absent from
 *  the recce-mode column set. */
export type ColumnGroup =
  | 'outlet'
  | 'location'
  | 'profile'
  | 'element1'
  | 'element2'
  | 'install'
  | 'overall'
  | 'audit';

/** The report variant. `recce` = the original recce report; `installed` = the installed variant that
 *  adds the per-element install status + photo, the install metadata and the install audit trail. */
export type ReportMode = 'recce' | 'installed';

/** One column of the report. `pinned` freezes the outlet identity to the left; `excelOnly` columns
 *  are omitted by the on-screen table but ALWAYS written to the .xlsx export. */
export interface ReportColumn {
  key: string;
  label: string;
  group: ColumnGroup;
  pinned?: boolean;
  excelOnly?: boolean;
}

/** A status-chip tone — the FE maps these to colours. */
export type StatusTone = 'approved' | 'pending' | 'rejected' | 'neutral';

/** A single cell value — a discriminated union on `t`. */
export type Cell =
  | { t: 'text'; v: string }
  | { t: 'status'; v: string; tone: StatusTone }
  /**
   * A tappable photo. `markup` (RECCE photos only) is the raw stored on-image annotation
   * (`ReccePosm.markup`); the FE draws it as the element-placement box over the thumbnail + the
   * lightbox (parsed defensively there). INSTALL photos carry no markup (InstallPosm has none).
   */
  | { t: 'photo'; key: string; viewPath: string; lat?: number; lng?: number; markup?: unknown }
  | { t: 'empty' };

/** One report row — one recce (outlet identity repeated across an outlet's recces). */
export interface ReportRow {
  /** Stable unique id: the recce id, or `site-<siteId>` for a no-recce outlet. */
  id: string;
  outletCode: string;
  outletName: string;
  cells: Record<string, Cell>;
}

/** The curated column set, in display order + group. (The FE renders exactly this.) */
export const CURATED_COLUMNS: ReportColumn[] = [
  // Outlet identity — pinned left.
  { key: 'outletCode', label: 'Outlet Code', group: 'outlet', pinned: true },
  { key: 'outletName', label: 'Outlet Name', group: 'outlet', pinned: true },
  // Location. `outletStatus` (the outlet-master status chip) sits first here, immediately after the
  // pinned identity, so it reads right next to the outlet — WITHOUT un-pinning the identity group
  // (adding a non-pinned column to the `outlet` group would flip that group off `pinned`).
  { key: 'outletStatus', label: 'Outlet Status', group: 'location' },
  { key: 'town', label: 'Town', group: 'location' },
  { key: 'state', label: 'State', group: 'location' },
  { key: 'rs', label: 'RS', group: 'location' },
  { key: 'vendor', label: 'Vendor', group: 'location' },
  // Profile.
  { key: 'outletType', label: 'Outlet Type', group: 'profile' },
  { key: 'source', label: 'Source', group: 'profile' },
  { key: 'recceDate', label: 'Recce Date', group: 'profile' },
  { key: 'promoter', label: 'Promoter ID', group: 'profile' },
  // Element 1.
  { key: 'el1Type', label: 'Element 1', group: 'element1' },
  { key: 'el1Dims', label: 'Element 1 W×H', group: 'element1' },
  { key: 'el1RecceStatus', label: 'Element 1 Status', group: 'element1' },
  { key: 'el1Photo', label: 'Element 1 Image', group: 'element1' },
  // Element 2.
  { key: 'el2Type', label: 'Element 2', group: 'element2' },
  { key: 'el2Dims', label: 'Element 2 W×H', group: 'element2' },
  { key: 'el2RecceStatus', label: 'Element 2 Status', group: 'element2' },
  { key: 'el2Photo', label: 'Element 2 Image', group: 'element2' },
  // Overall. `activityStatus` sits next to `recceStatus` — the execution-pipeline rollup (see
  // activityStatusCell). In installed mode the `install` group is spliced in BEFORE `recceStatus`,
  // so these two stay together at the end of the on-screen groups.
  { key: 'recceStatus', label: 'Recce Status', group: 'overall' },
  { key: 'activityStatus', label: 'Activity Status', group: 'overall' },
  // Audit trail — EXCEL ONLY (FE table skips these; the .xlsx includes them).
  { key: 'capturedOn', label: 'Captured On', group: 'audit', excelOnly: true },
  { key: 'asmApprovedBy', label: 'ASM Approved By', group: 'audit', excelOnly: true },
  { key: 'asmApprovedOn', label: 'ASM Approved On', group: 'audit', excelOnly: true },
  { key: 'hoApprovedBy', label: 'HO Approved By', group: 'audit', excelOnly: true },
  { key: 'hoApprovedOn', label: 'HO Approved On', group: 'audit', excelOnly: true },
];

/**
 * The installed-variant columns — a new `install` group inserted BEFORE the `overall` column, with
 * per-element install status + photo, then the install metadata (date / installer / audit status /
 * before↔after geo). Element 1/2 map to the recce POSM slots 1/2 (install photo via the 1:1
 * InstallPosm linked to each ReccePosm).
 */
export const INSTALL_COLUMNS: ReportColumn[] = [
  { key: 'el1InstallStatus', label: 'Element 1 Install', group: 'install' },
  { key: 'el1InstallPhoto', label: 'Element 1 Install Image', group: 'install' },
  { key: 'el2InstallStatus', label: 'Element 2 Install', group: 'install' },
  { key: 'el2InstallPhoto', label: 'Element 2 Install Image', group: 'install' },
  { key: 'installDate', label: 'Install Date', group: 'install' },
  { key: 'installer', label: 'Installer ID', group: 'install' },
  { key: 'auditStatus', label: 'Audit Status', group: 'install' },
  // HO override outcome — read INDEPENDENTLY of `auditStatus` (the auditor verdict). An auditor-
  // rejected-then-HO-accepted install shows a red "Audit rejected" here AND a green "HO approved".
  { key: 'installHoStatus', label: 'Install HO Review', group: 'install' },
  { key: 'beforeAfterGeo', label: 'Before/After Geo', group: 'install' },
];

/** The install audit trail — EXCEL ONLY, appended to the `audit` group after the recce approvers. */
export const INSTALL_AUDIT_COLUMNS: ReportColumn[] = [
  { key: 'installAuditedBy', label: 'Install Audited By', group: 'audit', excelOnly: true },
  { key: 'installAuditedOn', label: 'Install Audited On', group: 'audit', excelOnly: true },
  { key: 'installHoReviewedBy', label: 'Install HO Reviewed By', group: 'audit', excelOnly: true },
  { key: 'installHoReviewedOn', label: 'Install HO Reviewed On', group: 'audit', excelOnly: true },
];

/**
 * The column contract for a given mode. `recce` → exactly {@link CURATED_COLUMNS} (unchanged).
 * `installed` → the same, with the `install` group spliced in right before the `overall` column and
 * the install audit columns appended after the recce audit trail.
 */
export function columnsForMode(mode: ReportMode): ReportColumn[] {
  if (mode !== 'installed') return CURATED_COLUMNS;
  const out: ReportColumn[] = [];
  for (const col of CURATED_COLUMNS) {
    if (col.key === 'recceStatus') out.push(...INSTALL_COLUMNS); // install group → before `overall`
    out.push(col);
    if (col.key === 'hoApprovedOn') out.push(...INSTALL_AUDIT_COLUMNS); // after the recce audit trail
  }
  return out;
}

// ── Minimal source shapes (a subset of the Prisma includes the service passes) ────────────────

export interface RepPosmType {
  name: string | null;
}
/** The installed-POSM photo linked 1:1 to its ReccePosm (installed mode only). Optional so recce-mode
 *  fixtures/queries can omit it entirely. */
export interface RepInstallPosm {
  photo: unknown; // MediaValue { key, geo? }
  captureLat?: unknown;
  captureLng?: unknown;
  geoFenceOk?: boolean | null;
  distanceFromRecce?: unknown; // recce↔install distance (metres, Prisma Decimal | number | null)
}
export interface RepReccePosm {
  slotNo: number;
  posmType: RepPosmType | null;
  dimensions: unknown; // {width,height,unit} entered by the rep
  photo: unknown; // MediaValue { key, geo? }
  /** The normalised on-image install-area annotation (rect/path, 0..1). Read by the PPT export and the
   *  on-screen report (the recce photo cell + lightbox draw the box); the xlsx path ignores it.
   *  Optional so pure fixtures can omit it. */
  markup?: unknown;
  /** The install photo that fulfils this recce element (installed mode). Null/absent when the element
   *  has not been installed yet. */
  installPosm?: RepInstallPosm | null;
}
/** One installation of a recce (installed mode only). Optional on RepRecce so recce-mode omits it. */
export interface RepInstallation {
  // `status` + `hoReviewStatus` are the ONLY fields the recce-report lean select loads (and all the
  // activity-status rollup reads). The rest are loaded only by the installed-mode include, so they are
  // OPTIONAL — a recce-mode read of one is then a compile error, not a silent runtime `undefined`.
  status: string; // SUBMITTED | AUDIT_APPROVED | AUDIT_REJECTED
  capturedAt?: Date | string | null;
  receivedAt?: Date | string | null;
  submittedBy?: { promoterCode: string | null } | null; // the installer (VENDOR_FIELD)
  auditedBy?: { name: string | null } | null;
  auditedAt?: Date | string | null;
  /**
   * The HO/Admin escalation outcome, ORTHOGONAL to `status`. On an audit REJECT the row escalates to
   * HO and `status` stays AUDIT_REJECTED while this moves PENDING → APPROVED/REJECTED — so the report
   * must surface it INDEPENDENTLY of the auditor verdict (see {@link installHoStatusCell}). NONE =
   * not escalated (auditor approved / not yet audited). Optional so recce-mode fixtures can omit it.
   */
  hoReviewStatus?: string | null; // NONE | PENDING | APPROVED | REJECTED
  /** The HO/Admin reviewer (install HO-override audit trail). Prefers `name`, falls back to promoterCode. */
  hoReviewedBy?: { name?: string | null; promoterCode?: string | null } | null;
  hoReviewedAt?: Date | string | null;
}
export interface RepRecce {
  id: string;
  /** APP = the one in-app recce; MANUAL = a field-typed recce (skips ASM → HO). Drives "Source". */
  recceMode: string;
  status: string;
  hoReviewStatus: string;
  capturedAt: Date | string | null;
  receivedAt: Date | string | null;
  /** Representative capture geotag (Prisma Decimal | number | null). PPT export GPS-link fallback
   *  when a photo carries no geo. Optional so pure fixtures can omit it. */
  captureLat?: unknown;
  captureLng?: unknown;
  // Approval audit stamps (for the excel-only audit group).
  reviewedAt: Date | string | null;
  hoReviewedAt: Date | string | null;
  submittedBy: { promoterCode: string | null } | null;
  approvedBy: { name: string | null } | null;
  hoReviewedBy: { name: string | null } | null;
  posms: (RepReccePosm & { id: string })[];
  /** The installation fulfilling this recce (installed mode). Null/absent until the outlet is
   *  installed; the installed report filters to recces that HAVE one. */
  installation?: RepInstallation | null;
}
export interface RepSite {
  id: string;
  code: string;
  name: string;
  town: string | null;
  state: string | null;
  rsCode: string | null;
  rsName: string | null;
  channel: string | null;
  /** The vendor (fleet) servicing this outlet — the "Vendor" report column + filter dimension.
   *  Optional so pure fixtures can omit it; the service always includes it (null when unassigned). */
  vendor?: { name: string | null } | null;
  /** The outlet-master status (SiteStatus — today ACTIVE | INACTIVE; SUSPENDED handled defensively
   *  for the future). Drives the "Outlet Status" column. Optional so pure fixtures can omit it (then
   *  the cell reads a neutral "Unknown"); the service loads it as a Site scalar. */
  status?: string | null;
  /** All recces for the outlet (1 app + N manual). Each becomes one report row. */
  recces: RepRecce[];
}

// ── Small pure formatters ─────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Deterministic IST date-time ("DD-MM-YYYY HH:mm"), or "" when absent/invalid. */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`;
}

/**
 * Format a stored ReccePosm `dimensions` JSON ({width,height,unit}) as "{w} × {h} {unit}". Returns
 * 'NA' when dimensions are absent / malformed / branding-not-required (no numeric width+height).
 */
export function dimsLabel(dims: unknown): string {
  if (dims && typeof dims === 'object' && !Array.isArray(dims)) {
    const d = dims as Record<string, unknown>;
    const w = num(d.width);
    const h = num(d.height);
    if (w != null && h != null) {
      const unit = typeof d.unit === 'string' && d.unit.trim() ? d.unit.trim() : '';
      return unit ? `${w} × ${h} ${unit}` : `${w} × ${h}`;
    }
  }
  return 'NA';
}

/** Read {key, lat?, lng?} out of a stored MediaValue (bare key string OR {key, geo}), defensively. */
export function readPhoto(photo: unknown): { key: string; lat?: number; lng?: number } {
  if (typeof photo === 'string') return { key: photo };
  if (photo && typeof photo === 'object') {
    const key = (photo as { key?: unknown }).key;
    const out: { key: string; lat?: number; lng?: number } = {
      key: typeof key === 'string' ? key : '',
    };
    const geo = (photo as { geo?: unknown }).geo;
    if (geo && typeof geo === 'object') {
      const lat = num((geo as { lat?: unknown }).lat);
      const lng = num((geo as { lng?: unknown }).lng);
      if (lat != null) out.lat = lat;
      if (lng != null) out.lng = lng;
    }
    return out;
  }
  return { key: '' };
}

// ── Cell constructors ───────────────────────────────────────────────────────────────────────

const text = (v: string | null | undefined): Cell => ({ t: 'text', v: v ?? '' });
const empty = (): Cell => ({ t: 'empty' });

/**
 * A `photo` cell (auth-gated view path, same shape the approval/analytics services build), or
 * `empty` when there is no stored key. The geotag (lat/lng) rides along when the photo carried one.
 * `markup` (RECCE photos only) is attached ONLY when present, so an install / un-annotated photo
 * cell stays byte-identical to before (no `markup` key) — the FE then draws no box over it.
 */
function photoCell(photo: unknown, markup?: unknown): Cell {
  const { key, lat, lng } = readPhoto(photo);
  if (!key) return empty();
  const cell: Cell = {
    t: 'photo',
    key,
    viewPath: `/v1/media/view?key=${encodeURIComponent(key)}`,
  };
  if (lat != null) cell.lat = lat;
  if (lng != null) cell.lng = lng;
  if (markup != null) cell.markup = markup;
  return cell;
}

/**
 * The outlet-master status chip (Site.status). ACTIVE → green "Active"; INACTIVE → neutral
 * "Inactive"; SUSPENDED → red "Suspended" (a future SiteStatus value, mapped defensively — today
 * the schema only has ACTIVE/INACTIVE). An absent/unknown status → neutral "Unknown" (never a crash).
 */
export function outletStatusCell(status: string | null | undefined): Cell {
  switch (status) {
    case 'ACTIVE':
      return { t: 'status', v: 'Active', tone: 'approved' };
    case 'INACTIVE':
      return { t: 'status', v: 'Inactive', tone: 'neutral' };
    case 'SUSPENDED':
      return { t: 'status', v: 'Suspended', tone: 'rejected' };
    default:
      return { t: 'status', v: status && status.trim() ? status.trim() : 'Unknown', tone: 'neutral' };
  }
}

/**
 * The outlet's execution-pipeline position for the row's OWN recce, as a one-glance rollup chip —
 * the FURTHEST stage reached along:
 *   Not started → Recce submitted → ASM approved → HO approved → Installed → Audited
 * A recce that was REJECTED and went no further reads "Recce rejected"; an installation the auditor
 * rejected AND HO upheld reads the terminal "Install rejected".
 *
 * ⚠️ INTERPRETATION: the owner specified "activity status" only loosely; this reads it as the furthest
 * pipeline milestone. Labels are kept clean + literal so the ladder is trivial to re-order/re-label.
 * Install state is read from the recce's own `installation` (loaded in BOTH modes — a lean
 * status/hoReviewStatus select on the recce report, the full relation in installed mode), so an
 * installed/audited outlet rolls up correctly even on the recce report.
 */
export function activityStatusCell(recce: RepRecce | null): Cell {
  if (!recce) return { t: 'status', v: 'Not started', tone: 'neutral' };
  const inst = recce.installation ?? null;
  if (inst) {
    // "Audited" once the install is audit-approved OR HO-overruled to approved.
    if (inst.status === 'AUDIT_APPROVED' || inst.hoReviewStatus === 'APPROVED')
      return { t: 'status', v: 'Audited', tone: 'approved' };
    // Terminal fail — the auditor rejected AND HO upheld the rejection. A distinct rung so the recce
    // report (where this is the ONLY install signal in the row) can't read a dead install as in-flight.
    if (inst.status === 'AUDIT_REJECTED' && inst.hoReviewStatus === 'REJECTED')
      return { t: 'status', v: 'Install rejected', tone: 'rejected' };
    // Otherwise the install exists but isn't signed off yet (SUBMITTED / audit-rejected-pending-HO).
    return { t: 'status', v: 'Installed', tone: 'pending' };
  }
  // No installation yet — the recce stage it has reached.
  if (recce.status === 'REJECTED') return { t: 'status', v: 'Recce rejected', tone: 'rejected' };
  if (recce.hoReviewStatus === 'APPROVED') return { t: 'status', v: 'HO approved', tone: 'approved' };
  if (recce.status === 'APPROVED') return { t: 'status', v: 'ASM approved', tone: 'pending' };
  return { t: 'status', v: 'Recce submitted', tone: 'pending' };
}

/**
 * Per-element recce approval chip for a PRESENT element; `empty` when the slot has no element.
 * Recce approval is PER-RECCE (not per-element) today, so Element 1 & 2 always read the same chip
 * — they only diverge on the future installed report. This mirrors {@link recceStatusCell}'s
 * status+hoReviewStatus nuance so an ASM-approved-but-HO-pending recce reads amber "ASM approved"
 * here too, instead of a premature green "Approved" while the overall status still says "ASM approved".
 */
function elementStatusCell(recce: RepRecce | null, present: boolean): Cell {
  if (!recce || !present) return empty();
  if (recce.status === 'REJECTED') return { t: 'status', v: 'Rejected', tone: 'rejected' };
  if (recce.status === 'APPROVED' && recce.hoReviewStatus === 'APPROVED')
    return { t: 'status', v: 'Approved', tone: 'approved' }; // HO sign-off — terminal good
  if (recce.status === 'APPROVED') return { t: 'status', v: 'ASM approved', tone: 'pending' }; // awaiting HO
  return { t: 'status', v: 'Submitted', tone: 'pending' }; // SUBMITTED
}

/**
 * The overall recce-lifecycle chip. Neutral "Not started" when the outlet has no recce; otherwise
 * Rejected → "HO approved" (terminal good) → "ASM approved" (mid-pipeline, awaiting HO) → "Submitted".
 * A MANUAL recce (no ASM stage) reads "HO approved" once HO signs off, "Submitted" before that.
 */
export function recceStatusCell(recce: RepRecce | null): Cell {
  if (!recce) return { t: 'status', v: 'Not started', tone: 'neutral' };
  if (recce.status === 'REJECTED') return { t: 'status', v: 'Rejected', tone: 'rejected' };
  if (recce.hoReviewStatus === 'APPROVED') return { t: 'status', v: 'HO approved', tone: 'approved' };
  if (recce.status === 'APPROVED') return { t: 'status', v: 'ASM approved', tone: 'pending' };
  return { t: 'status', v: 'Submitted', tone: 'pending' }; // SUBMITTED, HO not yet approved
}

/**
 * Per-element INSTALL status chip (installed mode). "Installed" (green) when the element has an
 * install photo; "Not installed" (amber) when the recce element exists but has no install yet;
 * `empty` when the slot has no recce element at all.
 */
export function elementInstallStatusCell(elementPresent: boolean, installed: boolean): Cell {
  if (!elementPresent) return { t: 'empty' };
  return installed
    ? { t: 'status', v: 'Installed', tone: 'approved' }
    : { t: 'status', v: 'Not installed', tone: 'pending' };
}

/**
 * The installation audit chip (installed mode): AUDIT_REJECTED → red "Audit rejected",
 * AUDIT_APPROVED → green "Audited", else (SUBMITTED) → amber "Submitted". `empty` with no installation.
 */
export function installAuditStatusCell(inst: RepInstallation | null | undefined): Cell {
  if (!inst) return { t: 'empty' };
  if (inst.status === 'AUDIT_REJECTED') return { t: 'status', v: 'Audit rejected', tone: 'rejected' };
  if (inst.status === 'AUDIT_APPROVED') return { t: 'status', v: 'Audited', tone: 'approved' };
  return { t: 'status', v: 'Submitted', tone: 'pending' };
}

/**
 * The install HO-override chip (installed mode) — the SECOND, independent axis next to
 * {@link installAuditStatusCell}. `hoReviewStatus` is orthogonal to `status`: an auditor-rejected
 * install that HO overrules keeps `status = AUDIT_REJECTED` (so `auditStatus` still reads red "Audit
 * rejected") while THIS reads green "HO approved" — the two columns read side by side, honouring the
 * schema contract that Audit Status and HO Approval Status are shown independently.
 *   APPROVED → green "HO approved"; PENDING → amber "HO review pending"; REJECTED → red "HO rejected";
 *   NONE / not escalated → neutral "Not escalated"; no installation → empty.
 */
export function installHoStatusCell(inst: RepInstallation | null | undefined): Cell {
  if (!inst) return { t: 'empty' };
  switch (inst.hoReviewStatus) {
    case 'APPROVED':
      return { t: 'status', v: 'HO approved', tone: 'approved' };
    case 'PENDING':
      return { t: 'status', v: 'HO review pending', tone: 'pending' };
    case 'REJECTED':
      return { t: 'status', v: 'HO rejected', tone: 'rejected' };
    default: // NONE / undefined — not escalated to HO
      return { t: 'status', v: 'Not escalated', tone: 'neutral' };
  }
}

/** A reviewer's display name — `name` preferred, promoterCode as fallback, "" when neither. */
export function reviewerLabel(
  r: { name?: string | null; promoterCode?: string | null } | null | undefined,
): string {
  if (!r) return '';
  return (r.name ?? '').trim() || (r.promoterCode ?? '').trim() || '';
}

/**
 * The before↔after geo summary: "<distance> m" + the geo-fence verdict ("Geo-fence pass"/"fail"),
 * joined with " · ". "" when the install posm is absent or carries neither datum (a null geoFenceOk
 * means unverifiable, so no verdict is shown).
 */
export function beforeAfterGeoLabel(ip: RepInstallPosm | null | undefined): string {
  if (!ip) return '';
  const parts: string[] = [];
  const d = num(ip.distanceFromRecce);
  // Round to 1 dp (like the lat/lng displays) so a raw Decimal/float never renders as e.g. "3.19999 m".
  if (d != null) parts.push(`${d.toFixed(1)} m`);
  if (ip.geoFenceOk === true) parts.push('Geo-fence pass');
  else if (ip.geoFenceOk === false) parts.push('Geo-fence fail');
  return parts.join(' · ');
}

/**
 * A browser-supplied origin is trusted for building an xlsx hyperlink only when it is a plausible
 * bare `http(s)://host[:port]` — scheme + authority, no path / query / fragment / whitespace. This
 * is NOT an allow-list (the backend can't know the public origin — it sits behind the Next proxy),
 * just a sanity guard so a malformed / injected value never lands in a cell's link target.
 */
export function isPlausibleOrigin(origin: unknown): origin is string {
  if (typeof origin !== 'string') return false;
  // scheme + authority, with at most a single trailing slash (normalised away by the caller). No
  // path segment, query or fragment — those mark a crafted value, not a browser's own origin.
  return /^https?:\/\/[^/\s?#]+\/?$/.test(origin.trim());
}

/**
 * Build the .xlsx photo hyperlink target. Excel cannot resolve a relative URL, so when the FE passes
 * its own `origin` (validated by {@link isPlausibleOrigin}) this returns an ABSOLUTE link on the
 * public app origin and the `/api` surface — `<origin>/api/media/view?key=…` — which a user already
 * logged in to that app, in the same browser, can click straight from Excel: the request is same-
 * origin so the session cookie rides along, and the `/api`→`/v1` proxy injects the bearer. The
 * `/v1`→`/api` remap mirrors the FE's `reportMediaSrc`. With no / an invalid origin it DEGRADES to
 * the original relative `viewPath` (not clickable from Excel, but never a crash or a bad absolute URL).
 */
export function mediaHyperlinkTarget(viewPath: string, origin: unknown): string {
  const p = (viewPath ?? '').trim();
  if (!isPlausibleOrigin(origin)) return viewPath;
  const base = origin.trim().replace(/\/+$/, '');
  let rel: string;
  if (p.startsWith('/api/')) rel = p;
  else if (p.startsWith('/v1/')) rel = `/api/${p.slice('/v1/'.length)}`;
  else if (p.startsWith('/')) rel = `/api${p}`;
  else rel = `/api/${p}`;
  return `${base}${rel}`;
}

/** "App" / "Manual" for the row's recce source; "" for a no-recce row. */
export function sourceLabel(recce: RepRecce | null): string {
  if (!recce) return '';
  return recce.recceMode === 'MANUAL' ? 'Manual' : 'App';
}

/** "<rsCode> — <rsName>" (code preferred, name appended when present); either alone, or "". */
export function rsLabel(rsCode: string | null, rsName: string | null): string {
  const code = rsCode?.trim() ?? '';
  const name = rsName?.trim() ?? '';
  if (code && name) return `${code} — ${name}`;
  return code || name;
}

// ── The row builder ─────────────────────────────────────────────────────────────────────────

/**
 * Deterministic row order within an outlet: the APP recce first (so an app-only outlet renders the
 * exact same single row as before), then MANUAL recces oldest-first by `receivedAt` (server time,
 * always present), with `id` as the final tiebreaker so paging can never skip or duplicate a row.
 */
function recceSortKey(r: RepRecce): [number, number, string] {
  const modeRank = r.recceMode === 'MANUAL' ? 1 : 0; // APP before MANUAL
  const t = r.receivedAt ? new Date(r.receivedAt).getTime() : 0;
  return [modeRank, Number.isFinite(t) ? t : 0, r.id];
}

/**
 * Build ALL report rows for a loaded Site — one row per recce (see the file header for the grain).
 *
 * `recce` mode (default): an outlet with no recce still yields one row (unchanged behaviour).
 * `installed` mode: ONE ROW PER RECCE THAT HAS AN INSTALLATION — recces without an installation are
 * filtered out, so an outlet with no installed recce yields zero rows.
 *
 * Rows are ordered by {@link recceSortKey}.
 */
export function buildOutletExecutionRows(site: RepSite, mode: ReportMode = 'recce'): ReportRow[] {
  let recces = [...site.recces].sort((a, b) => {
    const [am, at, ai] = recceSortKey(a);
    const [bm, bt, bi] = recceSortKey(b);
    if (am !== bm) return am - bm;
    if (at !== bt) return at - bt;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  if (mode === 'installed') {
    recces = recces.filter((r) => !!r.installation);
    return recces.map((r) => buildRecceRow(site, r, mode));
  }
  if (recces.length === 0) return [buildRecceRow(site, null, mode)];
  return recces.map((r) => buildRecceRow(site, r, mode));
}

/**
 * Build one report row for a single recce of a site (or `null` for a no-recce outlet). Every
 * per-recce cell reflects the row's OWN recce — never a sibling's. Element 1/2 map to recce POSM
 * slots 1/2. In `installed` mode the row additionally carries the `install` group cells + the
 * excel-only install audit trail; in `recce` mode the cells are exactly as before (no install keys).
 */
export function buildRecceRow(site: RepSite, recce: RepRecce | null, mode: ReportMode = 'recce'): ReportRow {
  // Recce POSMs indexed by slot (1 / 2).
  const bySlot = new Map<number, RepReccePosm & { id: string }>();
  for (const p of recce?.posms ?? []) bySlot.set(p.slotNo, p);

  const recceDate = recce ? fmtDateTime(recce.capturedAt ?? recce.receivedAt) : '';
  // ASM audit: the approver relation is set ONLY on ASM approve (reject stamps reviewedAt but no
  // approvedById), so its presence gates the "ASM Approved By/On" pair — blank for rejects + manual.
  const asmApproved = !!recce?.approvedBy;
  // HO audit: the HO reviewer relation is set on BOTH approve and reject, so gate the "HO Approved
  // By/On" pair on an APPROVED outcome specifically.
  const hoApproved = recce?.hoReviewStatus === 'APPROVED';

  const cells: Record<string, Cell> = {
    outletCode: text(site.code),
    outletName: text(site.name),
    outletStatus: outletStatusCell(site.status),
    town: text(site.town),
    state: text(site.state),
    rs: text(rsLabel(site.rsCode, site.rsName)),
    vendor: text(site.vendor?.name),
    outletType: text(site.channel),
    source: recce ? text(sourceLabel(recce)) : empty(),
    recceDate: recce ? text(recceDate) : empty(),
    promoter: recce ? text(recce.submittedBy?.promoterCode) : empty(),
    recceStatus: recceStatusCell(recce),
    // The execution-pipeline rollup (both modes). Reads the recce's own installation (lean-loaded on
    // the recce report), so an installed/audited outlet rolls up past the recce stages here too.
    activityStatus: activityStatusCell(recce),
    // Audit trail (excel-only).
    capturedOn: recce ? text(recceDate) : empty(),
    asmApprovedBy: asmApproved ? text(recce!.approvedBy?.name) : empty(),
    asmApprovedOn: asmApproved ? text(fmtDateTime(recce!.reviewedAt)) : empty(),
    hoApprovedBy: hoApproved ? text(recce!.hoReviewedBy?.name) : empty(),
    hoApprovedOn: hoApproved ? text(fmtDateTime(recce!.hoReviewedAt)) : empty(),
  };

  // Per-element (slot 1 / slot 2) cells.
  for (const slot of [1, 2]) {
    const rp = bySlot.get(slot) ?? null;
    const present = rp !== null;
    const k = `el${slot}`;
    cells[`${k}Type`] = present ? text(rp!.posmType?.name) : empty();
    cells[`${k}Dims`] = present ? text(dimsLabel(rp!.dimensions)) : empty();
    cells[`${k}RecceStatus`] = elementStatusCell(recce, present);
    // RECCE photo carries its markup so the FE draws the element-placement box over it.
    cells[`${k}Photo`] = present ? photoCell(rp!.photo, rp!.markup) : empty();
  }

  // Installed-variant cells — the `install` group + the excel-only install audit trail. Only added in
  // installed mode so a recce-mode row is byte-identical to before.
  if (mode === 'installed') {
    const inst = recce?.installation ?? null;
    for (const slot of [1, 2]) {
      const rp = bySlot.get(slot) ?? null;
      const ip = rp?.installPosm ?? null;
      const k = `el${slot}`;
      cells[`${k}InstallStatus`] = elementInstallStatusCell(rp !== null, ip != null);
      cells[`${k}InstallPhoto`] = ip ? photoCell(ip.photo) : empty();
    }
    // The representative install posm for the before↔after geo summary: the lowest-slot one present.
    const repIp = bySlot.get(1)?.installPosm ?? bySlot.get(2)?.installPosm ?? null;
    cells.installDate = inst ? text(fmtDateTime(inst.capturedAt ?? inst.receivedAt ?? null)) : empty();
    cells.installer = inst ? text(inst.submittedBy?.promoterCode) : empty();
    cells.auditStatus = installAuditStatusCell(inst);
    // HO override axis — independent of the auditor verdict above (see installHoStatusCell).
    cells.installHoStatus = installHoStatusCell(inst);
    cells.beforeAfterGeo = text(beforeAfterGeoLabel(repIp));
    // Excel-only install audit trail: the auditor relation is set on BOTH approve and reject, so gate
    // the pair on a terminal audit outcome (not still-SUBMITTED).
    const installAudited =
      !!inst?.auditedBy && (inst.status === 'AUDIT_APPROVED' || inst.status === 'AUDIT_REJECTED');
    cells.installAuditedBy = installAudited ? text(inst!.auditedBy?.name) : empty();
    cells.installAuditedOn = installAudited ? text(fmtDateTime(inst!.auditedAt ?? null)) : empty();
    // Excel-only HO-override audit trail: the HO reviewer relation is set on BOTH approve and reject,
    // so gate the pair on a terminal HO outcome (APPROVED / REJECTED), blank for PENDING / NONE.
    const installHoReviewed =
      inst?.hoReviewStatus === 'APPROVED' || inst?.hoReviewStatus === 'REJECTED';
    cells.installHoReviewedBy = installHoReviewed ? text(reviewerLabel(inst!.hoReviewedBy)) : empty();
    cells.installHoReviewedOn = installHoReviewed ? text(fmtDateTime(inst!.hoReviewedAt ?? null)) : empty();
  }

  return {
    id: recce ? recce.id : `site-${site.id}`,
    outletCode: site.code,
    outletName: site.name,
    cells,
  };
}
