import { describe, it, expect } from 'vitest';
import {
  buildMarkup,
  parseMarkup,
  normalizeRect,
  normalizePath,
  rectToPercentStyle,
  pathToSvgPoints,
  normAspectFor,
  defaultElementBox,
  squareElementBox,
  moveElementBox,
  resizeElementBox,
  ELEMENT_BOX_MIN_W,
  MARKUP_MAX_SHAPES,
  MARKUP_MAX_POINTS,
  type MarkupRect,
  type MarkupShape,
} from '../markup';

/** On-screen aspect (w:h in px) a normalised rect renders at over an imgW×imgH image. */
const onScreenAspect = (r: MarkupRect, imgW: number, imgH: number) => (r.w * imgW) / (r.h * imgH);

describe('markup — buildMarkup (rects + paths)', () => {
  it('builds normalised rects, dropping stray taps', () => {
    const m = buildMarkup([
      { type: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.25 },
      { type: 'rect', x: 0.5, y: 0.5, w: 0.002, h: 0.002 }, // stray → dropped
    ]);
    expect(m).toEqual({ version: 1, shapes: [{ type: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.25 }] });
  });

  it('builds a freehand path, dropping a negligible-extent scribble', () => {
    const path: MarkupShape = {
      type: 'path',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.4 },
        { x: 0.7, y: 0.2 },
      ],
    };
    const m = buildMarkup([path]);
    expect(m!.shapes[0].type).toBe('path');
    expect((m!.shapes[0] as { points: unknown[] }).points).toHaveLength(3);

    // a 1-pixel wiggle → below MIN_SIDE extent → dropped
    expect(buildMarkup([{ type: 'path', points: [{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 }] }])).toBeNull();
  });

  it('keeps a mix of rect + path and caps to MARKUP_MAX_SHAPES', () => {
    const many: MarkupShape[] = Array.from({ length: 15 }, (_, i) => ({
      type: 'rect' as const,
      x: i / 20,
      y: 0.1,
      w: 0.05,
      h: 0.05,
    }));
    expect(buildMarkup(many)!.shapes).toHaveLength(MARKUP_MAX_SHAPES);
  });

  it('returns null when nothing meaningful remains', () => {
    expect(buildMarkup([])).toBeNull();
  });
});

describe('markup — normalizePath', () => {
  it('clamps points, drops consecutive dupes, needs >= 2 points', () => {
    const p = normalizePath([
      { x: -1, y: 0.5 },
      { x: 0, y: 0.5 }, // dupe of the clamped previous → dropped
      { x: 0.8, y: 2 },
    ]);
    expect(p).toEqual({ type: 'path', points: [{ x: 0, y: 0.5 }, { x: 0.8, y: 1 }] });
    expect(normalizePath([{ x: 0.5, y: 0.5 }])).toBeNull();
  });

  it('downsamples a very long path to MARKUP_MAX_POINTS (keeping the last point)', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ x: i / 1000, y: 0.5 }));
    const p = normalizePath(pts)!;
    expect(p.points).toHaveLength(MARKUP_MAX_POINTS);
    expect(p.points[p.points.length - 1]).toEqual({ x: 0.999, y: 0.5 });
  });
});

describe('markup — normalizeRect clamps inside the image box', () => {
  it('clamps origin + keeps the rect inside 0..1', () => {
    const r = normalizeRect({ x: -0.2, y: 0.9, w: 2, h: 0.5 });
    expect(r).toMatchObject({ type: 'rect', x: 0, y: 0.9, w: 1 });
    expect(r.h).toBeCloseTo(0.1);
  });
});

describe('markup — parseMarkup (defensive + legacy)', () => {
  it('parses explicit rects and paths', () => {
    const m = parseMarkup({
      version: 1,
      shapes: [
        { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { type: 'path', points: [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.5 }] },
      ],
    });
    expect(m!.shapes).toHaveLength(2);
    expect(m!.shapes[0].type).toBe('rect');
    expect(m!.shapes[1].type).toBe('path');
  });

  it('treats a legacy TYPE-LESS {x,y,w,h} as a rect (back-compat)', () => {
    const m = parseMarkup({ version: 1, shapes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }] });
    expect(m).toEqual({ version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }] });
  });

  it('returns null for absent / wrong-version / malformed', () => {
    expect(parseMarkup(null)).toBeNull();
    expect(parseMarkup({ version: 2, shapes: [] })).toBeNull();
    expect(parseMarkup({ version: 1, shapes: 'nope' })).toBeNull();
    expect(parseMarkup({ version: 1, shapes: [{ type: 'rect', x: 'a', y: 1, w: 1, h: 1 }] })).toBeNull();
    expect(parseMarkup({ version: 1, shapes: [{ type: 'path', points: [{ x: 0.5, y: 0.5 }] }] })).toBeNull(); // 1 pt
  });
});

