import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SortToggle } from '@/components/field/sort-toggle';

afterEach(cleanup);

describe('SortToggle — Nearest / A–Z field sort control', () => {
  it('renders both options as radios and marks the active one', () => {
    render(<SortToggle mode="nearest" onChange={() => {}} hasFix />);
    expect(screen.getByTestId('sort-nearest')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sort-name')).toHaveAttribute('aria-checked', 'false');
  });

  it('turns the no-fix hint into a tappable retry when onRetryLocation is given', () => {
    const onRetry = vi.fn();
    render(<SortToggle mode="nearest" onChange={() => {}} hasFix={false} onRetryLocation={onRetry} />);
    const retry = screen.getByTestId('sort-geo-retry');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sort-geo-hint')).toBeNull(); // the plain hint is replaced by the action
  });

  it('fires onChange with the picked mode', () => {
    const onChange = vi.fn();
    render(<SortToggle mode="nearest" onChange={onChange} hasFix />);
    fireEvent.click(screen.getByTestId('sort-name'));
    expect(onChange).toHaveBeenCalledWith('name');
  });

  it('shows the enable-location hint ONLY when there is no device fix', () => {
    const { rerender } = render(<SortToggle mode="nearest" onChange={() => {}} hasFix={false} />);
    expect(screen.getByTestId('sort-geo-hint')).toHaveTextContent('Enable location to sort by distance');

    rerender(<SortToggle mode="nearest" onChange={() => {}} hasFix />);
    expect(screen.queryByTestId('sort-geo-hint')).toBeNull();
  });

  it('softens the hint to "finding" while a fix is being acquired', () => {
    render(<SortToggle mode="nearest" onChange={() => {}} hasFix={false} locating />);
    expect(screen.getByTestId('sort-geo-hint')).toHaveTextContent('Finding your location…');
  });
});
