import { describe, it, expect } from 'vitest';
import { pageCount } from '@/components/audit/pagination';

describe('pageCount', () => {
  it('returns 1 for an empty queue', () => {
    expect(pageCount(0, 50)).toBe(1);
  });

  it('returns 1 when the total fits on a single page', () => {
    expect(pageCount(1, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
  });

  it('rounds up a partial final page', () => {
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(99, 50)).toBe(2);
    expect(pageCount(100, 50)).toBe(2);
    expect(pageCount(101, 50)).toBe(3);
  });

  it('guards against a non-positive or non-finite page size', () => {
    expect(pageCount(100, 0)).toBe(1);
    expect(pageCount(100, -5)).toBe(1);
    expect(pageCount(100, Number.NaN)).toBe(1);
  });

  it('guards against a non-finite / negative total', () => {
    expect(pageCount(Number.NaN, 50)).toBe(1);
    expect(pageCount(-10, 50)).toBe(1);
  });
});