describe('markup — render helpers', () => {
  it('rectToPercentStyle maps to CSS percentages', () => {
    expect(rectToPercentStyle({ x: 0.25, y: 0.5, w: 0.1, h: 0.2 })).toEqual({
      left: '25.000%',
      top: '50.000%',
      width: '10.000%',
      height: '20.000%',
    });
  });

  it('pathToSvgPoints maps to a 0..100 points string', () => {
    expect(pathToSvgPoints({ type: 'path', points: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }] })).toBe('0.00,0.00 50.00,100.00');
  });
});

describe('markup — Element aspect-box helpers', () => {
  it('normAspectFor folds in the image pixel aspect (w/h norm = realAspect·imgH/imgW)', () => {
    expect(normAspectFor(2, 100, 100)).toBe(2); // square image → norm aspect == real aspect
    expect(normAspectFor(1, 400, 300)).toBeCloseTo(0.75, 6); // 1:1 element on 4:3 image
    expect(normAspectFor(0, 400, 300)).toBeCloseTo(0.75, 6); // degenerate real → fallback a=1
    expect(normAspectFor(2, 0, 0)).toBe(2); // unmeasurable image → fall back to real aspect
  });

  it('defaultElementBox renders at the real-world aspect, centered, ~half the frame', () => {
    // 2:1 element on a square image.
    const r = defaultElementBox(2, 200, 200);
    expect(onScreenAspect(r, 200, 200)).toBeCloseTo(2, 6); // shape matches the element
    expect(r.w).toBeCloseTo(0.5, 6); // constraining dim ~= fit (0.5)
    expect(r.h).toBeCloseTo(0.25, 6);
    expect(r.x).toBeCloseTo(0.25, 6); // centered
    expect(r.y).toBeCloseTo(0.375, 6);
  });

  it('defaultElementBox corrects for a non-square image (1:1 element on 4:3 reads square)', () => {
    const r = defaultElementBox(1, 400, 300);
    expect(onScreenAspect(r, 400, 300)).toBeCloseTo(1, 6);
    // Fits within half of each dimension and stays fully in-frame.
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });

  it('squareElementBox renders a visually SQUARE box (1:1 on-screen), centered, in-frame', () => {
    // Square on a non-square image: the box must still READ square on screen.
    const r = squareElementBox(400, 300);
    expect(onScreenAspect(r, 400, 300)).toBeCloseTo(1, 6);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
    // Centered.
    expect(r.x).toBeCloseTo((1 - r.w) / 2, 6);
    expect(r.y).toBeCloseTo((1 - r.h) / 2, 6);
  });

  it('squareElementBox is exactly defaultElementBox with aspect 1', () => {
    expect(squareElementBox(200, 200)).toEqual(defaultElementBox(1, 200, 200));
    expect(squareElementBox(400, 300)).toEqual(defaultElementBox(1, 400, 300));
  });

  it('moveElementBox translates and clamps the box fully in-frame (size preserved)', () => {
    const r: MarkupRect = { type: 'rect', x: 0.5, y: 0.5, w: 0.3, h: 0.3 };
    expect(moveElementBox(r, 0.4, 0.4)).toEqual({ type: 'rect', x: 0.7, y: 0.7, w: 0.3, h: 0.3 });
    expect(moveElementBox(r, -1, -1)).toEqual({ type: 'rect', x: 0, y: 0, w: 0.3, h: 0.3 });
  });

  it('resizeElementBox keeps the aspect locked and the box in-frame', () => {
    const r: MarkupRect = { type: 'rect', x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    const out = resizeElementBox(r, 1, 0.7, 0.9); // drag BR; aspect 1:1
    // (0.7 - 0.2 is 0.4999…996 in float, so assert component-wise, not strict-equal.)
    expect(out.type).toBe('rect');
    expect(out.x).toBeCloseTo(0.2, 6);
    expect(out.y).toBeCloseTo(0.2, 6);
    expect(out.w).toBeCloseTo(0.5, 6);
    expect(out.h).toBeCloseTo(0.5, 6);
    expect(onScreenAspect(out, 100, 100)).toBeCloseTo(1, 6);
  });

  it('resizeElementBox backs width off (preserving aspect) when the height would overflow', () => {
    const r: MarkupRect = { type: 'rect', x: 0.1, y: 0.6, w: 0.2, h: 0.1 };
    const out = resizeElementBox(r, 2, 0.95, 0.95); // na=2 (wide); bottom edge limits it
    expect(out.y + out.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(out.x + out.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(out.w / out.h).toBeCloseTo(2, 6); // aspect preserved despite the clamp
  });

  it('resizeElementBox floors at the minimum width (never an un-tappable speck)', () => {
    const r: MarkupRect = { type: 'rect', x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const out = resizeElementBox(r, 1, 0.105, 0.105); // drag grip almost onto the anchor
    expect(out.w).toBeCloseTo(ELEMENT_BOX_MIN_W, 6);
  });
});
