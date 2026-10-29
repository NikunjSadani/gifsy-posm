/**
 * Recce photo MARKUP — the field executive's on-image annotation marking WHERE the POSM
 * installation is proposed. Stored per recce POSM (`ReccePosm.markup` JSON) and rendered as an
 * overlay for the ASM (recce review) and the Auditor (install before/after).
 *
 * Two shape tools: a RECTANGLE box (`type:'rect'`) and a FREEHAND path (`type:'path'`, a
 * polyline of points). Coordinates are NORMALISED to 0..1 relative to the image's CONTENT box
 * (the drawn picture, natural aspect), so the same markup renders correctly at any display size
 * and on the stored original. Pure + framework-free so producer (capture) and consumers
 * (review/audit) share ONE contract — the backend `MarkupDto` mirrors this exact shape.
 *
 * Back-compat: markup stored before freehand existed had rects WITHOUT a `type` field; parseMarkup
 * treats a type-less {x,y,w,h} object as a rect.
 */

export const MARKUP_VERSION = 1 as const;
/** Max shapes (rects + paths) per photo — bounds the stored blob + keeps the overlay legible. */
export const MARKUP_MAX_SHAPES = 10;
/** Max points in one freehand path (the annotator downsamples to this; the DTO rejects beyond). */
export const MARKUP_MAX_POINTS = 400;
/** A rect/path smaller than this (normalised extent) is a stray tap, not a deliberate mark. */
export const MARKUP_MIN_SIDE = 0.01;

export interface MarkupPoint {
  x: number;
  y: number;
}

