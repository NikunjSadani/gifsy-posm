import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MetricDrilldownSheet } from '../metric-drilldown-sheet';
import type { ApprovalRecord } from '@/lib/review/api';

afterEach(cleanup);

const ITEMS: ApprovalRecord[] = [
  {
    id: 'o1',
    outletCode: 'KW-1',
    outletName: 'Shop One',
    town: 'Pune',
    recceId: 'rec1',
    status: 'APPROVED',
    recceDate: '2026-10-20T06:30:00.000Z',
    vendorName: 'Vendor One',
    elementSummary: 'Glow Sign Board, Banner',
    dimensions: '4 × 3 ft',
    statusLabel: 'HO approved',
  },
  {
    id: 'o2',
    outletCode: 'KW-2',
    outletName: 'Shop Two',
    town: null,
    recceId: null,
    status: null,
    recceDate: null,
    vendorName: null,
    elementSummary: null,
    dimensions: null,
    statusLabel: 'Not started',
  },
];

const PAGE = {
  items: ITEMS,
  byElementType: [
    { code: 'GSB', name: 'GSB', count: 5 },
    { code: 'STD', name: 'Standard Board', count: 12 },
  ],
  total: 2,
};

function successFetcher() {
  return vi.fn().mockResolvedValue({ success: true, data: PAGE });
}

const href = (i: ApprovalRecord) => (i.recceId ? `/review/recces/${i.recceId}` : null);

describe('MetricDrilldownSheet', () => {
  it('renders nothing when closed', () => {
    render(<MetricDrilldownSheet open={false} title="Recce" onClose={() => {}} fetcher={successFetcher()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('loads on open and lists outlet records with code, town and the human status label', async () => {
    render(<MetricDrilldownSheet open title="Recce" onClose={() => {}} fetcher={successFetcher()} onItemHref={href} />);
    expect(await screen.findByText('Shop One')).toBeInTheDocument();
    expect(screen.getByText('KW-1')).toBeInTheDocument();
    expect(screen.getByText('Pune')).toBeInTheDocument();
    // The chip shows the HUMAN lifecycle label, not the raw enum.
    expect(screen.getByText('HO approved')).toBeInTheDocument();
    expect(screen.queryByText('APPROVED')).toBeNull();
    // Server-wide total in the header.
    expect(screen.getByText('2 records')).toBeInTheDocument();
  });

  it('renders the enriched per-record detail: vendor, capture date, elements and W×H', async () => {
    render(<MetricDrilldownSheet open title="Recce" onClose={() => {}} fetcher={successFetcher()} onItemHref={href} />);
    await screen.findByText('Shop One');
    expect(screen.getByText('Vendor One')).toBeInTheDocument();
    expect(screen.getByText('Glow Sign Board, Banner')).toBeInTheDocument();
    expect(screen.getByText('4 × 3 ft')).toBeInTheDocument();
    // The capture date is rendered as a short, locale date (day + short month + year).
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    // The second row carries the neutral "Not started" label.
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('shows an Export Excel button when exportHref is set and there are records', async () => {
    render(
      <MetricDrilldownSheet
        open
        title="Recce"
        onClose={() => {}}
        fetcher={successFetcher()}
        exportHref="/api/analytics/drilldown.xlsx?metric=recce"
      />,
    );
    await screen.findByText('Shop One');
    const link = screen.getByRole('link', { name: /export these records to excel/i });
    expect(link).toHaveAttribute('href', '/api/analytics/drilldown.xlsx?metric=recce');
    expect(link).toHaveAttribute('download');
  });

  it('hides the Export button when there are no records', async () => {
    const fetcher = vi.fn().mockResolvedValue({ success: true, data: { items: [], byElementType: [], total: 0 } });
    render(
      <MetricDrilldownSheet open title="Installed" onClose={() => {}} fetcher={fetcher} exportHref="/api/analytics/drilldown.xlsx?metric=installed" />,
    );
    await screen.findByText('No records');
    expect(screen.queryByRole('link', { name: /export these records to excel/i })).toBeNull();
  });

  it('renders the byElementType breakdown above the list', async () => {
    render(<MetricDrilldownSheet open title="Recce" onClose={() => {}} fetcher={successFetcher()} />);
    expect(await screen.findByText('GSB')).toBeInTheDocument();
    expect(screen.getByText('Standard Board')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('links a recce-backed row and leaves a non-recce row plain', async () => {
    render(<MetricDrilldownSheet open title="Recce" onClose={() => {}} fetcher={successFetcher()} onItemHref={href} />);
    await screen.findByText('Shop One');
    expect(screen.getByText('Shop One').closest('a')).toHaveAttribute('href', '/review/recces/rec1');
    expect(screen.getByText('Shop Two').closest('a')).toBeNull();
  });

  it('shows an empty state when there are no records', async () => {
    const fetcher = vi.fn().mockResolvedValue({ success: true, data: { items: [], byElementType: [], total: 0 } });
    render(<MetricDrilldownSheet open title="Installed" onClose={() => {}} fetcher={fetcher} />);
    expect(await screen.findByText('No records')).toBeInTheDocument();
  });

  it('shows an error state and retries on demand', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Boom' })
      .mockResolvedValueOnce({ success: true, data: PAGE });
    render(<MetricDrilldownSheet open title="Recce" onClose={() => {}} fetcher={fetcher} onItemHref={href} />);
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText('Shop One')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<MetricDrilldownSheet open title="Recce" onClose={onClose} fetcher={successFetcher()} />);
    await screen.findByText('Shop One');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
