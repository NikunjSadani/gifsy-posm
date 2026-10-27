import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PosmCaptureCard, type PosmTypeOption } from '../PosmCaptureCard';

// ── Child-component + IO mocks ───────────────────────────────────────────────
// The real CameraCapture (getUserMedia) and ElementBoxPlacer (pointer/canvas) are not
// drivable in jsdom, so we stub them with tiny buttons that invoke the same callbacks the
// real components do: CameraCapture → onChange(file), ElementBoxPlacer → onSave(markup).
// This lets us exercise the photo→box render transition deterministically.
vi.mock('../CameraCapture', () => ({
  CameraCapture: ({ value, onChange }: { value: File | null; onChange: (f: File | null) => void }) => (
    <div data-testid="camera-capture">
      <button
        type="button"
        onClick={() => onChange(new File(['x'], 'posm.jpg', { type: 'image/jpeg' }))}
      >
        mock-take-photo
      </button>
      {/* The raw camera preview image — the thing that used to be shown alongside the
          box-overlay. Present only while CameraCapture itself is rendered. */}
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img data-testid="camera-raw-preview" src="blob:camera" alt="camera raw preview" />
      )}
    </div>
  ),
}));

vi.mock('../ElementBoxPlacer', () => ({
  ElementBoxPlacer: ({ onSave }: { onSave: (m: unknown) => void }) => (
    <div data-testid="box-placer">
      <button
        type="button"
        onClick={() => onSave({ version: 1, shapes: [{ type: 'rect', x: 0.1, y: 0.1, w: 0.3, h: 0.3 }] })}
      >
        mock-save-box
      </button>
    </div>
  ),
}));

vi.mock('@/lib/field/geo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/field/geo')>();
  return {
    ...actual,
    useGeo: () => ({
      coords: null,
      error: null,
      loading: false,
      capture: vi.fn().mockResolvedValue({ lat: 12.34, lng: 56.78, accuracy: 5, capturedAt: '2026-01-01T00:00:00Z' }),
    }),
  };
});

vi.mock('@/lib/field/media-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/field/media-upload')>();
  return {
    ...actual,
    uploadMedia: vi.fn().mockResolvedValue({ key: 'media-key', quality: null }),
  };
});

// jsdom does not implement object-URL creation; the card uses it for the photo preview.
beforeAll(() => {
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(), configurable: true, writable: true });
  }
  if (!('revokeObjectURL' in URL)) {
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
  }
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
});
afterEach(cleanup);

const TYPES: PosmTypeOption[] = [
  { id: 'poster', code: 'PST', name: 'Poster' },
  { id: 'gsb', code: 'GSB', name: 'Glow Sign Board' },
];

describe('PosmCaptureCard — create (editable) mode', () => {
  it('renders an interactive Element-type select and editable dimension inputs', () => {
    render(<PosmCaptureCard slot={1} posmTypes={TYPES} onChange={vi.fn()} />);
    // Editable element picker + two editable number inputs.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Width')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Height')).toBeInTheDocument();
    // No locked read-only presentations.
    expect(screen.queryByTestId('posm-type-locked-1')).toBeNull();
    expect(screen.queryByTestId('posm-width-locked-1')).toBeNull();
  });
});

describe('PosmCaptureCard — resubmit (locked) mode', () => {
  it('seeds and locks the Element type + dimensions (no editable controls), showing the values legibly', () => {
    render(
      <PosmCaptureCard
        slot={1}
        posmTypes={TYPES}
        onChange={vi.fn()}
        initialPosmTypeId="gsb"
        initialWidth={4}
        initialHeight={2.5}
        lockElementAndDims
      />,
    );

    // The element-type select and the dimension number inputs are GONE — replaced by read-only
    // presentations the rep cannot change.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByPlaceholderText('Width')).toBeNull();
    expect(screen.queryByPlaceholderText('Height')).toBeNull();

    // The locked values are shown legibly (seeded from the original submission).
    const type = screen.getByTestId('posm-type-locked-1');
    expect(type).toHaveTextContent('Glow Sign Board (GSB)');
    expect(screen.getByTestId('posm-width-locked-1')).toHaveTextContent('4 ft');
    expect(screen.getByTestId('posm-height-locked-1')).toHaveTextContent('2.5 ft');
  });

  it('falls back to the raw type id when the locked type is not in the (gated) picker list', () => {
    render(
      <PosmCaptureCard
        slot={2}
        posmTypes={[TYPES[0]]} // 'gsb' gated out of the picker for this outlet
        onChange={vi.fn()}
        initialPosmTypeId="gsb"
        initialWidth={3}
        initialHeight={3}
        lockElementAndDims
      />,
    );
    // Never blank: the read-only field still shows an identifier for the locked type.
    expect(screen.getByTestId('posm-type-locked-2')).toHaveTextContent('gsb');
  });
});

describe('PosmCaptureCard — single photo image once a box is placed', () => {
  it('shows only the box-overlay image (not the camera preview) and exposes Retake/Edit/Clear', async () => {
    render(
      <PosmCaptureCard
        slot={1}
        posmTypes={TYPES}
        onChange={vi.fn()}
        initialPosmTypeId="gsb"
        initialWidth={4}
        initialHeight={2}
      />,
    );

    // Take a photo (mock CameraCapture) and wait for the upload to settle so the
    // "Place Element box" affordance appears.
    fireEvent.click(screen.getByText('mock-take-photo'));
    const placeBtn = await screen.findByText('Place Element box');

    // BEFORE a box is placed: the camera preview IS shown (the raw image), and there is NO
    // box-overlay image yet.
    expect(screen.getByTestId('camera-capture')).toBeInTheDocument();
    expect(screen.getByTestId('camera-raw-preview')).toBeInTheDocument();
    expect(screen.queryByAltText('Captured photo with the Element box')).toBeNull();

    // Open the placer and save a box.
    fireEvent.click(placeBtn);
    fireEvent.click(await screen.findByText('mock-save-box'));

    await waitFor(() => {
      expect(screen.getByAltText('Captured photo with the Element box')).toBeInTheDocument();
    });

    // The CameraCapture (and its raw preview) is now HIDDEN — so the photo is shown exactly once.
    expect(screen.queryByTestId('camera-capture')).toBeNull();
    expect(screen.queryByTestId('camera-raw-preview')).toBeNull();
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('alt', 'Captured photo with the Element box');

    // All three controls are present on the single box-overlay image.
    expect(screen.getByRole('button', { name: /retake/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear element box/i })).toBeInTheDocument();
  });

  it('Retake discards the photo + box, bringing the camera capture zone back', async () => {
    render(
      <PosmCaptureCard
        slot={1}
        posmTypes={TYPES}
        onChange={vi.fn()}
        initialPosmTypeId="gsb"
        initialWidth={4}
        initialHeight={2}
      />,
    );

    fireEvent.click(screen.getByText('mock-take-photo'));
    fireEvent.click(await screen.findByText('Place Element box'));
    fireEvent.click(await screen.findByText('mock-save-box'));
    await screen.findByAltText('Captured photo with the Element box');

    // Retake clears file + markup → CameraCapture reappears and the overlay image is gone.
    fireEvent.click(screen.getByRole('button', { name: /retake/i }));
    await waitFor(() => {
      expect(screen.getByTestId('camera-capture')).toBeInTheDocument();
    });
    expect(screen.queryByAltText('Captured photo with the Element box')).toBeNull();
  });
});