/** A rectangle highlight, normalised 0..1 to the image content box. */
export interface MarkupRect {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A freehand polyline, each point normalised 0..1 to the image content box. */
export interface MarkupPath {
  type: 'path';
  points: MarkupPoint[];
}

export type MarkupShape = MarkupRect | MarkupPath;

/** The stored markup blob. `shapes` is 1..MARKUP_MAX_SHAPES rects and/or paths. */
export interface RecceMarkup {
  version: typeof MARKUP_VERSION;
  shapes: MarkupShape[];
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Normalise a rect: clamp the origin to 0..1 and clamp the size so the rect never spills past the
 * image edge (x+w ≤ 1, y+h ≤ 1). Callers pass a pre-normalised rect (positive w/h).
 */
export function normalizeRect(r: { x: number; y: number; w: number; h: number }): MarkupRect {
  const x = clamp01(r.x);
  const y = clamp01(r.y);
  const w = clamp01(r.w);
  const h = clamp01(r.h);
  return { type: 'rect', x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

/** Bounding-box extent of a set of points (max span in x and y). */
function pathExtent(points: MarkupPoint[]): { w: number; h: number } {
  if (points.length === 0) return { w: 0, h: 0 };
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { w: maxX - minX, h: maxY - minY };
}

/**
 * Normalise a freehand path: clamp every point to 0..1, drop consecutive duplicates, and
 * downsample (evenly) to MARKUP_MAX_POINTS if longer. Returns null when < 2 points remain.
 */
export function normalizePath(rawPoints: MarkupPoint[]): MarkupPath | null {
  const clamped: MarkupPoint[] = [];
  for (const p of rawPoints) {
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    const x = clamp01(p.x);
    const y = clamp01(p.y);
    const last = clamped[clamped.length - 1];
    if (last && last.x === x && last.y === y) continue; // drop consecutive dupes
    clamped.push({ x, y });
  }
  let points = clamped;
  if (points.length > MARKUP_MAX_POINTS) {
    const step = points.length / MARKUP_MAX_POINTS;
    const down: MarkupPoint[] = [];
    for (let i = 0; i < MARKUP_MAX_POINTS; i++) down.push(points[Math.floor(i * step)]);
    down[down.length - 1] = points[points.length - 1]; // always keep the last point
    points = down;
  }
  return points.length >= 2 ? { type: 'path', points } : null;
}

/**
 * Build a RecceMarkup from raw shapes drawn in the annotator: normalise each, drop strays
 * (rect/path below MARKUP_MIN_SIDE extent), cap to MARKUP_MAX_SHAPES. Null when nothing meaningful
 * remains (an un-annotated photo stores no markup rather than an empty object).
 */
export function buildMarkup(shapes: MarkupShape[]): RecceMarkup | null {
  const out: MarkupShape[] = [];
  for (const s of shapes) {
    if (out.length >= MARKUP_MAX_SHAPES) break;
    if (s.type === 'rect') {
      const r = normalizeRect(s);
      if (r.w >= MARKUP_MIN_SIDE && r.h >= MARKUP_MIN_SIDE) out.push(r);
    } else if (s.type === 'path') {
      const p = normalizePath(s.points);
      if (p) {
        const ext = pathExtent(p.points);
        if (ext.w >= MARKUP_MIN_SIDE || ext.h >= MARKUP_MIN_SIDE) out.push(p);
      }
    }
  }
  return out.length ? { version: MARKUP_VERSION, shapes: out } : null;
}

/**
 * Parse an UNKNOWN stored value (from the API) into a RecceMarkup, or null when absent/invalid.
 * Defensive: tolerates legacy type-less rects + garbage, clamps to 0..1, caps counts. The single
 * validation point for the review/audit overlays.
 */
export function parseMarkup(v: unknown): RecceMarkup | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { version?: unknown; shapes?: unknown };
  if (o.version !== MARKUP_VERSION || !Array.isArray(o.shapes)) return null;
  const out: MarkupShape[] = [];
  for (const raw of o.shapes) {
    if (out.length >= MARKUP_MAX_SHAPES) break;
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (s.type === 'path' && Array.isArray(s.points)) {
      const p = normalizePath(s.points as MarkupPoint[]);
      if (p) out.push(p);
    } else if (
      // explicit rect, OR a legacy type-less {x,y,w,h}
      (s.type === 'rect' || s.type === undefined) &&
      ['x', 'y', 'w', 'h'].every((k) => typeof s[k] === 'number')
    ) {
      const r = normalizeRect(s as { x: number; y: number; w: number; h: number });
      if (r.w > 0 && r.h > 0) out.push(r);
    }
  }
  return out.length ? { version: MARKUP_VERSION, shapes: out } : null;
}

// ── Element aspect-box (recce) ─────────────────────────────────────────────────────────────
/**
 * Minimum normalised width for the draggable Element box — keeps the box (and its resize grip)
 * big enough to grab on a phone, never shrinking to an un-tappable speck.
 */
export const ELEMENT_BOX_MIN_W = 0.08;
/** Default Element box size as a fraction of the photo's constraining dimension (centered). */
export const ELEMENT_BOX_DEFAULT_FIT = 0.5;

/**
 * The normalised width:height ratio a box must have so it RENDERS with real-world aspect
 * `realAspect` (= element width ÷ height, in feet) over an image displayed at `imgW`×`imgH` px
 * with `preserveAspectRatio: none`. Because normalised space is square (x,y each 0..1) but the
 * image is not, the on-screen aspect folds in the image's own pixel aspect: w/h (norm) =
 * realAspect · imgH/imgW. Falls back to the image's aspect (a visual square-ish default) when
 * inputs are degenerate.
 */
export function normAspectFor(realAspect: number, imgW: number, imgH: number): number {
  const a = Number.isFinite(realAspect) && realAspect > 0 ? realAspect : 1;
  if (!(imgW > 0) || !(imgH > 0)) return a;
  return a * (imgH / imgW);
}

/**
 * A centered, aspect-correct default Element box, normalised 0..1 to the image content box.
 * Sized to the largest rectangle of on-screen aspect `realAspect` that fits within `fit` of EACH
 * image dimension — so it reads clearly as the element's footprint yet leaves room to drag.
 */
export function defaultElementBox(
  realAspect: number,
  imgW: number,
  imgH: number,
  fit: number = ELEMENT_BOX_DEFAULT_FIT,
): MarkupRect {
  const na = normAspectFor(realAspect, imgW, imgH); // normalised w/h
  // Largest (w,h) with w = na·h that fits in fit×fit of normalised space.
  const h = Math.min(fit, fit / na);
  const w = na * h;
  const x = (1 - w) / 2;
  const y = (1 - h) / 2;
  return normalizeRect({ x, y, w, h });
}

/**
 * A centered, visually SQUARE (1:1 on-screen) default Element box, normalised 0..1 to the image
 * content box. Used for UNIT elements, which carry no real-world W×H — the box still marks WHERE
 * the element goes, but as a square rather than a footprint-shaped rectangle. Expressed via
 * {@link defaultElementBox} with `realAspect = 1`, so the image's own pixel aspect is folded in
 * (a 1:1 box reads square on a non-square photo).
 */
export function squareElementBox(imgW: number, imgH: number, fit: number = ELEMENT_BOX_DEFAULT_FIT): MarkupRect {
  return defaultElementBox(1, imgW, imgH, fit);
}

/**
 * Translate an Element box by (dx,dy) in normalised space, clamped so it stays fully in-frame
 * (size preserved). Used for drag-to-move.
 */
export function moveElementBox(r: MarkupRect, dx: number, dy: number): MarkupRect {
  const x = Math.min(Math.max(0, r.x + dx), 1 - r.w);
  const y = Math.min(Math.max(0, r.y + dy), 1 - r.h);
  return { type: 'rect', x, y, w: r.w, h: r.h };
}

/**
 * Resize an Element box by dragging its bottom-right grip to (px,py), anchored at its top-left
 * corner, with the on-screen aspect LOCKED to `normAspect` (= {@link normAspectFor}). The width
 * follows the pointer (floored at `minW`), the height is derived from the locked aspect, and the
 * box is capped so it never spills past the right/bottom edge — preserving aspect by backing the
 * width off when the height would overflow. This is what keeps a "resize" from silently becoming
 * a free-form (aspect-breaking) rectangle.
 */
export function resizeElementBox(
  r: MarkupRect,
  normAspect: number,
  px: number,
  py: number,
  minW: number = ELEMENT_BOX_MIN_W,
): MarkupRect {
  const na = normAspect > 0 ? normAspect : 1;
  const maxW = 1 - r.x;
  const maxH = 1 - r.y;
  // Candidate width from the pointer, floored at the min and capped at the right edge.
  let w = Math.min(Math.max(px - r.x, minW), maxW);
  let h = w / na;
  // If the aspect-derived height overflows the bottom edge, back the width off to restore aspect.
  if (h > maxH) {
    h = maxH;
    w = Math.min(Math.max(h * na, minW), maxW);
    h = w / na; // re-derive so aspect holds even after the min-width floor
  }
  return normalizeRect({ x: r.x, y: r.y, w, h });
}

/** A normalised rect → CSS percentage strings for absolute positioning over an <img>. */
export function rectToPercentStyle(r: { x: number; y: number; w: number; h: number }): {
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

/** A path → an SVG `points` string in a 0..100 user space (for a viewBox="0 0 100 100" svg). */
export function pathToSvgPoints(path: MarkupPath): string {
  return path.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
}
