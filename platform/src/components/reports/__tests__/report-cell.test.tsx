import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportCell, StatusChip } from '../report-cell';
import type { Cell } from '@/lib/reports/outlet-execution';

const noop = () => {};

describe('ReportCell', () => {
  it('renders text verbatim, and a muted dash for blank text', () => {
    const { rerender } = render(<ReportCell cell={{ t: 'text', v: 'Mumbai' }} label="Town" onOpenPhoto={noop} />);
    expect(screen.getByText('Mumbai')).toBeInTheDocument();

    rerender(<ReportCell cell={{ t: 'text', v: '' }} label="Town" onOpenPhoto={noop} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders an empty cell as a muted dash', () => {
    render(<ReportCell cell={{ t: 'empty' }} label="X" onOpenPhoto={noop} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a status cell as a chip with its label', () => {
    render(<ReportCell cell={{ t: 'status', v: 'Approved', tone: 'approved' }} label="Recce Status" onOpenPhoto={noop} />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('renders a photo thumbnail with the proxied /api src and fires onOpenPhoto on click', () => {
    const onOpen = vi.fn();
    const cell: Cell = { t: 'photo', key: 'k1', viewPath: '/media/view?key=k1' };
    // The column label carries an "Image" suffix; the alt collapses it to a single "photo" word.
    render(<ReportCell cell={cell} label="Element 1 Image" onOpenPhoto={onOpen} />);

    const img = screen.getByRole('img', { name: 'Element 1 photo' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/media/view?key=k1');
    expect(img.getAttribute('loading')).toBe('lazy');

    fireEvent.click(screen.getByRole('button', { name: /open element 1 photo/i }));
    expect(onOpen).toHaveBeenCalledWith('/api/media/view?key=k1', 'Element 1 photo');
  });

  it('threads the outlet identity into the photo alt/aria (and never doubles "Image photo")', () => {
    const onOpen = vi.fn();
    const cell: Cell = { t: 'photo', key: 'k1', viewPath: '/media/view?key=k1' };
    render(
      <ReportCell cell={cell} label="Element 1 Image" outlet="Kalyan Mega Mart" onOpenPhoto={onOpen} />,
    );
    // Single "photo", no "Image photo" doubling, with the outlet appended for screen-reader context.
    expect(screen.getByRole('img', { name: 'Element 1 photo — Kalyan Mega Mart' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Element 1 photo — Kalyan Mega Mart' }));
    expect(onOpen).toHaveBeenCalledWith('/api/media/view?key=k1', 'Element 1 photo — Kalyan Mega Mart');
  });

  it('draws the element-placement box over a recce photo (natural aspect) and forwards markup to onOpenPhoto', () => {
    const onOpen = vi.fn();
    const markup = { version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.25 }] };
    const cell: Cell = { t: 'photo', key: 'r1', viewPath: '/media/view?key=r1', markup };
    const { container } = render(<ReportCell cell={cell} label="Element 1 Image" onOpenPhoto={onOpen} />);

    // The MarkupOverlay SVG (with its rect) is drawn over the thumbnail.
    const rect = container.querySelector('svg[aria-hidden="true"] rect');
    expect(rect).toBeInTheDocument();
    // The image renders at natural aspect so the 0..1 overlay aligns (block h-auto w-full contract).
    const img = screen.getByRole('img', { name: 'Element 1 photo' }) as HTMLImageElement;
    expect(img.className).toContain('h-auto');
    expect(img.className).toContain('w-full');

    // Clicking forwards the markup (3rd arg) so the lightbox shows the same box.
    fireEvent.click(screen.getByRole('button', { name: /open element 1 photo/i }));
    expect(onOpen).toHaveBeenCalledWith('/api/media/view?key=r1', 'Element 1 photo', markup);
  });

  it('draws NO box and keeps the object-cover thumbnail for a photo without markup (install / un-annotated)', () => {
    const onOpen = vi.fn();
    const cell: Cell = { t: 'photo', key: 'i1', viewPath: '/media/view?key=i1' };
    const { container } = render(<ReportCell cell={cell} label="Element 1 Install Image" onOpenPhoto={onOpen} />);
    // No geo pin and no markup → no SVG at all, and the thumbnail stays object-cover.
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'Element 1 Install photo' }) as HTMLImageElement;
    expect(img.className).toContain('object-cover');
    // Called with just (src, alt) — no 3rd markup arg when there is nothing to draw.
    fireEvent.click(screen.getByRole('button', { name: /open element 1 install photo/i }));
    expect(onOpen).toHaveBeenCalledWith('/api/media/view?key=i1', 'Element 1 Install photo');
  });

  it('shows a Google Maps GPS link only when the photo cell is geotagged', () => {
    const geo: Cell = { t: 'photo', key: 'k', viewPath: '/media/view?key=k', lat: 19.1, lng: 72.8 };
    const { rerender } = render(<ReportCell cell={geo} label="Photo" onOpenPhoto={noop} />);
    const link = screen.getByRole('link', { name: /location in google maps/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps?q=19.1,72.8');
    expect(link.getAttribute('target')).toBe('_blank');

    rerender(<ReportCell cell={{ t: 'photo', key: 'k', viewPath: '/media/view?key=k' }} label="Photo" onOpenPhoto={noop} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('maps a legacy /v1 view-path onto the /api proxy surface', () => {
    render(<ReportCell cell={{ t: 'photo', key: 'k', viewPath: '/v1/media/view?key=k' }} label="P" onOpenPhoto={noop} />);
    const img = screen.getByRole('img', { name: 'P photo' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/media/view?key=k');
  });
});

describe('StatusChip', () => {
  it('falls back to neutral styling for an unknown tone', () => {
    // @ts-expect-error — exercising the defensive fallback path with an off-contract tone
    render(<StatusChip label="Odd" tone="chartreuse" />);
    expect(screen.getByText('Odd')).toBeInTheDocument();
  });
});
