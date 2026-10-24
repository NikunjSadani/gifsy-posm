import {
  markupBoundingBox,
  fitContain,
  placeBox,
  pptxTitleLine1,
  pptxDimsLabel,
  pptxDateLabel,
  mapsUrl,
  buildHeaderLine2,
  planRecceSlide,
  DEFAULT_SLIDE_LAYOUT,
  type Rect,
} from './outlet-pptx.helper';

describe('markupBoundingBox', () => {
  it('returns a rect shape verbatim as its bounding box', () => {
    const b = markupBoundingBox({ version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] })!;
    expect(b.x).toBeCloseTo(0.1);
    expect(b.y).toBeCloseTo(0.2);
    expect(b.w).toBeCloseTo(0.3); // (x+w)-x re-derivation carries float noise — compare with tolerance
    expect(b.h).toBeCloseTo(0.25);
  });

  it('tolerates a legacy type-less {x,y,w,h} rect', () => {
    expect(markupBoundingBox({ version: 1, shapes: [{ x: 0, y: 0, w: 0.5, h: 0.5 }] })).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.5,
    });
  });

  it('computes the bounding box of a freehand path (best-effort box)', () => {
    const bbox = markupBoundingBox({
      version: 1,
      shapes: [{ type: 'path', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.5 }] }],
    });
    expect(bbox).toEqual({ x: 0.2, y: 0.1, w: 0.6 - 0.2, h: 0.5 - 0.1 });
  });

  it('unions multiple shapes into one enclosing box', () => {
    const bbox = markupBoundingBox({
      version: 1,
      shapes: [
        { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { type: 'rect', x: 0.5, y: 0.6, w: 0.2, h: 0.2 },
      ],
    });
    expect(bbox).toEqual({ x: 0.1, y: 0.1, w: 0.7 - 0.1, h: 0.8 - 0.1 });
  });

  it('clamps out-of-range coordinates into 0..1', () => {
    const bbox = markupBoundingBox({ version: 1, shapes: [{ type: 'rect', x: -1, y: 0.5, w: 5, h: 0.2 }] });
    expect(bbox).toEqual({ x: 0, y: 0.5, w: 1, h: Math.min(1, 0.5 + 0.2) - 0.5 });
  });

  it('returns null for absent / malformed markup', () => {
    expect(markupBoundingBox(null)).toBeNull();
    expect(markupBoundingBox(undefined)).toBeNull();
    expect(markupBoundingBox({})).toBeNull();
    expect(markupBoundingBox({ version: 1, shapes: 'nope' })).toBeNull();
    expect(markupBoundingBox({ version: 1, shapes: [{ type: 'rect' }] })).toBeNull(); // no coords
  });
});

describe('fitContain', () => {
  const box: Rect = { x: 2, y: 1, w: 6, h: 4 };

  it('width-constrains a wide image and centres it vertically', () => {
    // 2:1 image into a 6×4 box → width 6, height 3, centred vertically (y offset 0.5).
    expect(fitContain(200, 100, box)).toEqual({ x: 2, y: 1 + 0.5, w: 6, h: 3 });
  });

  it('height-constrains a tall image and centres it horizontally', () => {
    // 1:2 image into a 6×4 box → height 4, width 2, centred horizontally (x offset 2).
    expect(fitContain(100, 200, box)).toEqual({ x: 2 + 2, y: 1, w: 2, h: 4 });
  });

  it('falls back to filling the box on a degenerate dimension', () => {
    expect(fitContain(0, 100, box)).toEqual(box);
  });
});

describe('placeBox', () => {
  it('maps a normalised rect onto the image placement rect', () => {
    const img: Rect = { x: 2, y: 1, w: 6, h: 4 };
    expect(placeBox(img, { x: 0.1, y: 0.2, w: 0.3, h: 0.25 })).toEqual({
      x: 2 + 0.1 * 6,
      y: 1 + 0.2 * 4,
      w: 0.3 * 6,
      h: 0.25 * 4,
    });
  });
});

