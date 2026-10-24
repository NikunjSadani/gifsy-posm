/// <reference types="vitest/globals" />
import '@testing-library/jest-dom';

// Stub browser APIs not implemented by jsdom. These are needed by the media-capture /
// geo surfaces the POSM waves build on top of the chassis; harmless for the chassis itself.
const _fakeCtx = {
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  clearRect: vi.fn(), fillText: vi.fn(), fillRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  strokeStyle: '', lineWidth: 0, lineCap: '',
};
Object.defineProperty(globalThis.HTMLCanvasElement.prototype, 'getContext', {
  value: () => _fakeCtx,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis.HTMLCanvasElement.prototype, 'toDataURL', {
  value: () => 'data:image/png;base64,stub',
  configurable: true,
  writable: true,
});

// Stub HTMLVideoElement.play / pause (not implemented in jsdom)
Object.defineProperty(globalThis.HTMLVideoElement.prototype, 'play', {
  value: vi.fn().mockResolvedValue(undefined),
  configurable: true,
});
Object.defineProperty(globalThis.HTMLVideoElement.prototype, 'pause', {
  value: vi.fn(),
  configurable: true,
});

// jsdom does not implement scrollIntoView — stub it
Element.prototype.scrollIntoView = vi.fn();

// jsdom does not implement IntersectionObserver. The metric drill-down sheet instantiates one
// for its infinite-scroll sentinel; stub it as an inert no-op (it never auto-fires) so the
// component renders, and tests drive pagination through the explicit "Load more" button.
class _NoopIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
Object.defineProperty(globalThis, 'IntersectionObserver', {
  value: _NoopIntersectionObserver,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis.navigator, 'geolocation', {
  value: { getCurrentPosition: vi.fn() },
  configurable: true,
});

Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  configurable: true,
});
