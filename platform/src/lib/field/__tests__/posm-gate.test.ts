import { describe, it, expect } from 'vitest';
import {
  GSB_POSM_CODE,
  gatePosmTypesByGsb,
  isGsbHiddenForOutlet,
} from '@/lib/field/posm-gate';

type Opt = { id: string; code: string; name: string };

const TYPES: Opt[] = [
  { id: '1', code: 'GSB', name: 'Glow Sign Board' },
  { id: '2', code: 'POSTER', name: 'Poster' },
  { id: '3', code: 'SHELF', name: 'Shelf strip' },
];

describe('gatePosmTypesByGsb — GSB filter by code', () => {
  it('keeps every type when the outlet allows GSB', () => {
    expect(gatePosmTypesByGsb(TYPES, true)).toEqual(TYPES);
  });

  it('removes ONLY the GSB type (matched by code) when the outlet disallows GSB', () => {
    const out = gatePosmTypesByGsb(TYPES, false);
    expect(out.map((t) => t.code)).toEqual(['POSTER', 'SHELF']);
    expect(out.some((t) => t.code === GSB_POSM_CODE)).toBe(false);
  });

  it('matches the GSB code exactly — a different-cased code is NOT treated as GSB', () => {
    const mixed: Opt[] = [{ id: '9', code: 'gsb', name: 'lower' }, ...TYPES.slice(1)];
    // 'gsb' !== 'GSB' so it is not filtered (mirrors the backend `code === "GSB"`).
    expect(gatePosmTypesByGsb(mixed, false).map((t) => t.code)).toEqual(['gsb', 'POSTER', 'SHELF']);
  });

  it('is a no-op on a list with no GSB type', () => {
    const noGsb = TYPES.slice(1);
    expect(gatePosmTypesByGsb(noGsb, false)).toEqual(noGsb);
  });
});

describe('isGsbHiddenForOutlet — whether to show the "not approved" note', () => {
  it('is true only when a GSB type exists AND the outlet disallows it', () => {
    expect(isGsbHiddenForOutlet(TYPES, false)).toBe(true);
  });
  it('is false when the outlet allows GSB', () => {
    expect(isGsbHiddenForOutlet(TYPES, true)).toBe(false);
  });
  it('is false when the list has no GSB type (nothing to hide)', () => {
    expect(isGsbHiddenForOutlet(TYPES.slice(1), false)).toBe(false);
  });
});
