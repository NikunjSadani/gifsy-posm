import { describe, it, expect } from 'vitest';
import { gatePosmTypesByGsb, isGsbHiddenForOutlet } from '@/lib/field/posm-gate';

type Opt = { id: string; code: string; name: string; isGsb: boolean };

const TYPES: Opt[] = [
  { id: '1', code: 'GSB', name: 'Glow Sign Board', isGsb: true },
  { id: '2', code: 'POSTER', name: 'Poster', isGsb: false },
  { id: '3', code: 'SHELF', name: 'Shelf strip', isGsb: false },
];

describe('gatePosmTypesByGsb — GSB filter by the isGsb flag', () => {
  it('keeps every type when the outlet allows GSB', () => {
    expect(gatePosmTypesByGsb(TYPES, true)).toEqual(TYPES);
  });

  it('removes ONLY the GSB types (matched by isGsb) when the outlet disallows GSB', () => {
    const out = gatePosmTypesByGsb(TYPES, false);
    expect(out.map((t) => t.code)).toEqual(['POSTER', 'SHELF']);
    expect(out.some((t) => t.isGsb)).toBe(false);
  });

  it('gates on the flag, NOT the code — a GSB-coded type with isGsb:false stays, and a non-GSB-coded type with isGsb:true is hidden', () => {
    const mixed: Opt[] = [
      { id: '9', code: 'GSB', name: 'Looks like GSB but is not flagged', isGsb: false },
      { id: '10', code: 'NEON', name: 'Flagged GSB under a different code', isGsb: true },
      TYPES[1], // POSTER
    ];
    expect(gatePosmTypesByGsb(mixed, false).map((t) => t.code)).toEqual(['GSB', 'POSTER']);
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
