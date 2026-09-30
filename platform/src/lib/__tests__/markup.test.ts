import { describe, it, expect } from 'vitest';
import {
  buildMarkup,
  parseMarkup,
  normalizeRect,
  rectToPercentStyle,
  MARKUP_MAX_SHAPES,
} from '../markup';

describe('markup — buildMarkup', () => {
  it('builds a normalised markup from raw rects, dropping strays', () => {
    const m = buildMarkup([
      { x: 0.2, y: 0.3, w: 0.4, h: 0.25 },
      { x: 0.5, y: 0.5, w: 0.002, h: 0.002 }, // stray tap → dropped
    ]);
    expect(m).toEqual({ version: 1, shapes: [{ x: 0.2, y: 0.3, w: 0.4, h: 0.25 }] });
  });

  it('returns null when nothing meaningful remains', () => {
    expect(buildMarkup([])).toBeNull();
    expect(buildMarkup([{ x: 0.5, y: 0.5, w: 0, h: 0 }])).toBeNull();
  });

  it('caps to MARKUP_MAX_SHAPES', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ x: i / 20, y: 0.1, w: 0.05, h: 0.05 }));
    expect(buildMarkup(many)!.shapes).toHaveLength(MARKUP_MAX_SHAPES);
  });
});

describe('markup — normalizeRect clamps to the image box', () => {
  it('clamps origin + keeps the rect inside 0..1', () => {
    const r = normalizeRect({ x: -0.2, y: 0.9, w: 2, h: 0.5 });
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(0.9);
    expect(r.w).toBe(1);
    expect(r.h).toBeCloseTo(0.1); // 1 - 0.9, floating-point
  });
});

describe('markup — parseMarkup (defensive)', () => {
  it('parses a valid stored blob', () => {
    expect(parseMarkup({ version: 1, shapes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] })).toEqual({
      version: 1,
      shapes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    });
  });

  it('returns null for absent / wrong-version / malformed', () => {
    expect(parseMarkup(null)).toBeNull();
    expect(parseMarkup(undefined)).toBeNull();
    expect(parseMarkup({ version: 2, shapes: [] })).toBeNull();
    expect(parseMarkup({ version: 1, shapes: 'nope' })).toBeNull();
    expect(parseMarkup({ version: 1, shapes: [{ x: 'a', y: 1, w: 1, h: 1 }] })).toBeNull();
  });

  it('drops garbage shapes but keeps the good ones, clamped inside the image', () => {
    const m = parseMarkup({
      version: 1,
      shapes: [
        { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, // good
        { bad: true }, // garbage → dropped
        { x: 0.9, y: 0.5, w: 0.5, h: 0.3 }, // spills past the right edge → width clamped to 0.1
      ],
    });
    expect(m!.shapes).toHaveLength(2);
    expect(m!.shapes[1].x).toBeCloseTo(0.9);
    expect(m!.shapes[1].y).toBeCloseTo(0.5);
    expect(m!.shapes[1].w).toBeCloseTo(0.1); // 1 - 0.9, floating-point
    expect(m!.shapes[1].h).toBeCloseTo(0.3);
  });
});

describe('markup — rectToPercentStyle', () => {
  it('maps a normalised rect to CSS percentages', () => {
    expect(rectToPercentStyle({ x: 0.25, y: 0.5, w: 0.1, h: 0.2 })).toEqual({
      left: '25.000%',
      top: '50.000%',
      width: '10.000%',
      height: '20.000%',
    });
  });
});
