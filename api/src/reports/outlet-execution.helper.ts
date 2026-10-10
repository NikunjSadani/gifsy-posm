/**
 * outlet-execution.helper.ts — the PURE column contract + row builder for the Outlet Execution
 * Report (owner spec, 2026-09-30; Manual-Recce Wave B rework 2026-10-09). No Nest/Prisma imports
 * so it is trivially unit-testable; the service loads the Sites with the right includes and hands
 * each one here. Column ORDER is the insertion order of the returned object (jsonToSheetSafe
 * derives the header row from the first row's keys), so it matches the owner's column list exactly.
 *
 * ROW GRAIN (Wave B): ONE ROW PER RECCE, not per outlet. An outlet can now carry one APP recce AND
 * unlimited MANUAL recces (manual recces skip ASM and go straight to HO). So:
 *   - an app-only outlet (1 app recce)            → 1 row (unchanged from the pre-Wave-B report);
 *   - an outlet with 1 app + N manual recces      → 1 + N rows (outlet-identity columns repeat;
 *                                                     each row's element + status columns are THAT
 *                                                     recce's own facts, never recces[0]'s);
 *   - an outlet with NO recce yet                 → still 1 "Not started" row.
 * A new "Recce Mode" column (App / Manual; blank for a no-recce row) classifies each row. Every
 * per-recce column — recce status, ASM/HO approval, installation facts, rejection reasons — reflects
 * the row's OWN recce and its OWN installation (via Recce.installation), so a multi-recce outlet is
 * represented faithfully rather than collapsed onto the first recce.
 *
 * See docs/plans/OUTLET-EXECUTION-REPORT-PLAN.md + MANUAL-RECCE-BUILD-PLAN.md §7 for the column →
 * source map and the modelling decisions (per-element time/status is at the recce/installation
 * level; HO status is orthogonal to Audit status; Direct Installation is a separate dormant flag).
 */

// ── Minimal source shapes (a subset of the Prisma includes the service passes) ────────────────

export interface RepPosmType { name: string | null }
export interface RepReccePosm {
  slotNo: number;
  posmType: RepPosmType | null;
  photo: unknown; // MediaValue { key, geo? }
}
export interface RepInstallPosm {
  reccePosmId: string;
  captureLat: unknown; // Prisma.Decimal | null (Number()-able)
  captureLng: unknown;
  distanceFromRecce: unknown;
}
export interface RepUser { name: string | null; promoterCode: string | null }
export interface RepInstallation {
  status: string;
  hoReviewStatus: string;
  isDirect: boolean;
  capturedAt: Date | string | null;
  submittedBy: RepUser | null;
  posms: RepInstallPosm[];
}
export interface RepRecce {
  id: string;
  /** APP = the one in-app recce; MANUAL = a field-typed recce (skips ASM → HO). Drives "Recce Mode". */
  recceMode: string;
  status: string;
  // Rejection reasons carried for the report: `rejectionReason*` is the ASM's verdict, the
  // `ho*` fields are the recce-side HO-approval stage (ASM approve → PENDING → HO approve/reject).
  rejectionReasonCode: string | null;
  rejectionReason: string | null;
  hoReviewStatus: string;
  hoRejectionReasonCode: string | null;
  hoRejectionReason: string | null;
  capturedAt: Date | string | null;
  receivedAt: Date | string | null;
  captureLat: unknown;
  captureLng: unknown;
  submittedBy: RepUser | null;
  posms: (RepReccePosm & { id: string })[];
  /** This recce's own installation (0-or-1 via Installation.recceId @unique), or null. */
  installation: RepInstallation | null;
}
export interface RepSite {
  code: string;
  name: string;
  lat: unknown;
  lng: unknown;
  region: string | null;
  state: string | null;
  cluster: string | null;
  town: string | null;
  rsCode: string | null;
  beatName: string | null;
  channel: string | null;
  address: string | null;
  vendor: { name: string | null } | null;
  /** All recces for the outlet (1 app + N manual). Each becomes one report row. */
  recces: RepRecce[];
}

/** The ordered column headers (exactly the owner's spec), reused for the xlsx and the UI. */
export const OUTLET_REPORT_COLUMNS = [
  'Vendor Name',
  'Recce Promoter ID',
  'Install Promoter ID',
  'Region',
  'State',
  'Cluster',
  'Town',
  'RS Code',
  'Beat Name',
  'Outlet Code',
  'Outlet Name',
  'Channel',
  'Address',
  'Lat Long',
  'Direct Installation',
  'Recce Mode',
  'Element 1',
  'Element 1 Recce Status',
  'Element 1 Recce Time and Date',
  'Element 1 Recce Location',
  'Element 1 Installation Status',
  'Element 1 Installation Time and Date',
  'Element 1 Installation Location',
  'Element 1 Recce and Installation distance',
  'Element 2',
  'Element 2 Recce Status',
  'Element 2 Recce Time and Date',
  'Element 2 Recce Location',
  'Element 2 Installation Status',
  'Element 2 Installation Time and Date',
  'Element 2 Installation Location',
  'Element 2 Recce and Installation distance',
  'Outlet Recce Status',
  'ASM Approval Status',
  'HO Approval Status',
  'HO Recce Approval',
  'ASM Rejection Reason',
  'HO Rejection Reason',
  'Installation Status',
  'Audit Status',
] as const;

