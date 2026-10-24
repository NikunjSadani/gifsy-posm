/**
 * outlet-pptx.helper.ts — the PURE geometry + text contract for the Recce Report PowerPoint export
 * (owner spec 2026-10-24). No Nest / Prisma / pptxgenjs / jimp imports, so every calculation here is
 * trivially unit-testable; the service decodes the photo bytes and renders the plan onto a deck.
 *
 * One SLIDE PER OUTLET. The slide has a wide GREEN header band (two centred lines — identity, then
 * "(W X H) - date - GPS" where GPS links to Google Maps) and, on the LEFT, the recce element
 * photo(s) at natural aspect with the element-placement box drawn as a thin green rectangle outline
 * mapped from the stored normalised markup. The RIGHT half is deliberately left empty: it is the
 * seam for the future INSTALLED variant (Phase C), which will drop the install photo there.
 *
 * Coordinates: pptxgenjs positions everything in INCHES on the slide. Markup is stored NORMALISED
 * 0..1 to the image CONTENT box (see platform `@/lib/markup`), so mapping a markup rect onto the
 * image's on-slide placement rect ({@link placeBox}) reproduces exactly what the review overlay
 * draws. Because the photo is placed at its natural aspect ({@link fitContain}), the placement rect
 * is the FITTED rect inside its cell — the box is mapped onto THAT, never the raw cell.
 */

// ── Geometry ────────────────────────────────────────────────────────────────────────────────────

/** A rectangle in slide inches (x,y = top-left; w,h = size). Also used for 0..1 normalised rects. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a number to 0..1 (non-finite → 0) — mirrors the markup contract's `clamp01`. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * The bounding box (normalised 0..1) of a stored recce markup blob, or null when there is nothing
 * meaningful to draw. Mirrors the defensive parse in platform `@/lib/markup` (version-less legacy
 * rects tolerated), but returns a single box: for a RECT shape its own extent, for a FREEHAND PATH
 * its points' bounding box (a best-effort box for a non-rectangular annotation, per the owner spec),
 * and for multiple shapes the UNION extent (a recce element is normally one box, so union == that box).
 */
export function markupBoundingBox(markup: unknown): Rect | null {
  if (!markup || typeof markup !== 'object') return null;
  const shapes = (markup as { shapes?: unknown }).shapes;
  if (!Array.isArray(shapes)) return null;

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  const acc = (x: number, y: number) => {
    const cx = clamp01(x);
    const cy = clamp01(y);
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;
    found = true;
  };

  for (const raw of shapes) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (s.type === 'path' && Array.isArray(s.points)) {
      for (const p of s.points) {
        if (p && typeof p === 'object') {
          const px = (p as { x?: unknown }).x;
          const py = (p as { y?: unknown }).y;
          if (typeof px === 'number' && typeof py === 'number') acc(px, py);
        }
      }
    } else if (
      (s.type === 'rect' || s.type === undefined) &&
      ['x', 'y', 'w', 'h'].every((k) => typeof s[k] === 'number')
    ) {
      const x = clamp01(s.x as number);
      const y = clamp01(s.y as number);
      const w = clamp01(s.w as number);
      const h = clamp01(s.h as number);
      acc(x, y);
      acc(x + w, y + h);
    }
  }

  if (!found) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 && h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

/**
 * Fit an image of natural size `natW`×`natH` INSIDE `box` preserving aspect, centred (CSS
 * `object-fit: contain`). Returns the actual on-slide image rect. Degenerate inputs (a zero
 * dimension) fall back to filling the box.
 */
export function fitContain(natW: number, natH: number, box: Rect): Rect {
  if (!(natW > 0) || !(natH > 0) || !(box.w > 0) || !(box.h > 0)) {
    return { ...box };
  }
  const ar = natW / natH;
  const boxAr = box.w / box.h;
  let w: number;
  let h: number;
  if (ar > boxAr) {
    // image is wider than the box → width-constrained
    w = box.w;
    h = box.w / ar;
  } else {
    // image is taller/equal → height-constrained
    h = box.h;
    w = box.h * ar;
  }
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  return { x, y, w, h };
}

/**
 * Map a NORMALISED (0..1) rect onto the image's on-slide placement rect. This is the box-placement
 * math: `img` is the fitted image rect (inches), `norm` is the markup bounding box (0..1 within the
 * image content box), and the result is the rectangle to stroke on the slide, in inches.
 */
export function placeBox(img: Rect, norm: Rect): Rect {
  return {
    x: img.x + norm.x * img.w,
    y: img.y + norm.y * img.h,
    w: norm.w * img.w,
    h: norm.h * img.h,
  };
}

// ── Text ────────────────────────────────────────────────────────────────────────────────────────

/** Header line 1: "<OUTLET NAME> - <TOWN> - <STATE>" (blanks dropped). Outlet name is always present. */
export function pptxTitleLine1(
  name: string | null | undefined,
  town: string | null | undefined,
  state: string | null | undefined,
): string {
  return [name, town, state]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' - ');
}

/**
 * The inner "W X H unit" label for an element's stored `dimensions` ({width,height,unit}), or null
 * when the dimensions are absent / malformed (e.g. branding-not-required). The caller wraps it in
 * parentheses for the header and uses it bare in the per-element caption.
 */
export function pptxDimsLabel(dims: unknown): string | null {
  if (dims && typeof dims === 'object' && !Array.isArray(dims)) {
    const d = dims as Record<string, unknown>;
    const w = Number(d.width);
    const h = Number(d.height);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      const unit = typeof d.unit === 'string' && d.unit.trim() ? ` ${d.unit.trim()}` : '';
      return `${w} X ${h}${unit}`;
    }
  }
  return null;
}

