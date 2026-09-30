import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MarkupOverlay } from '../markup-overlay';
import { buildMarkup, rectToPercentStyle } from '@/lib/markup';

afterEach(cleanup);

/** Count the highlight boxes = the overlay layer's direct children (one per shape). */
function boxCount(container: HTMLElement): number {
  const layer = container.querySelector('[aria-hidden="true"]');
  return layer ? layer.children.length : 0;
}

describe('MarkupOverlay', () => {
  it('renders one box per shape for a valid markup', () => {
    const markup = buildMarkup([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.5, y: 0.5, w: 0.3, h: 0.25 },
      { x: 0.05, y: 0.6, w: 0.1, h: 0.1 },
    ]);
    const { container } = render(<MarkupOverlay markup={markup} />);
    expect(boxCount(container)).toBe(3);
    // Each box carries a "POSM" label chip.
    expect(container.querySelectorAll('span').length).toBe(3);
  });

  it('renders nothing (null) when there is no markup', () => {
    const { container } = render(<MarkupOverlay markup={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('degrades to null for garbage / legacy values rather than crashing', () => {
    for (const bad of ['nonsense', 42, {}, { version: 2, shapes: [] }, { version: 1, shapes: 'x' }]) {
      const { container } = render(<MarkupOverlay markup={bad as unknown} />);
      expect(container.firstChild).toBeNull();
      cleanup();
    }
  });

  it('positions each box with the shared percent-style contract', () => {
    const markup = buildMarkup([{ x: 0.25, y: 0.5, w: 0.4, h: 0.1 }])!;
    const { container } = render(<MarkupOverlay markup={markup} />);
    const box = container.querySelector('[aria-hidden="true"]')!.firstElementChild as HTMLElement;
    const expected = rectToPercentStyle(markup.shapes[0]);
    // jsdom normalises percent strings (25.000% → 25%), so compare numeric % values.
    const pct = (v: string) => parseFloat(v);
    expect(box.style.left).toContain('%');
    expect(pct(box.style.left)).toBeCloseTo(pct(expected.left), 3);
    expect(pct(box.style.top)).toBeCloseTo(pct(expected.top), 3);
    expect(pct(box.style.width)).toBeCloseTo(pct(expected.width), 3);
    expect(pct(box.style.height)).toBeCloseTo(pct(expected.height), 3);
  });
});
