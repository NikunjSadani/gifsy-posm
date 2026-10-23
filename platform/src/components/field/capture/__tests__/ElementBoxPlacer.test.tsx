import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { ElementBoxPlacer } from '../ElementBoxPlacer';

afterEach(cleanup);

// jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX/clientY and the hit-test
// could never see a real coordinate. Polyfill it on top of MouseEvent (which carries the mouse
// coords + button) so the pointer→normalised mapping gets exercised exactly as in a browser.
beforeAll(() => {
  if (typeof (globalThis as unknown as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? '';
      }
    }
    (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
  }
});

/**
 * Regression for the "cannot drag/move the Element box" bug.
 *
 * The box is seeded, resize works, but a BODY drag did nothing on real pointer/touch drags.
 * Root cause: the move branch read the mutable drag ref (`d.last`) INSIDE the setRect updater,
 * which React runs in the render phase — i.e. AFTER the handler already advanced `d.last` to the
 * current point. So every per-move delta collapsed to zero and the box never translated.
 *
 * This test drives the real event path (pointerdown on the body → pointermove → pointerup) and
 * asserts the box actually translated. On the pre-fix code the box stays put and this FAILS.
 */

const IMG_BOX = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 };

function renderPlacer() {
  const onSave = vi.fn();
  const utils = render(
    <ElementBoxPlacer imageUrl="data:," width={1} height={1} onSave={onSave} onCancel={vi.fn()} />,
  );
  const img = utils.container.querySelector('img') as HTMLImageElement;
  // jsdom returns a zero rect; give the image a measurable content box so the pointer↔normalised
  // mapping (and the seed) have a real frame to work against.
  img.getBoundingClientRect = () => IMG_BOX as DOMRect;
  // Seed the default centred box (square image, square element → covers 0.25..0.75).
  act(() => {
    fireEvent.load(img);
  });
  const box = utils.container.querySelector('.absolute.rounded-sm') as HTMLElement;
  return { ...utils, img, box, onSave };
}

function pct(v: string | undefined): number {
  return parseFloat((v ?? '').replace('%', ''));
}

describe('ElementBoxPlacer — drag to move', () => {
  it('seeds a centred box', () => {
    const { box } = renderPlacer();
    expect(box).toBeTruthy();
    expect(pct(box.style.left)).toBeCloseTo(25, 1);
    expect(pct(box.style.top)).toBeCloseTo(25, 1);
  });

  it('BODY drag translates the box by the pointer delta (size preserved)', () => {
    const { box } = renderPlacer();
    const w0 = pct(box.style.width);
    const h0 = pct(box.style.height);

    // Press inside the body (centre ≈ 50,50 → norm 0.5,0.5), drag up-left to (30,30) → norm 0.3,0.3.
    act(() => {
      fireEvent.pointerDown(box, { clientX: 50, clientY: 50, button: 0, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerMove(box, { clientX: 40, clientY: 40, button: 0, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerMove(box, { clientX: 30, clientY: 30, button: 0, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerUp(box, { clientX: 30, clientY: 30, button: 0, pointerId: 1, pointerType: 'touch' });
    });

    // Moved up-left by 0.20 in each axis: 25% → 5%.
    expect(pct(box.style.left)).toBeCloseTo(5, 1);
    expect(pct(box.style.top)).toBeCloseTo(5, 1);
    // Size unchanged by a move.
    expect(pct(box.style.width)).toBeCloseTo(w0, 1);
    expect(pct(box.style.height)).toBeCloseTo(h0, 1);
  });

  it('a press OUTSIDE the box does not start a move', () => {
    const { box } = renderPlacer();
    const left0 = pct(box.style.left);
    act(() => {
      // (5,5) → norm 0.05,0.05 is outside the 0.25..0.75 box.
      fireEvent.pointerDown(box, { clientX: 5, clientY: 5, button: 0, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerMove(box, { clientX: 20, clientY: 20, button: 0, pointerId: 1, pointerType: 'touch' });
      fireEvent.pointerUp(box, { clientX: 20, clientY: 20, button: 0, pointerId: 1, pointerType: 'touch' });
    });
    expect(pct(box.style.left)).toBeCloseTo(left0, 1);
  });
});
