import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const push = vi.fn();
const replace = vi.fn();
// A STABLE router object: MyWorkPage's filter-gate effect depends on `[router]`, so a fresh object
// per render would re-run it forever (setOutlet → re-render → new router → …) and OOM the worker.
const routerObj = { push, replace };

vi.mock('next/navigation', () => ({
  useRouter: () => routerObj,
}));

// next/link → a plain anchor so we can assert the Re-capture href without a router provider.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// A device filter is always present here (the redirect-when-none path is out of scope for this test).
vi.mock('@/lib/field/outlet-filter', () => ({
  getOutletFilter: () => ({ rsCode: 'RS1', beatNames: [] }),
  beatSummary: () => 'All beats',
}));

const apiGet = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: { get: (url: string) => apiGet(url), post: vi.fn() },
}));

import MyWorkPage from '../page';

type Row = Record<string, unknown>;

/** Minimal recce-list row for the work-screen grouping. */
function row(partial: Row & { id: string; status: string; recceMode: string }): Row {
  return {
    hoReviewStatus: 'NONE',
    version: 1,
    site: { id: `site-${partial.id}`, code: `C${partial.id}`, name: `Site ${partial.id}`, town: null },
    posmCount: 1,
    geoFenceOk: true,
    distanceMeters: 0,
    capturedAt: null,
    receivedAt: '2026-01-01T00:00:00.000Z',
    rejectionReasonCode: null,
    hoRejectionReasonCode: null,
    ...partial,
  };
}

const APP_REJECTED = row({
  id: 'app-rej',
  status: 'REJECTED',
  recceMode: 'APP',
  site: { id: 'site-app', code: 'CAPP', name: 'App Rejected Outlet', town: null },
});
const MANUAL_REJECTED = row({
  id: 'man-rej',
  status: 'REJECTED',
  recceMode: 'MANUAL',
  rejectionReasonCode: 'BLURRY',
  site: { id: 'site-man', code: 'CMAN', name: 'Manual Rejected Outlet', town: null },
});

beforeEach(() => {
  push.mockClear();
  apiGet.mockReset();
  // The page fetches the APP recces (rsCode filter) and the exec's MANUAL recces separately.
  apiGet.mockImplementation((url: string) => {
    const recces = url.includes('recceMode=MANUAL') ? [MANUAL_REJECTED] : [APP_REJECTED];
    return Promise.resolve({ success: true, data: { recces, total: recces.length, page: 1, limit: 200 } });
  });
});

afterEach(cleanup);

describe('MyWorkPage — rejected re-capture surfacing', () => {
  it('shows a Re-capture entry for a MANUAL reject and NOT for an APP reject', async () => {
    await act(async () => {
      render(<MyWorkPage />);
    });

    // The 'Needs re-capture' group surfaces (as the section heading + the card's status chip).
    expect((await screen.findAllByText('Needs re-capture')).length).toBeGreaterThan(0);

    // ... with exactly one Re-capture action, pointing at the recce page with the manual recce's id.
    const links = await screen.findAllByRole('link', { name: /Re-capture/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/field/recce/site-man?recceId=man-rej');

    // The MANUAL outlet is shown; the APP-rejected outlet is NOT on this screen (it lives in Recce to do).
    expect(screen.getByText('Manual Rejected Outlet')).toBeInTheDocument();
    expect(screen.queryByText('App Rejected Outlet')).toBeNull();
  });

  it('shows no re-capture entry when the only rejects are APP recces', async () => {
    apiGet.mockImplementation((url: string) => {
      // MANUAL fetch returns nothing; the APP fetch returns an APP-rejected recce (filtered out here).
      const recces = url.includes('recceMode=MANUAL') ? [] : [APP_REJECTED];
      return Promise.resolve({ success: true, data: { recces, total: recces.length, page: 1, limit: 200 } });
    });

    await act(async () => {
      render(<MyWorkPage />);
    });

    // Wait for the load to settle (the filter chip renders once the device filter is read), then
    // assert there is no re-capture surface for an APP-only set of rejects.
    expect(await screen.findByTestId('work-filter-chip')).toBeInTheDocument();
    expect(screen.queryByText('Needs re-capture')).toBeNull();
    expect(screen.queryByRole('link', { name: /Re-capture/i })).toBeNull();
  });
});
