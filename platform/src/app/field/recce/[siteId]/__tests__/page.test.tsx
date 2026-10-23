import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const push = vi.fn();
const back = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace }),
  // Resubmit is reached from "Recce to do" with ?recceId=… — mirror that here.
  useSearchParams: () => ({ get: (k: string) => (k === 'recceId' ? 'rec-1' : null) }),
}));

const apiGet = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: { get: (url: string) => apiGet(url), post: vi.fn() },
}));

import ReccePage from '../page';

const SITE_ID = 'site-9';

// The original REJECTED recce the rep is re-capturing — one GSB posm at 4 × 2.5 ft.
const RECCE_DETAIL = {
  id: 'rec-1',
  status: 'REJECTED',
  hoReviewStatus: 'NONE',
  version: 1,
  site: { id: SITE_ID, code: 'S9', name: 'Outlet 9', town: 'Town', lat: null, lng: null },
  submittedBy: { id: 'u1', name: 'Rep' },
  capturedAt: null,
  receivedAt: '2026-01-01T00:00:00.000Z',
  rejectionReasonCode: 'BLURRY',
  rejectionReason: null,
  hoRejectionReasonCode: null,
  hoRejectionReason: null,
  posms: [
    {
      id: 'p1',
      slotNo: 1,
      posmType: { id: 'gsb', code: 'GSB', name: 'Glow Sign Board' },
      dimensions: { width: 4, height: 2.5, unit: 'ft' },
      photo: null,
      markup: null,
    },
  ],
};

beforeEach(() => {
  push.mockClear();
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/api/posm-types')) {
      return Promise.resolve({
        success: true,
        data: [
          { id: 'gsb', code: 'GSB', name: 'Glow Sign Board', isActive: true },
          { id: 'poster', code: 'PST', name: 'Poster', isActive: true },
        ],
      });
    }
    if (url.startsWith('/api/sites/')) {
      return Promise.resolve({ success: true, data: { gsbAllowed: true } });
    }
    if (url.startsWith('/api/recce/')) {
      return Promise.resolve({ success: true, data: RECCE_DETAIL });
    }
    return Promise.resolve({ success: true, data: { recces: [], total: 0, page: 1, limit: 200 } });
  });
});

afterEach(cleanup);

describe('ReccePage — resubmit of a REJECTED recce', () => {
  it('seeds one locked card per original posm from existing.posms and fixes the set (no add)', async () => {
    // `use(params)` suspends until the params promise resolves — flush that inside act so the
    // inner page (and its load effects) mount before we query.
    await act(async () => {
      render(<ReccePage params={Promise.resolve({ siteId: SITE_ID })} />);
    });

    // Resolves to resubmit mode.
    expect(await screen.findByText('Re-capture recce')).toBeInTheDocument();

    // Exactly one card, locked + seeded from the original posm's type + dimensions.
    const lockedType = await screen.findByTestId('posm-type-locked-1');
    expect(lockedType).toHaveTextContent('Glow Sign Board (GSB)');
    expect(screen.getByTestId('posm-width-locked-1')).toHaveTextContent('4 ft');
    expect(screen.getByTestId('posm-height-locked-1')).toHaveTextContent('2.5 ft');
    expect(screen.queryByTestId('posm-type-locked-2')).toBeNull();

    // The element set is fixed on resubmit: no editable picker, no "Add second Element".
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Add second Element')).toBeNull();
  });
});
