import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MetricDrilldownSheet } from '../metric-drilldown-sheet';
import type { ApprovalRecord } from '@/lib/review/api';

afterEach(cleanup);

const ITEMS: ApprovalRecord[] = [
  { id: 'o1', outletCode: 'KW-1', outletName: 'Shop One', town: 'Pune', recceId: 'rec1', status: 'APPROVED' },
  { id: 'o2', outletCode: 'KW-2', outletName: 'Shop Two', town: null, recceId: null, status: null },
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

  it('loads on open and lists outlet records with code, town and status', async () => {
    render(<MetricDrilldownSheet open title="Recce" onClose={() => {}} fetcher={successFetcher()} onItemHref={href} />);
    expect(await screen.findByText('Shop One')).toBeInTheDocument();
    expect(screen.getByText('KW-1')).toBeInTheDocument();
    expect(screen.getByText('Pune')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    // Server-wide total in the header.
    expect(screen.getByText('2 records')).toBeInTheDocument();
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
