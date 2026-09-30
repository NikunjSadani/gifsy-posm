import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MarkupOverlay } from '../markup-overlay';
import { buildMarkup } from '@/lib/markup';

afterEach(cleanup);

describe('MarkupOverlay', () => {
  it('renders one SVG shape per markup shape (rects + paths)', () => {
    const markup = buildMarkup([
      { type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { type: 'rect', x: 0.5, y: 0.5, w: 0.3, h: 0.25 },
      { type: 'path', points: [{ x: 0.05, y: 0.6 }, { x: 0.3, y: 0.7 }, { x: 0.4, y: 0.5 }] },
    ]);
    const { container } = render(<MarkupOverlay markup={markup} />);
    const svg = container.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('rect').length).toBe(2);
    expect(svg.querySelectorAll('polyline').length).toBe(1);
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

  it('positions a rect in the 0..100 viewBox space', () => {
    const markup = buildMarkup([{ type: 'rect', x: 0.25, y: 0.5, w: 0.4, h: 0.1 }])!;
    const { container } = render(<MarkupOverlay markup={markup} />);
    const rect = container.querySelector('rect')!;
    const num = (a: string) => parseFloat(rect.getAttribute(a)!);
    expect(num('x')).toBeCloseTo(25, 3);
    expect(num('y')).toBeCloseTo(50, 3);
    expect(num('width')).toBeCloseTo(40, 3);
    expect(num('height')).toBeCloseTo(10, 3);
  });

  it('renders a legacy type-less rect (back-compat)', () => {
    const { container } = render(
      <MarkupOverlay markup={{ version: 1, shapes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }} />,
    );
    expect(container.querySelectorAll('rect').length).toBe(1);
  });
});
