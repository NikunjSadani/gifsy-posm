/**
 * Recce photo MARKUP — the field executive's on-image annotation marking WHERE the POSM
 * installation is proposed. Stored per recce POSM (`ReccePosm.markup` JSON) and rendered as an
 * overlay for the ASM (recce review) and the Auditor (install before/after).
 *
 * Coordinates are NORMALISED to 0..1 relative to the image's CONTENT box (the drawn/rendered
 * picture, object-contain), so the same markup renders correctly at any display size and on the
 * stored original. Keep this module pure + framework-free so producer (capture) and consumers
 * (review/audit) share ONE contract — the backend `MarkupDto` mirrors this exact shape.
 */

export const MARKUP_VERSION = 1 as const;
/** Max annotation rectangles per photo (bounds the stored blob + keeps the overlay legible). */
export const MARKUP_MAX_SHAPES = 10;
/** A rect smaller than this (normalised) is a stray tap, not a deliberate mark — dropped. */
export const MARKUP_MIN_SIDE = 0.01;

/** One highlight rectangle, normalised 0..1 to the image content box. */
export interface MarkupRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The stored markup blob. `shapes` is 1..MARKUP_MAX_SHAPES rectangles. */
export interface RecceMarkup {
  version: typeof MARKUP_VERSION;
  shapes: MarkupRect[];
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Normalise a raw rect: clamp the origin to 0..1 and clamp the size so the rect never spills past
 * the image edge (x+w ≤ 1, y+h ≤ 1). A rect drawn in any drag direction should be pre-normalised
 * by the caller (positive w/h) before this.
 */
export function normalizeRect(r: MarkupRect): MarkupRect {
  const x = clamp01(r.x);
  const y = clamp01(r.y);
  const w = clamp01(r.w);
  const h = clamp01(r.h);
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

/**
 * Build a RecceMarkup from raw normalised rects: normalise + drop strays (< MARKUP_MIN_SIDE) +
 * cap to MARKUP_MAX_SHAPES. Returns null when nothing meaningful remains (so an un-annotated
 * photo stores no markup rather than an empty object).
 */
export function buildMarkup(rects: MarkupRect[]): RecceMarkup | null {
  const shapes = rects
    .map(normalizeRect)
    .filter((r) => r.w >= MARKUP_MIN_SIDE && r.h >= MARKUP_MIN_SIDE)
    .slice(0, MARKUP_MAX_SHAPES);
  return shapes.length ? { version: MARKUP_VERSION, shapes } : null;
}

/**
 * Parse an UNKNOWN stored value (from the API) into a RecceMarkup, or null when absent/invalid.
 * Defensive: tolerates legacy/garbage shapes, keeps only well-formed rects, clamps to 0..1, caps
 * the count. Used by the review/audit overlays.
 */
export function parseMarkup(v: unknown): RecceMarkup | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { version?: unknown; shapes?: unknown };
  if (o.version !== MARKUP_VERSION || !Array.isArray(o.shapes)) return null;
  const shapes = o.shapes
    .filter(
      (s): s is MarkupRect =>
        !!s &&
        typeof s === 'object' &&
        ['x', 'y', 'w', 'h'].every((k) => typeof (s as Record<string, unknown>)[k] === 'number'),
    )
    .map(normalizeRect)
    .filter((r) => r.w > 0 && r.h > 0)
    .slice(0, MARKUP_MAX_SHAPES);
  return shapes.length ? { version: MARKUP_VERSION, shapes } : null;
}

/** Convert a normalised rect to CSS percentage strings for absolute positioning over an <img>. */
export function rectToPercentStyle(r: MarkupRect): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${(r.x * 100).toFixed(3)}%`,
    top: `${(r.y * 100).toFixed(3)}%`,
    width: `${(r.w * 100).toFixed(3)}%`,
    height: `${(r.h * 100).toFixed(3)}%`,
  };
}