// ── Small pure formatters ─────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "lat, lng" to 5dp, or "" when either coordinate is missing. */
export function latLng(lat: unknown, lng: unknown): string {
  const a = num(lat);
  const b = num(lng);
  if (a == null || b == null) return '';
  return `${a.toFixed(5)}, ${b.toFixed(5)}`;
}

/** Read the {lat,lng} out of a stored MediaValue photo JSON, defensively. */
export function photoLatLng(photo: unknown): string {
  if (photo && typeof photo === 'object') {
    const geo = (photo as { geo?: unknown }).geo;
    if (geo && typeof geo === 'object') {
      return latLng((geo as { lat?: unknown }).lat, (geo as { lng?: unknown }).lng);
    }
  }
  return '';
}

/** Deterministic IST date-time ("DD-MM-YYYY HH:mm"), or "" when absent. */
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

/** Distance in metres → "12 m" / "1.4 km", or "" when unknown. */
export function distanceLabel(v: unknown): string {
  const m = num(v);
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

const RECCE_STATUS: Record<string, string> = {
  SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected',
};
/** Outlet recce status ("Not started" when the outlet has no recce yet). */
export function recceStatusLabel(recce: RepRecce | null): string {
  if (!recce) return 'Not started';
  return RECCE_STATUS[recce.status] ?? recce.status;
}
/** ASM decision on the recce (Approved / Rejected / Pending), "" when no recce. */
export function asmApprovalLabel(recce: RepRecce | null): string {
  if (!recce) return '';
  // A MANUAL recce skips ASM entirely (field → HO), so there is NO ASM decision. Showing
  // "Pending"/"Approved" here would read as an ASM stage that never happened (UI/UX audit F3).
  if (recce.recceMode === 'MANUAL') return 'N/A';
  if (recce.status === 'APPROVED') return 'Approved';
  if (recce.status === 'REJECTED') return 'Rejected';
  return 'Pending';
}
/** HO escalation outcome, "" when there is no installation to escalate. */
export function hoApprovalLabel(install: RepInstallation | null): string {
  if (!install) return '';
  switch (install.hoReviewStatus) {
    case 'PENDING': return 'Pending';
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    default: return 'N/A'; // NONE — never escalated (auditor approved or not yet audited)
  }
}
/** HO verdict on the RECCE (the recce-side HO-approval stage), "" when the outlet has no recce. */
export function hoRecceApprovalLabel(recce: RepRecce | null): string {
  if (!recce) return '';
  switch (recce.hoReviewStatus) {
    case 'PENDING': return 'Pending';
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    default: return 'N/A'; // NONE — ASM has not approved into HO review yet
  }
}

/**
 * Human labels for the RejectReasonCode vocabulary. Mirrors the FE REJECT_REASON_LABELS
 * (platform/src/lib/review/api.ts) — kept as a local copy so the backend helper stays FE-free
 * (no cross-layer import); keep the two in step if the vocabulary changes.
 */
const REJECT_REASON_LABELS: Record<string, string> = {
  BLURRY: 'Blurry / unclear photo',
  WRONG_SITE: 'Wrong site',
  POSM_NOT_VISIBLE: 'Element not visible',
  GEO_MISMATCH: 'Location mismatch',
  DUPLICATE_PHOTO: 'Duplicate photo',
  WRONG_POSM: 'Wrong Element',
  DIMENSIONS_MISMATCH: 'Dimensions mismatch',
  OTHER: 'Other',
};

/** "<reason label> — <free text>" from a reject code + optional note; "" when neither is present. */
function rejectReasonText(code: string | null, note: string | null): string {
  const label = code ? (REJECT_REASON_LABELS[code] ?? code) : '';
  const text = note?.trim() ?? '';
  if (label && text) return `${label} — ${text}`;
  return label || text;
}
/**
 * The ASM's rejection reason on the recce — only when the recce is ASM-rejected, i.e. status
 * REJECTED while HO has NOT rejected it (an HO rejection also sets status REJECTED). "" otherwise.
 */
export function asmRejectionReasonLabel(recce: RepRecce | null): string {
  if (!recce) return '';
  if (recce.status !== 'REJECTED' || recce.hoReviewStatus === 'REJECTED') return '';
  return rejectReasonText(recce.rejectionReasonCode, recce.rejectionReason);
}
/** The HO's rejection reason on the recce — only when HO-rejected (hoReviewStatus REJECTED); "" otherwise. */
export function hoRejectionReasonLabel(recce: RepRecce | null): string {
  if (!recce) return '';
  if (recce.hoReviewStatus !== 'REJECTED') return '';
  return rejectReasonText(recce.hoRejectionReasonCode, recce.hoRejectionReason);
}
/** "App" / "Manual" for the row's recce; "" for a no-recce row. Derived from recce.recceMode. */
export function recceModeLabel(recce: RepRecce | null): string {
  if (!recce) return '';
  return recce.recceMode === 'MANUAL' ? 'Manual' : 'App';
}
/** Auditor verdict on the installation, "" when not installed. */
export function auditStatusLabel(install: RepInstallation | null): string {
  if (!install) return '';
  switch (install.status) {
    case 'AUDIT_APPROVED': return 'Approved';
    case 'AUDIT_REJECTED': return 'Rejected';
    default: return 'Pending audit'; // SUBMITTED
  }
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
 * An outlet with no recce still yields one "Not started" row. Rows are ordered by {@link recceSortKey}.
 */
export function buildOutletExecutionRows(site: RepSite): Record<string, string>[] {
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
 * Build one report row (ordered per OUTLET_REPORT_COLUMNS) for a single recce of a site (or `null`
 * for a no-recce outlet). The installation is THIS recce's own (Recce.installation), so every
 * per-recce column reflects the row's own recce — never a sibling's. Element 1/2 map to recce POSM
 * slots 1/2; per-element installation facts come from the matching InstallPosm.
 */
export function buildRecceRow(site: RepSite, recce: RepRecce | null): Record<string, string> {
  const install = recce?.installation ?? null;

  // Recce POSMs indexed by slot; InstallPosms indexed by the reccePosm they fulfil.
  const bySlot = new Map<number, RepReccePosm & { id: string }>();
  for (const p of recce?.posms ?? []) bySlot.set(p.slotNo, p);
  const installByRecce = new Map<string, RepInstallPosm>();
  for (const ip of install?.posms ?? []) installByRecce.set(ip.reccePosmId, ip);

  const row: Record<string, string> = {
    'Vendor Name': site.vendor?.name ?? '',
    'Recce Promoter ID': recce?.submittedBy?.promoterCode ?? '',
    'Install Promoter ID': install?.submittedBy?.promoterCode ?? '',
    'Region': site.region ?? '',
    'State': site.state ?? '',
    'Cluster': site.cluster ?? '',
    'Town': site.town ?? '',
    'RS Code': site.rsCode ?? '',
    'Beat Name': site.beatName ?? '',
    'Outlet Code': site.code,
    'Outlet Name': site.name,
    'Channel': site.channel ?? '',
    'Address': site.address ?? '',
    'Lat Long': latLng(site.lat, site.lng),
    'Direct Installation': install ? (install.isDirect ? 'Yes' : 'No') : '',
    'Recce Mode': recceModeLabel(recce),
  };

  // Per-element (slot 1 and slot 2) columns.
  for (const slot of [1, 2]) {
    const rp = bySlot.get(slot) ?? null;
    const ip = rp ? installByRecce.get(rp.id) ?? null : null;
    const present = rp !== null;
    const p = `Element ${slot}`;
    row[p] = rp?.posmType?.name ?? '';
    row[`${p} Recce Status`] = present ? recceStatusLabel(recce) : '';
    row[`${p} Recce Time and Date`] = present ? fmtDateTime(recce?.capturedAt ?? recce?.receivedAt) : '';
    row[`${p} Recce Location`] = present ? (photoLatLng(rp?.photo) || latLng(recce?.captureLat, recce?.captureLng)) : '';
    row[`${p} Installation Status`] = ip ? 'Installed' : present ? 'Not installed' : '';
    row[`${p} Installation Time and Date`] = ip ? fmtDateTime(install?.capturedAt) : '';
    row[`${p} Installation Location`] = ip ? latLng(ip.captureLat, ip.captureLng) : '';
    row[`${p} Recce and Installation distance`] = ip ? distanceLabel(ip.distanceFromRecce) : '';
  }

  row['Outlet Recce Status'] = recceStatusLabel(recce);
  row['ASM Approval Status'] = asmApprovalLabel(recce);
  row['HO Approval Status'] = hoApprovalLabel(install);
  row['HO Recce Approval'] = hoRecceApprovalLabel(recce);
  row['ASM Rejection Reason'] = asmRejectionReasonLabel(recce);
  row['HO Rejection Reason'] = hoRejectionReasonLabel(recce);
  row['Installation Status'] = install ? 'Submitted' : recce ? 'Not installed' : '';
  row['Audit Status'] = auditStatusLabel(install);

  return row;
}
