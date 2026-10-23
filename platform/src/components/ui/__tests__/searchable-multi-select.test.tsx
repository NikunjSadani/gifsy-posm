import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { SearchableMultiSelect } from '../searchable-multi-select';

afterEach(cleanup);

/** Options toggle on mousedown (preventDefault keeps focus / the list open). */
const pick = (el: HTMLElement) => fireEvent.mouseDown(el);

describe('SearchableMultiSelect', () => {
  const options = ['Beat A', 'Beat B', 'Beat C'];

  it('adds an option to the selection on click (list stays open for multi-pick)', () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect values={[]} onChange={onChange} options={options} testIdPrefix="b" />);
    fireEvent.focus(screen.getByTestId('b-input'));
    pick(screen.getByTestId('b-option-Beat A'));
    expect(onChange).toHaveBeenCalledWith(['Beat A']);
    // List is still open (multi-pick) — options remain in the DOM.
    expect(screen.queryByTestId('b-list')).not.toBeNull();
  });

  it('toggles an already-selected option OFF when clicked again', () => {
    const onChange = vi.fn();
    render(
      <SearchableMultiSelect values={['Beat A', 'Beat B']} onChange={onChange} options={options} testIdPrefix="b" />,
    );
    fireEvent.focus(screen.getByTestId('b-input'));
    pick(screen.getByTestId('b-option-Beat A'));
    expect(onChange).toHaveBeenCalledWith(['Beat B']);
  });

  it('renders a removable chip per selected value and removes one via its × button', () => {
    const onChange = vi.fn();
    render(
      <SearchableMultiSelect values={['Beat A', 'Beat B']} onChange={onChange} options={options} testIdPrefix="b" />,
    );
    const chips = screen.getByTestId('b-chips');
    expect(within(chips).getByTestId('b-chip-Beat A')).toBeTruthy();
    expect(within(chips).getByTestId('b-chip-Beat B')).toBeTruthy();
    fireEvent.click(screen.getByTestId('b-chip-remove-Beat A'));
    expect(onChange).toHaveBeenCalledWith(['Beat B']);
  });

  it('clear-all empties the selection and shows a count placeholder', () => {
    const onChange = vi.fn();
    render(
      <SearchableMultiSelect values={['Beat A', 'Beat B']} onChange={onChange} options={options} testIdPrefix="b" />,
    );
    const input = screen.getByTestId('b-input') as HTMLInputElement;
    expect(input.placeholder).toBe('2 selected');
    fireEvent.click(screen.getByTestId('b-clear'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('filters options by case-insensitive substring', () => {
    render(<SearchableMultiSelect values={[]} onChange={() => {}} options={['Alpha', 'Beta', 'Gamma']} testIdPrefix="b" />);
    const input = screen.getByTestId('b-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    const list = screen.getByTestId('b-list');
    // 'a' matches Alpha, Beta, Gamma all contain 'a' → narrow further.
    fireEvent.change(input, { target: { value: 'mm' } });
    expect(within(list).queryByTestId('b-option-Gamma')).not.toBeNull();
    expect(within(list).queryByTestId('b-option-Alpha')).toBeNull();
    expect(within(list).queryByTestId('b-option-Beta')).toBeNull();
  });

  it('Enter toggles the highlighted option; Backspace on empty query drops the last chip', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchableMultiSelect values={[]} onChange={onChange} options={options} testIdPrefix="b" />,
    );
    const input = screen.getByTestId('b-input');
    fireEvent.focus(input);
    // First option is highlighted by default → Enter selects it.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['Beat A']);

    onChange.mockClear();
    rerender(<SearchableMultiSelect values={['Beat A', 'Beat B']} onChange={onChange} options={options} testIdPrefix="b" />);
    fireEvent.keyDown(screen.getByTestId('b-input'), { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['Beat A']);
  });

  it('renders no chips and the placeholder when nothing is selected (empty is valid)', () => {
    render(<SearchableMultiSelect values={[]} onChange={() => {}} options={options} placeholder="Pick beats" testIdPrefix="b" />);
    expect(screen.queryByTestId('b-chips')).toBeNull();
    expect((screen.getByTestId('b-input') as HTMLInputElement).placeholder).toBe('Pick beats');
  });

  it('is inert when disabled (no toggle on click)', () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect values={[]} onChange={onChange} options={options} disabled testIdPrefix="b" />);
    fireEvent.focus(screen.getByTestId('b-input'));
    // Disabled → openList is a no-op, so there is no list to click.
    expect(screen.queryByTestId('b-list')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
