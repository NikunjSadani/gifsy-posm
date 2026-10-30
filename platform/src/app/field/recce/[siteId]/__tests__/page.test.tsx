import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const push = vi.fn();
const back = vi.fn();
const replace = vi.fn();

// Mutable so a test can drive the ?recceId path (explicit id) vs the for-site resolver path (none).
let recceIdValue: string | null = 'rec-1';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back, replace }),
  // Resubmit is reached from "Recce to do" with ?recceId=… — mirror that here.
  useSearchParams: () => ({ get: (k: string) => (k === 'recceId' ? recceIdValue : null) }),
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
  recceIdValue = 'rec-1';
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
    // The for-site resolver must be matched BEFORE the generic by-id branch (both start with
    // `/api/recce/`). Default: no rejected recce to resolve (the ?recceId path owns these tests).
    if (url.startsWith('/api/recce/for-site/')) {
      return Promise.resolve({ success: true, data: { recce: null } });
    }
    if (url.startsWith('/api/recce/')) {
      return Promise.resolve({ success: true, data: RECCE_DETAIL });
    }
    return Promise.resolve({ success: true, data: { recces: [], total: 0, page: 1, limit: 200 } });
  });
});

afterEach(cleanup);

describe('ReccePage — resubmit of a REJECTED recce', () => {
  it('pre-fills one EDITABLE card per original posm and fixes the count (no add)', async () => {
    // `use(params)` suspends until the params promise resolves — flush that inside act so the
    // inner page (and its load effects) mount before we query.
    await act(async () => {
      render(<ReccePage params={Promise.resolve({ siteId: SITE_ID })} />);
    });

    // Resolves to resubmit mode.
    expect(await screen.findByText('Re-capture recce')).toBeInTheDocument();

    // Exactly one card, PRE-FILLED (not locked) from the original posm's type + dimensions — the
    // element picker + W×H inputs are editable and seeded.
    const selects = await screen.findAllByRole('combobox');
    expect(selects).toHaveLength(1);
    expect((selects[0] as HTMLSelectElement).value).toBe('gsb');
    expect((screen.getByPlaceholderText('Width') as HTMLInputElement).value).toBe('4');
    expect((screen.getByPlaceholderText('Height') as HTMLInputElement).value).toBe('2.5');

    // No locked read-only presentation, and the COUNT is fixed on resubmit (no "Add second Element").
    expect(screen.queryByTestId('posm-type-locked-1')).toBeNull();
    expect(screen.queryByText('Add second Element')).toBeNull();
  });
});

describe('ReccePage — for-site resolver (no ?recceId)', () => {
  it('resolves the rejected recce to resubmit even when a NEWER non-rejected recce exists', async () => {
    recceIdValue = null; // reached via "Start recce" (no explicit id) → precedence falls to the resolver

    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/api/posm-types')) {
        return Promise.resolve({
          success: true,
          data: [{ id: 'gsb', code: 'GSB', name: 'Glow Sign Board', isActive: true }],
        });
      }
      if (url.startsWith('/api/sites/')) {
        return Promise.resolve({ success: true, data: { gsbAllowed: true } });
      }
      // The resolver returns the REJECTED recce this user may resubmit for the site.
      if (url.startsWith('/api/recce/for-site/')) {
        return Promise.resolve({ success: true, data: { recce: RECCE_DETAIL } });
      }
      // The flat list carries a NEWER, non-rejected (SUBMITTED) recce for the same site — a plain
      // newest-wins lookup would resolve THIS and wrongly block. The resolver must win instead.
      return Promise.resolve({
        success: true,
        data: {
          recces: [
            { id: 'rec-2', status: 'SUBMITTED', recceMode: 'APP', site: { id: SITE_ID, code: 'S9', name: 'Outlet 9', town: 'Town' } },
          ],
          total: 1,
          page: 1,
          limit: 200,
        },
      });
    });

    await act(async () => {
      render(<ReccePage params={Promise.resolve({ siteId: SITE_ID })} />);
    });

    // Resubmit (not blocked) — the resolver's rejected recce won over the newer submitted one.
    expect(await screen.findByText('Re-capture recce')).toBeInTheDocument();
    expect((await screen.findByRole('combobox') as HTMLSelectElement).value).toBe('gsb'); // pre-filled, editable
    expect(screen.queryByText(/already has a/i)).toBeNull(); // not the blocked state
  });
});
