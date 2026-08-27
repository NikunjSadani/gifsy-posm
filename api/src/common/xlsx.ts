import * as XLSX from 'xlsx';

/**
 * Shared multi-sheet xlsx builder — used by any domain that streams an xlsx
 * download (reports, audience exports, …). The returned Buffer is handed to a
 * Nest `StreamableFile` by the controller (the global interceptor passes
 * StreamableFile through unwrapped).
 */
export interface XlsxSheet {
  /** Worksheet tab name. */
  name: string;
  /** Row objects — the header row is derived from the first object's keys. */
  rows: Record<string, unknown>[];
}

/**
 * Sentinel a cell value can take to render a REAL Excel hyperlink (SheetJS `.l`)
 * rather than plain text. The DISPLAY `text` is still formula-injection-guarded
 * (cellSafe); the `target` is written verbatim as the link URL. Used so a
 * downloaded .xlsx can have clickable "View image" media links (the target is a
 * PUBLIC tokenized view URL).
 */
export interface HyperlinkCell {
  __hyperlink: true;
  /** Shown, clickable text (cellSafe-escaped like any other string cell). */
  text: string;
  /** The link URL written into the SheetJS `l.Target`. */
  target: string;
}

/** Narrow an arbitrary cell value to the hyperlink sentinel. */
export function isHyperlinkCell(v: unknown): v is HyperlinkCell {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as { __hyperlink?: unknown }).__hyperlink === true &&
    typeof (v as HyperlinkCell).text === 'string' &&
    typeof (v as HyperlinkCell).target === 'string'
  );
}

/**
 * Neutralise spreadsheet formula injection at the serialisation boundary. A cell
 * value beginning with `= + - @` (or a leading tab/CR) is interpreted as a live
 * formula by Excel / Google Sheets — a user-supplied value like `=WEBSERVICE("…")`
 * or `=cmd()` would execute when someone opens the export. Prefixing with an
 * apostrophe forces text. Applied to EVERY string cell of EVERY export built here
 * so no single export column can ever be an injection sink. Idempotent: an
 * already-escaped `'=x` does not match and is left unchanged.
 */
export function cellSafe(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/**
 * Drop-in safe replacements for `XLSX.utils.json_to_sheet` / `aoa_to_sheet`.
 * Every export that builds its OWN workbook (i.e. NOT via `buildXlsx`) must use
 * these instead of the raw `XLSX.utils.*` so no export can be a formula-injection
 * sink. They cellSafe every string cell, then delegate. (Reading/parsing uploads is
 * unaffected — only WRITING needs sanitising.)
 */
export function jsonToSheetSafe(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  // Hyperlink cells cannot go through json_to_sheet as objects (they'd stringify to
  // "[object Object]"). We replace each with its cellSafe display text for the sheet
  // body, then record (dataRowIndex, header, target) so we can stamp the SheetJS
  // `.l` hyperlink onto the produced cell afterwards.
  const links: { r: number; header: string; target: string }[] = [];
  const safe = rows.map((row, ri) => {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(row)) {
      // cellSafe the KEY too: the object keys become the header row, and headers can be
      // user-supplied, so an unsanitised header like `=WEBSERVICE(...)` would be a live
      // formula. cellSafe is a no-op for normal headers (only formula-leading strings are
      // escaped), so existing headers are unchanged. Idempotent.
      const header = cellSafe(k);
      if (isHyperlinkCell(val)) {
        out[header] = cellSafe(val.text);
        links.push({ r: ri, header, target: val.target });
      } else {
        out[header] = typeof val === 'string' ? cellSafe(val) : val;
      }
    }
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(safe);
  if (links.length > 0) applyHyperlinks(ws, links);
  return ws;
}

/**
 * Stamp SheetJS hyperlinks onto the cells recorded during jsonToSheetSafe. The
 * header row (row 0) maps a header → column index; a data row `r` sits at sheet
 * row `r + 1`. The display value written by json_to_sheet is preserved; only the
 * `.l` link (Target + Tooltip) is added, so cellSafe's formula-guard on the text
 * still holds.
 */
function applyHyperlinks(
  ws: XLSX.WorkSheet,
  links: { r: number; header: string; target: string }[],
): void {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const headerToCol = new Map<string, number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })] as XLSX.CellObject | undefined;
    if (cell && cell.v != null) headerToCol.set(String(cell.v), c);
  }
  for (const { r, header, target } of links) {
    const c = headerToCol.get(header);
    if (c === undefined) continue;
    const addr = XLSX.utils.encode_cell({ r: r + 1, c });
    const cell = ws[addr] as XLSX.CellObject | undefined;
    if (cell) {
      cell.l = { Target: target, Tooltip: 'Open image' };
    } else {
      ws[addr] = { t: 's', v: '', l: { Target: target, Tooltip: 'Open image' } };
    }
  }
}

export function aoaToSheetSafe(rows: unknown[][]): XLSX.WorkSheet {
  const safe = rows.map((r) => r.map((c) => (typeof c === 'string' ? cellSafe(c) : c)));
  return XLSX.utils.aoa_to_sheet(safe);
}

/** Build a multi-sheet xlsx workbook and return it as a Buffer. */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = jsonToSheetSafe(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** @deprecated alias kept for the initial port; prefer XlsxSheet. */
export type ReportSheet = XlsxSheet;
