import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ElementFunnel } from '../ElementFunnel';
import type { ElementFunnelRow } from '@/lib/analytics/api';

const rows: ElementFunnelRow[] = [
  { code: 'GSB', name: 'Glow Sign Board', recced: 5, asmApproved: 4, hoApproved: 3, pendingInstall: 2, installed: 1 },
  { code: 'BAN', name: 'Banner', recced: 2, asmApproved: 1, hoApproved: 1, pendingInstall: 0, installed: 1 },
];

describe('ElementFunnel', () => {
  it('renders one row per element type with the right per-stage counts', () => {
    render(<ElementFunnel rows={rows} />);

    expect(screen.getByText('Element wise execution funnel')).toBeInTheDocument();
    // Element names + codes are shown.
    expect(screen.getByText('Glow Sign Board')).toBeInTheDocument();
    expect(screen.getByText('Banner')).toBeInTheDocument();

    // GSB stage cells carry the exact counts.
    const gsb = screen.getByTestId('element-funnel-row-GSB');
    expect(within(gsb).getByTestId('ef-GSB-recced')).toHaveTextContent('5');
    expect(within(gsb).getByTestId('ef-GSB-asmApproved')).toHaveTextContent('4');
    expect(within(gsb).getByTestId('ef-GSB-hoApproved')).toHaveTextContent('3');
    expect(within(gsb).getByTestId('ef-GSB-pendingInstall')).toHaveTextContent('2');
    expect(within(gsb).getByTestId('ef-GSB-installed')).toHaveTextContent('1');

    const ban = screen.getByTestId('element-funnel-row-BAN');
    expect(within(ban).getByTestId('ef-BAN-recced')).toHaveTextContent('2');
    expect(within(ban).getByTestId('ef-BAN-pendingInstall')).toHaveTextContent('0');
  });

  it('shows a Total row summing each stage column across element types', () => {
    render(<ElementFunnel rows={rows} />);
    expect(screen.getByText('Total')).toBeInTheDocument();
    // GSB + BAN: recced 5+2, asm 4+1, ho 3+1, pending 2+0, installed 1+1.
    expect(screen.getByTestId('ef-total-recced')).toHaveTextContent('7');
    expect(screen.getByTestId('ef-total-asmApproved')).toHaveTextContent('5');
    expect(screen.getByTestId('ef-total-hoApproved')).toHaveTextContent('4');
    expect(screen.getByTestId('ef-total-pendingInstall')).toHaveTextContent('2');
    expect(screen.getByTestId('ef-total-installed')).toHaveTextContent('2');
  });

  it('shows the empty state when there are no element rows', () => {
    render(<ElementFunnel rows={[]} />);
    expect(screen.getByTestId('element-funnel-empty')).toBeInTheDocument();
    expect(screen.getByText('No elements yet')).toBeInTheDocument();
    // The header still renders; no data rows.
    expect(screen.queryByTestId('element-funnel-row-GSB')).not.toBeInTheDocument();
  });

  it('treats a null rows prop (not-yet-loaded) as empty, not a crash', () => {
    render(<ElementFunnel rows={null} />);
    expect(screen.getByTestId('element-funnel-empty')).toBeInTheDocument();
  });

  it('renders an error state with a working retry', () => {
    const onRetry = vi.fn();
    render(<ElementFunnel rows={null} error="Boom" onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load the element funnel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
