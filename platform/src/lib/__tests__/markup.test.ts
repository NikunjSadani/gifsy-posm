import { describe, it, expect } from 'vitest';
import {
  buildMarkup,
  parseMarkup,
  normalizeRect,
  normalizePath,
  rectToPercentStyle,
  pathToSvgPoints,
  MARKUP_MAX_SHAPES,
  MARKUP_MAX_POINTS,
  type MarkupShape,
} from '../markup';

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
