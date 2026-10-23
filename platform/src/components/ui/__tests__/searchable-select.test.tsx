import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { SearchableSelect } from '../searchable-select';

afterEach(cleanup);

/** Options commit on mousedown (preventDefault keeps focus); mirror that in tests. */
const pick = (el: HTMLElement) => fireEvent.mouseDown(el);

describe('SearchableSelect — string[] callers (unchanged behaviour)', () => {
  it('shows the committed string as the input display and commits the clicked option string', () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        value="Beat A"
        onChange={onChange}
        options={['Beat A', 'Beat B', 'Beat C']}
        testIdPrefix="t"
      />,
    );
    const input = screen.getByTestId('t-input') as HTMLInputElement;
    // Closed: input mirrors the committed value (value === label for strings).
    expect(input.value).toBe('Beat A');
    fireEvent.focus(input);
    pick(screen.getByTestId('t-option-Beat B'));
    expect(onChange).toHaveBeenCalledWith('Beat B');
  });

  it('filters options by substring (case-insensitive)', () => {
    render(
      <SearchableSelect value="" onChange={() => {}} options={['Apple', 'Banana', 'Avocado']} testIdPrefix="t" />,
    );
    const input = screen.getByTestId('t-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'av' } });
    const list = screen.getByTestId('t-list');
    expect(within(list).queryByTestId('t-option-Avocado')).not.toBeNull();
    expect(within(list).queryByTestId('t-option-Apple')).toBeNull();
    expect(within(list).queryByTestId('t-option-Banana')).toBeNull();
  });

  it('typing an exact option string commits it', () => {
    const onChange = vi.fn();
    render(<SearchableSelect value="" onChange={onChange} options={['RS1', 'RS2']} testIdPrefix="t" />);
    const input = screen.getByTestId('t-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'rs2' } });
    expect(onChange).toHaveBeenCalledWith('RS2');
  });
});

describe('SearchableSelect — labeled options', () => {
  const options = [
    { value: 'R1', label: 'R1 — Acme Distributors', keywords: 'R1 Acme Distributors' },
    { value: 'R2', label: 'R2 — Best Traders', keywords: 'R2 Best Traders' },
  ];

  it('commits the option VALUE but displays its LABEL', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchableSelect value="" onChange={onChange} options={options} testIdPrefix="rs" />,
    );
    const input = screen.getByTestId('rs-input') as HTMLInputElement;
    fireEvent.focus(input);
    // Option testid is keyed by VALUE, and the row text shows the LABEL.
    const opt = screen.getByTestId('rs-option-R1');
    expect(opt.textContent).toContain('R1 — Acme Distributors');
    pick(opt);
    expect(onChange).toHaveBeenCalledWith('R1');

    // With R1 committed, the closed input shows the label (not the raw value).
    rerender(<SearchableSelect value="R1" onChange={onChange} options={options} testIdPrefix="rs" />);
    expect((screen.getByTestId('rs-input') as HTMLInputElement).value).toBe('R1 — Acme Distributors');
  });

  it('searches by hidden keywords (the name) as well as the label', () => {
    render(<SearchableSelect value="" onChange={() => {}} options={options} testIdPrefix="rs" />);
    const input = screen.getByTestId('rs-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'acme' } });
    const list = screen.getByTestId('rs-list');
    expect(within(list).queryByTestId('rs-option-R1')).not.toBeNull();
    expect(within(list).queryByTestId('rs-option-R2')).toBeNull();
  });

  it('falls back to the raw value when it is not among the options', () => {
    render(<SearchableSelect value="UNKNOWN" onChange={() => {}} options={options} testIdPrefix="rs" />);
    expect((screen.getByTestId('rs-input') as HTMLInputElement).value).toBe('UNKNOWN');
  });
});
