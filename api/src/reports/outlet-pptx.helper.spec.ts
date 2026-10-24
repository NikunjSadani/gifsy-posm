import {
  markupBoundingBox,
  markupShapes,
  placeShape,
  fitContain,
  placeBox,
  pptxTitleLine1,
  pptxDimsLabel,
  pptxDateLabel,
  mapsUrl,
  buildHeaderLine2,
  planRecceSlide,
  planInstalledSlide,
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

describe('markupShapes — faithful per-shape parse (FIX 1)', () => {
  it('returns a single rect verbatim (the common case, unchanged)', () => {
    const shapes = markupShapes({ version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] });
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({ kind: 'rect', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 } });
  });

  it('keeps TWO separate rects as two shapes (never a union)', () => {
    const shapes = markupShapes({
      version: 1,
      shapes: [
        { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { type: 'rect', x: 0.5, y: 0.6, w: 0.2, h: 0.2 },
      ],
    });
    expect(shapes).toEqual([
      { kind: 'rect', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      { kind: 'rect', rect: { x: 0.5, y: 0.6, w: 0.2, h: 0.2 } },
    ]);
  });

  it('keeps a freehand path as a path shape with its clamped points', () => {
    const shapes = markupShapes({
      version: 1,
      shapes: [{ type: 'path', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.5 }] }],
    });
    expect(shapes).toEqual([
      { kind: 'path', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.5 }] },
    ]);
  });

  it('tolerates a legacy type-less rect and clamps size past the edge', () => {
    expect(markupShapes({ version: 1, shapes: [{ x: 0.8, y: 0, w: 0.5, h: 0.5 }] })).toEqual([
      // w clamped to 1 - x = 0.2 so the rect never spills past the image edge
      { kind: 'rect', rect: { x: 0.8, y: 0, w: 1 - 0.8, h: 0.5 } },
    ]);
  });

  it('returns [] for absent / malformed markup', () => {
    expect(markupShapes(null)).toEqual([]);
    expect(markupShapes({})).toEqual([]);
    expect(markupShapes({ version: 1, shapes: 'nope' })).toEqual([]);
  });
});

