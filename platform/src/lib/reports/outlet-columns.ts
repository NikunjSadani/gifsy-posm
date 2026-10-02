/* ─── Outlet Execution Report — display column grouping (pure, unit-tested) ──────────────────────
   The backend returns a flat `columns: string[]` (the owner's 36-column spec order). For the
   on-screen table we want (a) the outlet identity pinned to the left so it stays visible while the
   30+ detail columns scroll, and (b) a grouped 2-row header (Outlet · Details · Element 1 ·
   Element 2 · Overall status) so the wide grid is scannable.

   This derives that structure FROM the backend's column list (rather than re-hardcoding all 36
   names) so it tracks the contract: element groups are matched by their "Element N" prefix, the
   identity + status groups by a small known key set, and everything else falls into "Details" in
   the backend's own order. A column the backend adds that matches none of the rules still appears
   (under Details), so nothing is ever silently dropped from the view.
──────────────────────────────────────────────────────────────────────────────────────────────── */

/** Columns pinned to the left edge, in display order (left → right). */
export const PINNED_KEYS = ['Outlet Code', 'Outlet Name'] as const;

/** The outlet-level rollup statuses, grouped at the far right. */
const STATUS_KEYS = [
  'Outlet Recce Status',
  'ASM Approval Status',
  'HO Approval Status',
  'Installation Status',
  'Audit Status',
];

export interface DisplayColumn {
  /** The row-object key (unchanged — used to read `row[key]`). */
  key: string;
  /** The header label shown under its group (prefix stripped / de-duplicated). */
  label: string;
}

export interface OutletColumnGroup {
  label: string;
  /** True for the frozen identity group (rendered sticky-left). */
  pinned: boolean;
  columns: DisplayColumn[];
}

/**
 * The header shown for a column UNDER its group — the group already carries the "Element 1 / 2"
 * context, so strip that prefix ("Element 1 Recce Status" → "Recce Status") and relabel the bare
 * element-name column ("Element 1" → "POSM type"). All other columns keep their name verbatim.
 */
export function subColumnLabel(key: string): string {
  if (key === 'Element 1' || key === 'Element 2') return 'POSM type';
  const m = /^Element [12] (.+)$/.exec(key);
  return m ? m[1] : key;
}

const isElement = (key: string, slot: 1 | 2) =>
  key === `Element ${slot}` || key.startsWith(`Element ${slot} `);

/**
 * Group the backend's flat column list into the display groups, preserving the backend order within
 * each group. Returns groups in render order: Outlet (pinned) · Details · Element 1 · Element 2 ·
 * Overall status. Empty groups are omitted. Every input column lands in exactly one group.
 */
export function groupOutletColumns(columns: string[]): OutletColumnGroup[] {
  const col = (key: string): DisplayColumn => ({ key, label: subColumnLabel(key) });

  const pinned = PINNED_KEYS.filter((k) => columns.includes(k)).map(col);
  const element1 = columns.filter((c) => isElement(c, 1)).map(col);
  const element2 = columns.filter((c) => isElement(c, 2)).map(col);
  const status = STATUS_KEYS.filter((k) => columns.includes(k)).map(col);

  const claimed = new Set<string>([
    ...PINNED_KEYS,
    ...columns.filter((c) => isElement(c, 1) || isElement(c, 2)),
    ...STATUS_KEYS,
  ]);
  const details = columns.filter((c) => !claimed.has(c)).map(col);

  const groups: OutletColumnGroup[] = [
    { label: 'Outlet', pinned: true, columns: pinned },
    { label: 'Details', pinned: false, columns: details },
    { label: 'Element 1', pinned: false, columns: element1 },
    { label: 'Element 2', pinned: false, columns: element2 },
    { label: 'Overall status', pinned: false, columns: status },
  ];
  return groups.filter((g) => g.columns.length > 0);
}

/** The flat left→right display order of column keys (pinned first), from the grouped structure. */
export function displayOrder(groups: OutletColumnGroup[]): string[] {
  return groups.flatMap((g) => g.columns.map((c) => c.key));
}
