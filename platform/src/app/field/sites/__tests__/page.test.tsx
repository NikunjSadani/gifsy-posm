import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// A controllable device fix: tests flip `geoState.coords` before rendering. useGeo is the ONLY
// geolocation path — the page reuses it, so mocking it here fully controls the sort.
const { geoState } = vi.hoisted(() => ({
  geoState: { coords: null as null | { lat: number; lng: number } },
}));
vi.mock('@/lib/field/geo', () => ({
  useGeo: () => ({
    coords: geoState.coords ? { ...geoState.coords, capturedAt: '2026-01-01T00:00:00.000Z' } : null,
    loading: false,
    error: null,
    capture: () => Promise.resolve({ lat: 0, lng: 0, capturedAt: '2026-01-01T00:00:00.000Z' }),
  }),
}));

// SiteSheet (always mounted by the page) reads useRouter — give it a mounted stub.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// A saved per-device RS filter is present so the list renders without interaction.
vi.mock('@/lib/field/outlet-filter', () => ({
  getOutletFilter: () => ({ rsCode: 'RS1', beatNames: [] }),
  setOutletFilter: vi.fn(),
  clearOutletFilter: vi.fn(),
}));

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { get: (u: string) => apiGet(u), post: vi.fn() } }));

import SitesPage from '../page';

// Three outlets, returned in A→B→C order. B = Mumbai (the fix), C = Pune (~120 km), A = Delhi (~1150 km).
const SITES = [
  { id: 'a', code: 'OUT-A', name: 'Aaa Store', town: 'Delhi', status: 'ACTIVE', lat: 28.6139, lng: 77.209, phone: null, rsCode: 'RS1', rsName: 'RS One', beatName: null, pincode: null, vendorId: null, asmUserId: null, gsbAllowed: false },
  { id: 'b', code: 'OUT-B', name: 'Bbb Store', town: 'Mumbai', status: 'ACTIVE', lat: 19.076, lng: 72.8777, phone: null, rsCode: 'RS1', rsName: 'RS One', beatName: null, pincode: null, vendorId: null, asmUserId: null, gsbAllowed: false },
  { id: 'c', code: 'OUT-C', name: 'Ccc Store', town: 'Pune', status: 'ACTIVE', lat: 18.5204, lng: 73.8567, phone: null, rsCode: 'RS1', rsName: 'RS One', beatName: null, pincode: null, vendorId: null, asmUserId: null, gsbAllowed: false },
];

beforeEach(() => {
  geoState.coords = null;
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url.includes('/filter-options/rs-codes'))
      return Promise.resolve({ success: true, data: { rsCodes: [{ code: 'RS1', name: 'RS One' }] } });
    if (url.includes('/filter-options/beats'))
      return Promise.resolve({ success: true, data: { beats: [] } });
    // The sites list — single full-coverage page (3 < page size → fetchAllSites stops after one call).
    return Promise.resolve({ success: true, data: { sites: SITES, total: SITES.length, page: 1, limit: 200 } });
  });
});

afterEach(cleanup);

/** Rendered outlet codes in DOM order (getAllByText returns document order). */
const renderedOrder = () => screen.getAllByText(/^OUT-[ABC]$/).map((e) => e.textContent);

describe('SitesPage — distance sort', () => {
  it('NO fix: list renders in its original order and offers a use-my-location retry', async () => {
    await act(async () => {
      render(<SitesPage />);
    });
    // All three outlets rendered (load-all), untouched order, and an ACTIONABLE location retry
    // (the page supplies onRetryLocation, so the plain hint becomes a tappable button).
    expect(await screen.findByText('Aaa Store')).toBeInTheDocument();
    expect(renderedOrder()).toEqual(['OUT-A', 'OUT-B', 'OUT-C']);
    expect(screen.getByTestId('sort-geo-retry')).toHaveTextContent('Use my location to sort by distance');
  });

  it('WITH a fix: default Nearest ranks outlets nearest-first (no hint)', async () => {
    geoState.coords = { lat: 19.076, lng: 72.8777 }; // Mumbai — B is at the fix
    await act(async () => {
      render(<SitesPage />);
    });
    expect(await screen.findByText('Bbb Store')).toBeInTheDocument();
    // Nearest-first: B (0 km) → C (~120 km) → A (~1150 km).
    expect(renderedOrder()).toEqual(['OUT-B', 'OUT-C', 'OUT-A']);
    expect(screen.queryByTestId('sort-geo-hint')).toBeNull();
    // Distance chips are shown on the cards when a fix exists (C ~120 km, A ~1150 km).
    expect(screen.getAllByText(/km$/).length).toBeGreaterThanOrEqual(2);
  });
});
