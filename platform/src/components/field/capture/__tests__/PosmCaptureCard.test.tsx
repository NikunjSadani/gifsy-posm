import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PosmCaptureCard, type PosmTypeOption } from '../PosmCaptureCard';

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
