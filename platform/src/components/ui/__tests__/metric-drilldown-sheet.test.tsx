import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MetricDrilldownSheet, type DrilldownPage } from '../metric-drilldown-sheet';
import type { ApprovalRecord } from '@/lib/review/api';
import type { ApiResponse } from '@/lib/api-client';

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

// A compact record factory for the pagination tests (unique id → unique outlet name).
const rec = (id: string): ApprovalRecord => ({
  id,
  outletCode: id,
  outletName: `Shop ${id}`,
  town: 'Pune',
  recceId: null,
  status: 'APPROVED',
  recceDate: null,
  vendorName: null,
  elementSummary: null,
  dimensions: null,
  statusLabel: 'HO approved',
});

describe('MetricDrilldownSheet — keyset pagination', () => {
  it('loads the next page by afterId cursor, appends without duplicates, stops at total, and does not re-sum byElementType', async () => {
    const fetcher = vi.fn((afterId?: string) =>
      Promise.resolve({
        success: true as const,
        data:
          afterId === undefined
            ? { items: [rec('r1'), rec('r2')], byElementType: [{ code: 'GSB', name: 'GSB', count: 5 }], total: 4 }
            : // page 2 carries a DIFFERENT element count to prove the sheet keeps page 1's rollup.
              { items: [rec('r3'), rec('r4')], byElementType: [{ code: 'GSB', name: 'GSB', count: 99 }], total: 4 },
      }),
    );
    render(<MetricDrilldownSheet open title="Recce" targetKey="recce" onClose={() => {}} fetcher={fetcher} />);

    // Page 1 only, with the server-wide total in the header and the page-1 element rollup (×5).
    await screen.findByText('Shop r1');
    expect(screen.getByText('Shop r2')).toBeInTheDocument();
    expect(screen.queryByText('Shop r3')).toBeNull();
    expect(screen.getByText('4 records')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    // Scroll fallback: the explicit button fetches the next page (by the last row's id) and APPENDS.
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Shop r3')).toBeInTheDocument();
    expect(screen.getByText('Shop r4')).toBeInTheDocument();
    // All four rows, each rendered exactly once (no duplicates / overlap).
    expect(screen.getAllByText(/^Shop r[1-4]$/)).toHaveLength(4);
    // Reached total → no more loading affordance.
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
    // byElementType is NOT re-summed from page 2 — still ×5, never ×99 or ×104.
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('99')).toBeNull();
    expect(screen.queryByText('104')).toBeNull();
    // First call has NO cursor; the second seeks past the last loaded id ('r2').
    expect(fetcher).toHaveBeenNthCalledWith(1);
    expect(fetcher).toHaveBeenNthCalledWith(2, 'r2');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('dedupes a repeated id across pages so a row is never rendered twice', async () => {
    const fetcher = vi.fn((afterId?: string) =>
      Promise.resolve({
        success: true as const,
        data:
          afterId === undefined
            ? { items: [rec('r1'), rec('r2')], byElementType: [], total: 3 }
            : // page 2 echoes r2 (a moved cursor row) + a genuinely new r3.
              { items: [rec('r2'), rec('r3')], byElementType: [], total: 3 },
      }),
    );
    render(<MetricDrilldownSheet open title="Recce" targetKey="recce" onClose={() => {}} fetcher={fetcher} />);
    await screen.findByText('Shop r1');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('Shop r3')).toBeInTheDocument();

    // r2 appeared on BOTH pages but renders exactly once; all three unique rows present once each.
    expect(screen.getAllByText('Shop r2')).toHaveLength(1);
    expect(screen.getAllByText(/^Shop r[1-3]$/)).toHaveLength(3);
    expect(fetcher).toHaveBeenNthCalledWith(2, 'r2');
  });

  it('does not append a stale page after the drill target changes mid-fetch', async () => {
    let resolveP2!: (v: ApiResponse<DrilldownPage>) => void;
    const fetcherA = vi.fn(
      (afterId?: string): Promise<ApiResponse<DrilldownPage>> =>
        afterId === undefined
          ? Promise.resolve({ success: true, data: { items: [rec('a1'), rec('a2')], byElementType: [], total: 4 } })
          : new Promise<ApiResponse<DrilldownPage>>((res) => {
              resolveP2 = res;
            }),
    );
    const fetcherB = vi.fn(
      (): Promise<ApiResponse<DrilldownPage>> =>
        Promise.resolve({ success: true, data: { items: [rec('b1')], byElementType: [], total: 1 } }),
    );

    const { rerender } = render(
      <MetricDrilldownSheet open title="Metric A" targetKey="A" onClose={() => {}} fetcher={fetcherA} />,
    );
    await screen.findByText('Shop a1');

    // Kick off page 2 for target A (its promise is held open).
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('Loading more…')).toBeInTheDocument();

    // Target switches before page 2 resolves → the sheet resets to target B's first page.
    rerender(<MetricDrilldownSheet open title="Metric B" targetKey="B" onClose={() => {}} fetcher={fetcherB} />);
    await screen.findByText('Shop b1');
    expect(screen.queryByText('Shop a1')).toBeNull();

    // The now-stale target-A page 2 arrives — it must be dropped, never appended to target B.
    resolveP2({ success: true, data: { items: [rec('a3'), rec('a4')], byElementType: [], total: 4 } });
    await waitFor(() => expect(screen.queryByText('Shop a3')).toBeNull());
    expect(screen.queryByText('Shop a4')).toBeNull();
    expect(screen.getByText('Shop b1')).toBeInTheDocument();
  });

  it('resets on the TARGET identity (targetKey), not the display title', async () => {
    const fetcherA = vi.fn(
      (): Promise<ApiResponse<DrilldownPage>> =>
        Promise.resolve({ success: true, data: { items: [rec('a1')], byElementType: [], total: 1 } }),
    );
    const fetcherB = vi.fn(
      (): Promise<ApiResponse<DrilldownPage>> =>
        Promise.resolve({ success: true, data: { items: [rec('b1')], byElementType: [], total: 1 } }),
    );

    const { rerender } = render(
      <MetricDrilldownSheet open title="Shared title" targetKey="A" onClose={() => {}} fetcher={fetcherA} />,
    );
    await screen.findByText('Shop a1');
    expect(fetcherA).toHaveBeenCalledTimes(1);

    // Only the DISPLAY title changes (same target A) → no reload, rows untouched.
    rerender(<MetricDrilldownSheet open title="Shared title (renamed)" targetKey="A" onClose={() => {}} fetcher={fetcherA} />);
    await waitFor(() => expect(fetcherA).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Shop a1')).toBeInTheDocument();

    // The TARGET identity changes (A → B), even with the same title → reset + refetch.
    rerender(<MetricDrilldownSheet open title="Shared title (renamed)" targetKey="B" onClose={() => {}} fetcher={fetcherB} />);
    await screen.findByText('Shop b1');
    expect(screen.queryByText('Shop a1')).toBeNull();
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  it('surfaces a "load more" error and retries the SAME cursor (not a page number)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { items: [rec('r1')], byElementType: [], total: 2 } })
      .mockResolvedValueOnce({ success: false, error: 'Network down' })
      .mockResolvedValueOnce({ success: true, data: { items: [rec('r2')], byElementType: [], total: 2 } });
    render(<MetricDrilldownSheet open title="Recce" targetKey="recce" onClose={() => {}} fetcher={fetcher} />);
    await screen.findByText('Shop r1');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText("Couldn't load more records.")).toBeInTheDocument();
    // The already-loaded page 1 row is untouched by the failed next-page fetch.
    expect(screen.getByText('Shop r1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Shop r2')).toBeInTheDocument();
    expect(fetcher).toHaveBeenNthCalledWith(2, 'r1');
    expect(fetcher).toHaveBeenNthCalledWith(3, 'r1'); // retry re-requests the same cursor
  });
});
