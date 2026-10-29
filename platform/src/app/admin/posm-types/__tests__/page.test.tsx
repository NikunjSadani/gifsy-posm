import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PosmType } from '@/lib/admin/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const { listMock, createMock, updateMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));
vi.mock('@/lib/admin/api', () => ({
  posmTypesApi: {
    list: () => listMock(),
    create: (body: unknown) => createMock(body),
    update: (id: string, body: unknown) => updateMock(id, body),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
  },
}));
vi.mock('@/lib/field/media-upload', () => ({
  uploadMedia: vi.fn(),
  mediaViewUrl: (k: string) => `/media/${k}`,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import PosmTypesPage from '../page';

// Radix Select/Dialog lean on pointer-capture + scrollIntoView, which jsdom omits.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

function makePosmType(over: Partial<PosmType> = {}): PosmType {
  return {
    id: 'pt_1',
    clientId: 'c1',
    code: 'GLOW',
    name: 'Glow Board',
    defaultDimensions: null,
    imageKey: null,
    isGsb: false,
    measurement: 'DIMENSION',
    maxAreaSqFt: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset().mockResolvedValue({ success: true, data: makePosmType() });
  updateMock.mockReset().mockResolvedValue({ success: true, data: makePosmType() });
  listMock.mockResolvedValue({ success: true, data: [] });
});
afterEach(cleanup);

async function renderPage(items: PosmType[]) {
  listMock.mockResolvedValue({ success: true, data: items });
  await act(async () => {
    render(<PosmTypesPage />);
  });
  // Wait for the initial load to settle.
  await screen.findByText('Element Types');
}

describe('PosmTypesPage — element config inputs', () => {
  it('creates a DIMENSION element carrying isGsb + measurement + dims + max size', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await renderPage([]);

    await user.click(screen.getByRole('button', { name: /new element type/i }));

    await user.type(screen.getByLabelText('Code'), 'GLOW');
    await user.type(screen.getByLabelText('Name'), 'Glow Board');
    // DIMENSION is the default, so the size inputs are present.
    await user.click(screen.getByLabelText('This is a GSB element'));
    await user.type(screen.getByLabelText('Max size (width × height, sq ft)'), '50');
    await user.type(screen.getByLabelText('Default width'), '10');
    await user.type(screen.getByLabelText('Default height'), '20');
    await user.type(screen.getByLabelText('Default dimension unit'), 'cm');

    await user.click(screen.getByRole('button', { name: /create element type/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'GLOW',
        name: 'Glow Board',
        isGsb: true,
        measurement: 'DIMENSION',
        defaultDimensions: { width: 10, height: 20, unit: 'cm' },
        maxAreaSqFt: 50,
      }),
    );
  });

  it('shows the size inputs for a DIMENSION element and hides them for a UNIT element', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const dim = makePosmType({ id: 'pt_dim', code: 'DIM', measurement: 'DIMENSION' });
    const unit = makePosmType({ id: 'pt_unit', code: 'UNIT1', name: 'Sticker', measurement: 'UNIT' });
    await renderPage([dim, unit]);

    // Edit the DIMENSION element → size inputs visible.
    const dimRow = screen.getByText('DIM').closest('tr')!;
    await user.click(within(dimRow).getByRole('button', { name: /edit/i }));
    expect(screen.getByLabelText('Max size (width × height, sq ft)')).toBeInTheDocument();
    expect(screen.getByLabelText('Default width')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    // Edit the UNIT element → size inputs absent.
    const unitRow = screen.getByText('UNIT1').closest('tr')!;
    await user.click(within(unitRow).getByRole('button', { name: /edit/i }));
    await screen.findByText('Edit Element type');
    expect(screen.queryByLabelText('Max size (width × height, sq ft)')).toBeNull();
    expect(screen.queryByLabelText('Default width')).toBeNull();
  });

  it('round-trips a UNIT element: update sends measurement UNIT with null dims + cap', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const unit = makePosmType({
      id: 'pt_unit',
      code: 'UNIT1',
      name: 'Sticker',
      measurement: 'UNIT',
      isGsb: true,
    });
    await renderPage([unit]);

    const unitRow = screen.getByText('UNIT1').closest('tr')!;
    await user.click(within(unitRow).getByRole('button', { name: /edit/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(
      'pt_unit',
      expect.objectContaining({
        measurement: 'UNIT',
        defaultDimensions: null,
        maxAreaSqFt: null,
        isGsb: true,
      }),
    );
  });

  it('switching a DIMENSION element to UNIT hides the size inputs and submits nulls', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const dim = makePosmType({
      id: 'pt_dim',
      code: 'DIM',
      measurement: 'DIMENSION',
      maxAreaSqFt: 50,
      defaultDimensions: { width: 10, height: 20, unit: 'cm' },
    });
    await renderPage([dim]);

    const dimRow = screen.getByText('DIM').closest('tr')!;
    await user.click(within(dimRow).getByRole('button', { name: /edit/i }));
    // Size inputs are present initially (DIMENSION).
    expect(screen.getByLabelText('Max size (width × height, sq ft)')).toBeInTheDocument();

    // Drive the Measurement select → Unit-based.
    await user.click(screen.getByRole('combobox', { name: 'Measurement' }));
    await user.click(await screen.findByRole('option', { name: 'Unit-based' }));

    // Size inputs vanish once UNIT is selected.
    await waitFor(() =>
      expect(screen.queryByLabelText('Max size (width × height, sq ft)')).toBeNull(),
    );
    expect(screen.queryByLabelText('Default width')).toBeNull();

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(
      'pt_dim',
      expect.objectContaining({
        measurement: 'UNIT',
        defaultDimensions: null,
        maxAreaSqFt: null,
      }),
    );
  });

  it('blocks submit when maxAreaSqFt is not a positive number', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await renderPage([]);

    await user.click(screen.getByRole('button', { name: /new element type/i }));
    await user.type(screen.getByLabelText('Code'), 'GLOW');
    await user.type(screen.getByLabelText('Name'), 'Glow Board');
    await user.type(screen.getByLabelText('Max size (width × height, sq ft)'), '-5');
    await user.click(screen.getByRole('button', { name: /create element type/i }));

    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByText('Max size must be a positive number')).toBeInTheDocument();
  });
});
