/* ─── Recce Report — display column grouping (pure, unit-tested) ────────────────────────────────
   Grouping is now SERVER-PROVIDED: every column carries a `group` (and whether it is `pinned`
   sticky-left, or `excelOnly` and thus export-only). This module turns the flat server column list
   into the on-screen grouped structure — groups rendered in a fixed canonical order, the order
   WITHIN each group preserved from the server, `excelOnly` columns dropped from the view, and the
   pinned identity columns flattened to the left. It no longer re-derives grouping from column-name
   heuristics; it simply honors the contract.
──────────────────────────────────────────────────────────────────────────────────────────────── */

import type { Column, ColumnGroup } from './outlet-execution';

/** Canonical left→right order of the column groups. */
export const GROUP_ORDER: ColumnGroup[] = [
  'outlet',
  'location',
  'profile',
  'element1',
  'element2',
  'install',
  'overall',
  'audit',
];

/** The header label shown for each group. */
export const GROUP_LABELS: Record<ColumnGroup, string> = {
  outlet: 'Outlet',
  location: 'Location',
  profile: 'Profile',
  element1: 'Element 1',
  element2: 'Element 2',
  install: 'Installation',
  overall: 'Overall',
  audit: 'Audit trail',
};

export interface OutletColumnGroup {
  group: ColumnGroup;
  label: string;
  /** True when every column in the group is pinned sticky-left (the identity group). */
  pinned: boolean;
  columns: Column[];
}

/** A column in flat left→right render order, tagged for the table header/body to iterate alike. */
export interface FlatColumn {
  column: Column;
  /** First column of a non-first group → draw a left group-divider. */
  groupStart: boolean;
  /** Index among the sticky-left pinned columns (0-based), or -1 when not pinned. */
  pinIndex: number;
}

/**
 * Build the on-screen display groups from the server column list.
 *   - `excelOnly` columns are omitted (they appear only in the .xlsx export).
 *   - Groups are emitted in GROUP_ORDER; the order WITHIN a group is the server's order.
 *   - Empty groups are dropped.
 *   - A column with an unknown/future `group` value still appears (its group is appended after the
 *     known ones), so nothing is ever silently dropped from the view.
 */
export function groupOutletColumns(columns: Column[]): OutletColumnGroup[] {
  const visible = columns.filter((c) => !c.excelOnly);

  const byGroup = new Map<ColumnGroup, Column[]>();
  for (const c of visible) {
    const list = byGroup.get(c.group);
    if (list) list.push(c);
    else byGroup.set(c.group, [c]);
  }

  const known = GROUP_ORDER.filter((g) => byGroup.has(g));
  const unknown = [...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g));

  return [...known, ...unknown].map((group) => {
    const cols = byGroup.get(group)!;
    return {
      group,
      label: GROUP_LABELS[group] ?? group,
      pinned: cols.length > 0 && cols.every((c) => c.pinned === true),
      columns: cols,
    };
  });
}

/**
 * Flatten the grouped structure to the left→right render order the table iterates. Pinned columns
 * (sticky-left) are those flagged `pinned` by the server; their 0-based index drives the cumulative
 * sticky `left` offset in the table.
 */
export function flatColumns(groups: OutletColumnGroup[]): FlatColumn[] {
  const pinnedKeys: string[] = [];
  for (const g of groups) for (const c of g.columns) if (c.pinned) pinnedKeys.push(c.key);

  const out: FlatColumn[] = [];
  groups.forEach((g, gi) => {
    g.columns.forEach((c, ci) => {
      out.push({
        column: c,
        groupStart: gi > 0 && ci === 0,
        pinIndex: pinnedKeys.indexOf(c.key),
      });
    });
  });
  return out;
}

/** The flat left→right display order of column keys (pinned first), from the grouped structure. */
export function displayOrder(groups: OutletColumnGroup[]): string[] {
  return groups.flatMap((g) => g.columns.map((c) => c.key));
}