describe('pptx text helpers', () => {
  it('pptxTitleLine1 joins name/town/state and drops blanks', () => {
    expect(pptxTitleLine1('Shop', 'Pune', 'MH')).toBe('Shop - Pune - MH');
    expect(pptxTitleLine1('Shop', '', null)).toBe('Shop');
    expect(pptxTitleLine1('Shop', null, 'MH')).toBe('Shop - MH');
  });

  it('pptxDimsLabel formats W X H unit, or null when NA', () => {
    expect(pptxDimsLabel({ width: 24, height: 12, unit: 'in' })).toBe('24 X 12 in');
    expect(pptxDimsLabel({ width: 24, height: 12 })).toBe('24 X 12');
    expect(pptxDimsLabel({ unit: 'in' })).toBeNull();
    expect(pptxDimsLabel(null)).toBeNull();
  });

  it('pptxDateLabel renders DD MMM YYYY in IST', () => {
    // 2026-08-27T20:00:00Z == 28 Aug 2026 01:30 IST → the IST date is the 28th.
    expect(pptxDateLabel(new Date('2026-08-27T20:00:00Z'))).toBe('28 Aug 2026');
    expect(pptxDateLabel(null)).toBe('');
    expect(pptxDateLabel('not-a-date')).toBe('');
  });

  it('mapsUrl builds a Google Maps query link', () => {
    expect(mapsUrl(19.24, 73.13)).toBe('https://www.google.com/maps?q=19.24,73.13');
  });

  it('buildHeaderLine2 includes a GPS hyperlink run only when geotagged', () => {
    const withGeo = buildHeaderLine2('24 X 12 in', '28 Aug 2026', { lat: 1, lng: 2 });
    expect(withGeo).toEqual([
      { text: '(24 X 12 in) - 28 Aug 2026 - ' },
      { text: 'GPS', link: 'https://www.google.com/maps?q=1,2' },
    ]);
    const noGeo = buildHeaderLine2('24 X 12 in', '28 Aug 2026', null);
    expect(noGeo).toEqual([{ text: '(24 X 12 in) - 28 Aug 2026' }]);
    expect(noGeo.some((s) => s.link)).toBe(false);
  });
});

describe('planRecceSlide', () => {
  it('marks a slide empty when there are no elements', () => {
    const plan = planRecceSlide({
      outletName: 'Shop', town: 'Pune', state: 'MH', recceDate: null, geo: null, elements: [],
    });
    expect(plan.empty).toBe(true);
    expect(plan.line1).toBe('Shop - Pune - MH');
    expect(plan.elements).toHaveLength(0);
  });

  it('places the element box from markup onto the FITTED image rect', () => {
    const markup = { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] };
    const plan = planRecceSlide({
      outletName: 'Shop', town: 'Pune', state: 'MH',
      recceDate: new Date('2026-08-27T20:00:00Z'),
      geo: { lat: 19.24, lng: 73.13 },
      elements: [
        { slotNo: 1, posmTypeName: 'Standard Board', dimsInner: '24 X 12 in', markup, image: { dataUrl: 'data:image/jpeg;base64,xxx', natW: 200, natH: 100 } },
      ],
    });
    expect(plan.empty).toBe(false);
    expect(plan.elements).toHaveLength(1);
    const el = plan.elements[0];
    expect(el.dataUrl).toBe('data:image/jpeg;base64,xxx');
    expect(el.caption).toBe('Standard Board — 24 X 12 in');

    // The box rect is the markup bbox mapped onto the fitted image rect (independently recomputed).
    const L = DEFAULT_SLIDE_LAYOUT;
    const cellH = L.contentBottom - L.contentTop; // single element → full content height
    const imgBox: Rect = { x: L.leftX, y: L.contentTop, w: L.leftW, h: cellH - L.captionH };
    const fitted = fitContain(200, 100, imgBox);
    expect(el.imageRect).toEqual(fitted);
    // Compare against the SAME markup-bbox→placeBox pipeline the planner uses (identical float path).
    expect(el.boxRect).toEqual(placeBox(fitted, markupBoundingBox(markup)!));

    // Header line 2 carries the GPS hyperlink run.
    expect(plan.line2.some((s) => s.link?.includes('google.com/maps'))).toBe(true);
  });

  it('stacks two elements and omits the box when an element has no markup', () => {
    const plan = planRecceSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, geo: null,
      elements: [
        { slotNo: 1, posmTypeName: 'Board', dimsInner: '24 X 12 in', markup: { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }, image: { dataUrl: 'd1', natW: 100, natH: 100 } },
        { slotNo: 2, posmTypeName: 'Shelf', dimsInner: null, markup: null, image: { dataUrl: 'd2', natW: 100, natH: 100 } },
      ],
    });
    expect(plan.elements).toHaveLength(2);
    expect(plan.elements[0].boxRect).toBeDefined();
    expect(plan.elements[1].boxRect).toBeUndefined(); // no markup → no box
    // The second cell sits strictly below the first (stacked, not overlapping).
    expect(plan.elements[1].captionRect.y).toBeGreaterThan(plan.elements[0].captionRect.y);
  });

  it('notes an unavailable image (no crash) when an element has no decoded photo', () => {
    const plan = planRecceSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, geo: null,
      elements: [{ slotNo: 1, posmTypeName: 'Board', dimsInner: '24 X 12 in', markup: null }],
    });
    expect(plan.elements[0].dataUrl).toBeUndefined();
    expect(plan.elements[0].imageRect).toBeUndefined();
    expect(plan.elements[0].caption).toBe('Board — 24 X 12 in (image unavailable)');
  });
});
