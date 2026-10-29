import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PosmCaptureCard, type PosmTypeOption, type PosmCaptureState } from '../PosmCaptureCard';

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
  ElementBoxPlacer: ({
    onSave,
    square,
    width,
    height,
  }: {
    onSave: (m: unknown) => void;
    square?: boolean;
    width?: number;
    height?: number;
  }) => (
    // Expose the mode the card passed down so tests can assert UNIT → square box vs DIMENSION → W×H box.
    <div data-testid="box-placer" data-square={square ? 'true' : 'false'} data-dims={`${width}x${height}`}>
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
  { id: 'poster', code: 'PST', name: 'Poster', isGsb: false, measurement: 'DIMENSION', maxAreaSqFt: null },
  { id: 'gsb', code: 'GSB', name: 'Glow Sign Board', isGsb: true, measurement: 'DIMENSION', maxAreaSqFt: null },
  { id: 'sticker', code: 'STK', name: 'Counter Unit', isGsb: false, measurement: 'UNIT', maxAreaSqFt: null },
  { id: 'capped', code: 'CAP', name: 'Capped Board', isGsb: false, measurement: 'DIMENSION', maxAreaSqFt: 10 },
];

/** The latest reported state (onChange fires on every readiness change). */
function latest(onChange: ReturnType<typeof vi.fn>): PosmCaptureState {
  return onChange.mock.calls[onChange.mock.calls.length - 1][0] as PosmCaptureState;
}
/** The most recent reported state whose line is ready (non-null), or undefined. */
function lastReadyLine(onChange: ReturnType<typeof vi.fn>) {
  const states = onChange.mock.calls.map((c) => c[0] as PosmCaptureState);
  return [...states].reverse().find((s) => s.line)?.line;
}

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

describe('PosmCaptureCard — measurement: UNIT vs DIMENSION', () => {
  it('UNIT element hides the W×H input, uses a SQUARE box, and reports null dimensions', async () => {
    const onChange = vi.fn();
    render(<PosmCaptureCard slot={1} posmTypes={TYPES} onChange={onChange} />);

    // Pick the UNIT element → the Dimension (in Ft.) input disappears entirely.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sticker' } });
    expect(screen.queryByPlaceholderText('Width')).toBeNull();
    expect(screen.queryByPlaceholderText('Height')).toBeNull();
    expect(screen.queryByText('Dimension (in Ft.)')).toBeNull();

    // Take a photo; the box affordance appears and is enabled WITHOUT any dimensions (UNIT).
    fireEvent.click(screen.getByText('mock-take-photo'));
    const placeBtn = await screen.findByText('Place Element box');
    expect(placeBtn.closest('button')).not.toBeDisabled();

    // The placer is told to draw a SQUARE box (not a W×H-seeded one).
    fireEvent.click(placeBtn);
    expect(screen.getByTestId('box-placer')).toHaveAttribute('data-square', 'true');
    fireEvent.click(screen.getByText('mock-save-box'));

    // The ready line carries null dimensions (UNIT elements send no W×H).
    await waitFor(() => {
      const line = lastReadyLine(onChange);
      expect(line).toBeTruthy();
      expect(line!.dimensions).toBeNull();
      expect(line!.posmTypeId).toBe('sticker');
    });
  });

  it('DIMENSION element keeps the W×H inputs and seeds the box from them (and gates the box on valid dims)', async () => {
    render(<PosmCaptureCard slot={1} posmTypes={TYPES} onChange={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'poster' } });
    expect(screen.getByPlaceholderText('Width')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Height')).toBeInTheDocument();

    // Photo taken but no dims yet → the box cannot be placed.
    fireEvent.click(screen.getByText('mock-take-photo'));
    const placeBtn = await screen.findByText('Place Element box');
    expect(placeBtn.closest('button')).toBeDisabled();

    // Enter dims → the box enables and is seeded as a DIMENSION (non-square) box.
    fireEvent.change(screen.getByPlaceholderText('Width'), { target: { value: '4' } });
    fireEvent.change(screen.getByPlaceholderText('Height'), { target: { value: '2' } });
    await waitFor(() => expect(placeBtn.closest('button')).not.toBeDisabled());
    fireEvent.click(placeBtn);
    const placer = screen.getByTestId('box-placer');
    expect(placer).toHaveAttribute('data-square', 'false');
    expect(placer).toHaveAttribute('data-dims', '4x2');
  });

  it('over-max W×H shows an inline error and BLOCKS the line until dims are within the cap', async () => {
    const onChange = vi.fn();
    render(<PosmCaptureCard slot={1} posmTypes={TYPES} onChange={onChange} />);

    // Capped element: maxAreaSqFt = 10. 4 × 4 = 16 sq ft → over the cap.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'capped' } });
    fireEvent.change(screen.getByPlaceholderText('Width'), { target: { value: '4' } });
    fireEvent.change(screen.getByPlaceholderText('Height'), { target: { value: '4' } });

    const err = await screen.findByTestId('posm-overmax-1');
    expect(err).toHaveTextContent('10 sq ft');

    // Even with a photo + placed box, the line stays blocked while over the cap.
    fireEvent.click(screen.getByText('mock-take-photo'));
    fireEvent.click(await screen.findByText('Place Element box'));
    fireEvent.click(screen.getByText('mock-save-box'));
    await waitFor(() => expect(latest(onChange).line).toBeNull());

    // Reduce to within the cap (4 × 2 = 8 ≤ 10) → the error clears and the line becomes ready.
    fireEvent.change(screen.getByPlaceholderText('Height'), { target: { value: '2' } });
    await waitFor(() => {
      expect(screen.queryByTestId('posm-overmax-1')).toBeNull();
      const line = lastReadyLine(onChange);
      expect(line).toBeTruthy();
      expect(line!.dimensions).toEqual({ width: 4, height: 2, unit: 'ft' });
    });
  });
});
