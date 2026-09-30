/**
 * outlet-execution.helper.ts — the PURE column contract + row builder for the Outlet Execution
 * Report (owner spec, 2026-09-30). One report row per outlet (Site). No Nest/Prisma imports so it
 * is trivially unit-testable; the service loads the Sites with the right includes and hands each
 * one here. Column ORDER is the insertion order of the returned object (jsonToSheetSafe derives
 * the header row from the first row's keys), so it matches the owner's column list exactly.
 *
 * See docs/plans/OUTLET-EXECUTION-REPORT-PLAN.md for the column → source map and the modelling
 * decisions (per-element time/status is at the recce/installation level; HO status is orthogonal
 * to Audit status; Direct Installation is a forward-looking flag).
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
export interface RepRecce {
  status: string;
  capturedAt: Date | string | null;
  receivedAt: Date | string | null;
  captureLat: unknown;
  captureLng: unknown;
  submittedBy: RepUser | null;
  posms: (RepReccePosm & { id: string })[];
}
export interface RepInstallation {
  status: string;
  hoReviewStatus: string;
  isDirect: boolean;
  capturedAt: Date | string | null;
  submittedBy: RepUser | null;
  posms: RepInstallPosm[];
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
  recces: RepRecce[];
  installs: RepInstallation[];
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
 * Build one report row (ordered per OUTLET_REPORT_COLUMNS) for a loaded Site. `recces[0]` is the
 * one live recce (unique per site); `installs[0]` is its installation, if any. Element 1/2 map to
 * recce POSM slots 1/2; per-element installation facts come from the matching InstallPosm.
 */
export function buildOutletExecutionRow(site: RepSite): Record<string, string> {
  const recce = site.recces[0] ?? null;
  const install = site.installs[0] ?? null;

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
  row['Installation Status'] = install ? 'Submitted' : recce ? 'Not installed' : '';
  row['Audit Status'] = auditStatusLabel(install);

  return row;
}