describe('placeShape — per-shape placement onto the fitted image rect (FIX 1 + FIX 4)', () => {
  const img: Rect = { x: 2, y: 1, w: 6, h: 4 };

  it('maps a rect onto the image rect (same as placeBox)', () => {
    const placed = placeShape(img, { kind: 'rect', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 } });
    expect(placed).toEqual({ kind: 'rect', rect: placeBox(img, { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }) });
  });

  it('maps a path to a polyline on the image box with LOCAL points (inches from its top-left)', () => {
    const placed = placeShape(img, { kind: 'path', points: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }] });
    expect(placed).toEqual({
      kind: 'path',
      box: { x: 2, y: 1, w: 6, h: 4 },
      // local = (px·w, py·h): (0,0) and (0.5·6, 1·4) = (3, 4)
      points: [{ x: 0, y: 0 }, { x: 3, y: 4 }],
    });
  });

  it('FIX 4: skips a zero-width OR zero-height rect (a straight line, not a box)', () => {
    expect(placeShape(img, { kind: 'rect', rect: { x: 0.1, y: 0.2, w: 0, h: 0.25 } })).toBeNull();
    expect(placeShape(img, { kind: 'rect', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0 } })).toBeNull();
  });

  it('skips a path with fewer than two points', () => {
    expect(placeShape(img, { kind: 'path', points: [{ x: 0.1, y: 0.1 }] })).toBeNull();
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
    // A single rect markup → exactly one placed rect box (common case unchanged): the markup rect
    // mapped onto the fitted image rect.
    expect(el.boxes).toHaveLength(1);
    expect(el.boxes[0]).toEqual({ kind: 'rect', rect: placeBox(fitted, { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }) });

    // Header line 2 carries the GPS hyperlink run.
    expect(plan.line2.some((s) => s.link?.includes('google.com/maps'))).toBe(true);
  });

  it('draws TWO separate rects as two boxes, each placed on the fitted image rect (FIX 1)', () => {
    const markup = {
      version: 1,
      shapes: [
        { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { type: 'rect', x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
      ],
    };
    const plan = planRecceSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, geo: null,
      elements: [{ slotNo: 1, posmTypeName: 'Board', dimsInner: null, markup, image: { dataUrl: 'd1', natW: 100, natH: 100 } }],
    });
    const el = plan.elements[0];
    const fitted = el.imageRect!;
    expect(el.boxes).toEqual([
      { kind: 'rect', rect: placeBox(fitted, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }) },
      { kind: 'rect', rect: placeBox(fitted, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }) },
    ]);
  });

  it('draws a freehand path as a polyline box, not a union rectangle (FIX 1)', () => {
    const markup = { version: 1, shapes: [{ type: 'path', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.5 }] }] };
    const plan = planRecceSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, geo: null,
      elements: [{ slotNo: 1, posmTypeName: 'Board', dimsInner: null, markup, image: { dataUrl: 'd1', natW: 100, natH: 100 } }],
    });
    const el = plan.elements[0];
    expect(el.boxes).toHaveLength(1);
    const box = el.boxes[0];
    expect(box.kind).toBe('path');
    if (box.kind === 'path') {
      expect(box.box).toEqual(el.imageRect);
      // local points = (px·w, py·h) on the fitted image rect
      const f = el.imageRect!;
      expect(box.points).toEqual([
        { x: 0.2 * f.w, y: 0.3 * f.h },
        { x: 0.6 * f.w, y: 0.1 * f.h },
        { x: 0.4 * f.w, y: 0.5 * f.h },
      ]);
    }
  });

  it('stacks two elements and omits boxes when an element has no markup', () => {
    const plan = planRecceSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, geo: null,
      elements: [
        { slotNo: 1, posmTypeName: 'Board', dimsInner: '24 X 12 in', markup: { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }, image: { dataUrl: 'd1', natW: 100, natH: 100 } },
        { slotNo: 2, posmTypeName: 'Shelf', dimsInner: null, markup: null, image: { dataUrl: 'd2', natW: 100, natH: 100 } },
      ],
    });
    expect(plan.elements).toHaveLength(2);
    expect(plan.elements[0].boxes).toHaveLength(1);
    expect(plan.elements[1].boxes).toEqual([]); // no markup → no boxes
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
    expect(plan.elements[0].boxes).toEqual([]);
    expect(plan.elements[0].caption).toBe('Board — 24 X 12 in (image unavailable)');
  });

  it('the recce-only layout never populates install fields (installed seam stays off)', () => {
    const plan = planRecceSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, geo: null,
      elements: [{ slotNo: 1, posmTypeName: 'Board', dimsInner: null, markup: null, image: { dataUrl: 'd1', natW: 100, natH: 100 } }],
    });
    const el = plan.elements[0];
    expect(el.installDataUrl).toBeUndefined();
    expect(el.installImageRect).toBeUndefined();
    expect(el.installPlaceholder).toBeUndefined();
    expect(el.installCaption).toBeUndefined();
  });
});

