import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { InstallButton } from '../install-button';

afterEach(cleanup);

/** In jsdom: no matchMedia, navigator.standalone undefined, non-iOS UA → status starts 'unavailable'. */
describe('InstallButton (login-screen PWA install)', () => {
  it('renders nothing until the app is installable', () => {
    render(<InstallButton />);
    expect(screen.queryByTestId('login-install-button')).toBeNull();
    expect(screen.queryByTestId('login-install-ios-hint')).toBeNull();
  });

  it('shows "Install app" after beforeinstallprompt and calls the browser prompt on click', async () => {
    render(<InstallButton />);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const evt = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    await act(async () => {
      window.dispatchEvent(evt);
    });
    const btn = await screen.findByTestId('login-install-button');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
