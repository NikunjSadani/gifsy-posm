import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  parseRecipients,
  formatHourLabel,
  HOUR_OPTIONS,
} from '@/lib/reports/api';

// ─── isValidEmail ──────────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('field.ops@kwality.co.in')).toBe(true);
    expect(isValidEmail('a+tag@sub.domain.org')).toBe(true);
  });
  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmail('  a@b.com  ')).toBe(true);
  });
  it('rejects the common mistakes', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
    expect(isValidEmail('nodomain')).toBe(false);
    expect(isValidEmail('no@dot')).toBe(false);
    expect(isValidEmail('@b.com')).toBe(false);
    expect(isValidEmail('a@b.com b@c.com')).toBe(false); // embedded space
    expect(isValidEmail('two@@at.com')).toBe(false);
  });
});

// ─── parseRecipients ────────────────────────────────────────────────────────────

describe('parseRecipients', () => {
  it('splits on commas, newlines, and semicolons', () => {
    const r = parseRecipients('a@b.com, c@d.com\ne@f.com;g@h.com');
    expect(r.valid).toEqual(['a@b.com', 'c@d.com', 'e@f.com', 'g@h.com']);
    expect(r.invalid).toEqual([]);
  });
  it('ignores blank tokens (a trailing comma is not an error)', () => {
    const r = parseRecipients('a@b.com,\n\n,  ,');
    expect(r.valid).toEqual(['a@b.com']);
    expect(r.invalid).toEqual([]);
  });
  it('dedups case-insensitively, keeping the first spelling', () => {
    const r = parseRecipients('A@B.com, a@b.com\nA@b.COM');
    expect(r.valid).toEqual(['A@B.com']);
  });
  it('separates invalid tokens and dedups them too', () => {
    const r = parseRecipients('good@x.com, bad, bad, also-bad');
    expect(r.valid).toEqual(['good@x.com']);
    expect(r.invalid).toEqual(['bad', 'also-bad']);
  });
  it('returns empty buckets for empty input', () => {
    expect(parseRecipients('')).toEqual({ valid: [], invalid: [] });
    expect(parseRecipients('   \n , ; ')).toEqual({ valid: [], invalid: [] });
  });
});

// ─── formatHourLabel ────────────────────────────────────────────────────────────

describe('formatHourLabel', () => {
  it('zero-pads to a 24h IST clock label', () => {
    expect(formatHourLabel(0)).toBe('00:00 IST');
    expect(formatHourLabel(8)).toBe('08:00 IST');
    expect(formatHourLabel(23)).toBe('23:00 IST');
  });
  it('renders "—" for an out-of-range or non-integer hour (never a fake time)', () => {
    expect(formatHourLabel(-1)).toBe('—');
    expect(formatHourLabel(24)).toBe('—');
    expect(formatHourLabel(8.5)).toBe('—');
    expect(formatHourLabel(Number.NaN)).toBe('—');
  });
});

// ─── HOUR_OPTIONS ─────────────────────────────────────────────────────────────

describe('HOUR_OPTIONS', () => {
  it('covers all 24 hours with matching labels', () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: 0, label: '00:00 IST' });
    expect(HOUR_OPTIONS[23]).toEqual({ value: 23, label: '23:00 IST' });
    expect(HOUR_OPTIONS.map((o) => o.value)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });
});
