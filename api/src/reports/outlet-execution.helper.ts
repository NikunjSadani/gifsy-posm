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

/** The display group a column belongs to (drives the FE's grouped header). */
export type ColumnGroup =
  | 'outlet'
  | 'location'
  | 'profile'
  | 'element1'
  | 'element2'
  | 'overall'
  | 'audit';

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
  | { t: 'photo'; key: string; viewPath: string; lat?: number; lng?: number }
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
  // Location.
  { key: 'town', label: 'Town', group: 'location' },
  { key: 'state', label: 'State', group: 'location' },
  { key: 'rs', label: 'RS', group: 'location' },
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
  // Overall.
  { key: 'recceStatus', label: 'Recce Status', group: 'overall' },
  // Audit trail — EXCEL ONLY (FE table skips these; the .xlsx includes them).
  { key: 'capturedOn', label: 'Captured On', group: 'audit', excelOnly: true },
  { key: 'asmApprovedBy', label: 'ASM Approved By', group: 'audit', excelOnly: true },
  { key: 'asmApprovedOn', label: 'ASM Approved On', group: 'audit', excelOnly: true },
  { key: 'hoApprovedBy', label: 'HO Approved By', group: 'audit', excelOnly: true },
  { key: 'hoApprovedOn', label: 'HO Approved On', group: 'audit', excelOnly: true },
];

// ── Minimal source shapes (a subset of the Prisma includes the service passes) ────────────────

export interface RepPosmType {
  name: string | null;
}
export interface RepReccePosm {
  slotNo: number;
  posmType: RepPosmType | null;
  dimensions: unknown; // {width,height,unit} entered by the rep
  photo: unknown; // MediaValue { key, geo? }
}
export interface RepRecce {
  id: string;
  /** APP = the one in-app recce; MANUAL = a field-typed recce (skips ASM → HO). Drives "Source". */
  recceMode: string;
  status: string;
  hoReviewStatus: string;
  capturedAt: Date | string | null;
  receivedAt: Date | string | null;
  // Approval audit stamps (for the excel-only audit group).
  reviewedAt: Date | string | null;
  hoReviewedAt: Date | string | null;
  submittedBy: { promoterCode: string | null } | null;
  approvedBy: { name: string | null } | null;
  hoReviewedBy: { name: string | null } | null;
  posms: (RepReccePosm & { id: string })[];
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

/** A `photo` cell (auth-gated view path, same shape the approval/analytics services build), or
 *  `empty` when there is no stored key. The geotag (lat/lng) rides along when the photo carried one. */
function photoCell(photo: unknown): Cell {
  const { key, lat, lng } = readPhoto(photo);
  if (!key) return empty();
  const cell: Cell = {
    t: 'photo',
    key,
    viewPath: `/v1/media/view?key=${encodeURIComponent(key)}`,
  };
  if (lat != null) cell.lat = lat;
  if (lng != null) cell.lng = lng;
  return cell;
}

/** Per-element recce approval chip for a PRESENT element; `empty` when the slot has no element. */
function elementStatusCell(recce: RepRecce | null, present: boolean): Cell {
  if (!recce || !present) return empty();
  if (recce.status === 'REJECTED') return { t: 'status', v: 'Rejected', tone: 'rejected' };
  if (recce.status === 'APPROVED') return { t: 'status', v: 'Approved', tone: 'approved' };
  return { t: 'status', v: 'Pending', tone: 'pending' }; // SUBMITTED
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
 * An outlet with no recce still yields one row. Rows are ordered by {@link recceSortKey}.
 */
export function buildOutletExecutionRows(site: RepSite): ReportRow[] {
  const recces = [...site.recces].sort((a, b) => {
    const [am, at, ai] = recceSortKey(a);
    const [bm, bt, bi] = recceSortKey(b);
    if (am !== bm) return am - bm;
    if (at !== bt) return at - bt;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  if (recces.length === 0) return [buildRecceRow(site, null)];
  return recces.map((r) => buildRecceRow(site, r));
}

/**
 * Build one report row for a single recce of a site (or `null` for a no-recce outlet). Every
 * per-recce cell reflects the row's OWN recce — never a sibling's. Element 1/2 map to recce POSM
 * slots 1/2.
 */
export function buildRecceRow(site: RepSite, recce: RepRecce | null): ReportRow {
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
    town: text(site.town),
    state: text(site.state),
    rs: text(rsLabel(site.rsCode, site.rsName)),
    outletType: text(site.channel),
    source: recce ? text(sourceLabel(recce)) : empty(),
    recceDate: recce ? text(recceDate) : empty(),
    promoter: recce ? text(recce.submittedBy?.promoterCode) : empty(),
    recceStatus: recceStatusCell(recce),
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
    cells[`${k}Photo`] = present ? photoCell(rp!.photo) : empty();
  }

  return {
    id: recce ? recce.id : `site-${site.id}`,
    outletCode: site.code,
    outletName: site.name,
    cells,
  };
}