/** Deterministic IST "DD MMM YYYY" (e.g. "28 Aug 2026"), or "" when absent/invalid. */
export function pptxDateLabel(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  // en-GB "short" month yields "28 Aug 2026" (no commas) in the IST zone.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(date)
    .replace(/,/g, '');
}

/** Google Maps query link for a capture geotag (same form the on-screen report uses). */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// ── Slide plan (pure) — the renderer consumes this verbatim ───────────────────────────────────────

/** One text run of the header's second line; `link` makes it a hyperlink (the "GPS" run). */
export interface HeaderSeg {
  text: string;
  link?: string;
}

/** A decoded element ready to lay out. `image` is absent when the photo was missing/undecodable. */
export interface PlanElementInput {
  slotNo: number;
  posmTypeName: string | null;
  dimsInner: string | null;
  markup: unknown;
  image?: { dataUrl: string; natW: number; natH: number };
}

/** One laid-out element: an optional image + optional stroke box (markup) + a caption, all in inches. */
export interface PlannedElement {
  dataUrl?: string;
  imageRect?: Rect;
  boxRect?: Rect;
  caption: string;
  captionRect: Rect;
}

/** The full, render-ready plan for one slide. `empty` ⇒ a "No recce captured" body. */
export interface SlidePlan {
  line1: string;
  line2: HeaderSeg[];
  empty: boolean;
  elements: PlannedElement[];
}

/** The slide canvas + content-area layout, in inches. Defaults target pptxgenjs LAYOUT_WIDE (13.33×7.5). */
export interface SlideLayout {
  slideW: number;
  slideH: number;
  headerH: number;
  /** Left content column (the recce side). The right half is the INSTALLED-variant seam (Phase C). */
  leftX: number;
  leftW: number;
  contentTop: number;
  contentBottom: number;
  /** Vertical gap between stacked elements, and the caption strip height. */
  gap: number;
  captionH: number;
}

export const DEFAULT_SLIDE_LAYOUT: SlideLayout = {
  slideW: 13.333,
  slideH: 7.5,
  headerH: 1.2,
  leftX: 0.4,
  leftW: 6.0,
  contentTop: 1.45,
  contentBottom: 7.2,
  gap: 0.25,
  captionH: 0.35,
};

/**
 * Build the second header line as text runs: "(W X H) - <date> - GPS". The dims come from the FIRST
 * element that carries them; GPS is a hyperlink run and is OMITTED entirely (with its separator) when
 * there is no geotag. Returns [] when nothing applies (renderer then draws line 1 only).
 */
export function buildHeaderLine2(
  firstDimsInner: string | null,
  dateLabel: string,
  geo: { lat: number; lng: number } | null,
): HeaderSeg[] {
  const parts: string[] = [];
  if (firstDimsInner) parts.push(`(${firstDimsInner})`);
  if (dateLabel) parts.push(dateLabel);
  const prefix = parts.join(' - ');

  const segs: HeaderSeg[] = [];
  if (geo) {
    if (prefix) segs.push({ text: `${prefix} - ` });
    segs.push({ text: 'GPS', link: mapsUrl(geo.lat, geo.lng) });
  } else if (prefix) {
    segs.push({ text: prefix });
  }
  return segs;
}

/**
 * The PURE slide planner — all geometry + text, no I/O. Given the outlet identity, the chosen recce's
 * date + geotag, and the already-decoded elements (image bytes resolved upstream), it computes the
 * header lines and, for each element, the fitted image rect, the markup stroke box mapped onto that
 * rect, and the caption rect. Elements are stacked vertically in the LEFT column so the right half
 * stays free for the installed variant. `empty` is true when there is no recce or no usable element.
 */
export function planRecceSlide(opts: {
  outletName: string;
  town: string | null;
  state: string | null;
  recceDate: Date | string | null;
  geo: { lat: number; lng: number } | null;
  elements: PlanElementInput[];
  layout?: SlideLayout;
}): SlidePlan {
  const layout = opts.layout ?? DEFAULT_SLIDE_LAYOUT;
  const line1 = pptxTitleLine1(opts.outletName, opts.town, opts.state);
  const firstDims = opts.elements.find((e) => e.dimsInner)?.dimsInner ?? null;
  const line2 = buildHeaderLine2(firstDims, pptxDateLabel(opts.recceDate), opts.geo);

  const els = opts.elements;
  if (els.length === 0) {
    return { line1, line2, empty: true, elements: [] };
  }

  const n = els.length;
  const contentH = layout.contentBottom - layout.contentTop;
  const cellH = (contentH - layout.gap * (n - 1)) / n;

  const planned: PlannedElement[] = els.map((el, i) => {
    const cellY = layout.contentTop + i * (cellH + layout.gap);
    const captionRect: Rect = {
      x: layout.leftX,
      y: cellY + cellH - layout.captionH,
      w: layout.leftW,
      h: layout.captionH,
    };
    const imgBox: Rect = {
      x: layout.leftX,
      y: cellY,
      w: layout.leftW,
      h: Math.max(0, cellH - layout.captionH),
    };

    const typeLabel = el.posmTypeName?.trim() || 'Element';
    const captionBase = el.dimsInner ? `${typeLabel} — ${el.dimsInner}` : typeLabel;

    if (!el.image) {
      // Present element but the photo could not be fetched/decoded — caption only (no crash).
      return { caption: `${captionBase} (image unavailable)`, captionRect };
    }

    const imageRect = fitContain(el.image.natW, el.image.natH, imgBox);
    const bbox = markupBoundingBox(el.markup);
    const boxRect = bbox ? placeBox(imageRect, bbox) : undefined;
    return { dataUrl: el.image.dataUrl, imageRect, boxRect, caption: captionBase, captionRect };
  });

  return { line1, line2, empty: false, elements: planned };
}