describe('planInstalledSlide — before/after layout (Phase C)', () => {
  const L = DEFAULT_SLIDE_LAYOUT;

  it('marks the slide empty when there are no elements', () => {
    const plan = planInstalledSlide({
      outletName: 'Shop', town: 'Pune', state: 'MH', recceDate: null, installDate: null, geo: null, elements: [],
    });
    expect(plan.empty).toBe(true);
    expect(plan.elements).toHaveLength(0);
  });

  it('lays the recce photo (with its markup box) on the LEFT and the install photo (NO box) on the RIGHT', () => {
    const markup = { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] };
    const plan = planInstalledSlide({
      outletName: 'Shop', town: 'Pune', state: 'MH',
      recceDate: new Date('2026-08-27T20:00:00Z'),
      installDate: new Date('2026-09-01T20:00:00Z'),
      geo: { lat: 19.24, lng: 73.13 },
      elements: [
        {
          slotNo: 1, posmTypeName: 'Standard Board', dimsInner: '24 X 12 in', markup,
          image: { dataUrl: 'recce-data', natW: 200, natH: 100 },
          installImage: { dataUrl: 'install-data', natW: 200, natH: 100 },
        },
      ],
    });
    expect(plan.empty).toBe(false);
    const el = plan.elements[0];

    // LEFT = recce: image in the left column, a placed markup box, "Before · Recce" caption.
    expect(el.dataUrl).toBe('recce-data');
    expect(el.imageRect!.x).toBeCloseTo(fitContain(200, 100, { x: L.leftX, y: L.contentTop, w: L.leftW, h: (L.contentBottom - L.contentTop) - L.captionH }).x);
    expect(el.boxes).toHaveLength(1);
    expect(el.boxes[0].kind).toBe('rect');
    expect(el.caption).toBe('Standard Board — 24 X 12 in · Before · Recce');
    expect(el.captionRect.x).toBe(L.leftX);

    // RIGHT = install: image in the right column, NO box on the install side, "After · Installed" caption.
    expect(el.installDataUrl).toBe('install-data');
    expect(el.installImageRect!.x).toBeGreaterThanOrEqual(L.rightX); // right column
    expect(el.installPlaceholder).toBeUndefined();
    expect(el.installCaption).toBe('After · Installed');
    expect(el.installCaptionRect!.x).toBe(L.rightX);

    // The install date is appended to header line 2 (alongside the recce date + GPS). Use
    // pptxDateLabel so the month abbreviation matches the runtime Intl output (en-GB: "Sept", not "Sep").
    expect(plan.line2.map((s) => s.text).join('')).toContain(`Installed ${pptxDateLabel(new Date('2026-09-01T20:00:00Z'))}`);
    expect(plan.line2.some((s) => s.link?.includes('google.com/maps'))).toBe(true);
  });

  it('shows the recce side + an "Awaiting installation" placeholder on the right when not yet installed', () => {
    const plan = planInstalledSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, installDate: null, geo: null,
      elements: [
        { slotNo: 1, posmTypeName: 'Board', dimsInner: null, markup: null, image: { dataUrl: 'recce-only', natW: 100, natH: 100 } },
      ],
    });
    const el = plan.elements[0];
    expect(el.dataUrl).toBe('recce-only'); // recce side is still shown
    expect(el.installDataUrl).toBeUndefined();
    expect(el.installPlaceholder).toBe(true);
    expect(el.installImageRect).toEqual({ x: L.rightX, y: expect.any(Number), w: L.rightW, h: expect.any(Number) });
    expect(el.installCaption).toBe('Awaiting installation');
  });

  it('notes an unavailable recce image on the left but still planning the install side', () => {
    const plan = planInstalledSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, installDate: null, geo: null,
      elements: [
        { slotNo: 1, posmTypeName: 'Board', dimsInner: '2 X 2 in', markup: null, installImage: { dataUrl: 'install', natW: 100, natH: 100 } },
      ],
    });
    const el = plan.elements[0];
    expect(el.caption).toBe('Board — 2 X 2 in · Before · Recce (image unavailable)');
    expect(el.dataUrl).toBeUndefined();
    expect(el.installDataUrl).toBe('install');
    expect(el.installCaption).toBe('After · Installed');
  });

  it('stacks two elements; the second row sits strictly below the first on BOTH columns', () => {
    const plan = planInstalledSlide({
      outletName: 'Shop', town: null, state: null, recceDate: null, installDate: null, geo: null,
      elements: [
        { slotNo: 1, posmTypeName: 'A', dimsInner: null, markup: null, image: { dataUrl: 'a', natW: 100, natH: 100 }, installImage: { dataUrl: 'ai', natW: 100, natH: 100 } },
        { slotNo: 2, posmTypeName: 'B', dimsInner: null, markup: null, image: { dataUrl: 'b', natW: 100, natH: 100 } },
      ],
    });
    expect(plan.elements).toHaveLength(2);
    expect(plan.elements[1].captionRect.y).toBeGreaterThan(plan.elements[0].captionRect.y);
    expect(plan.elements[1].installCaptionRect!.y).toBeGreaterThan(plan.elements[0].installCaptionRect!.y);
  });
});
