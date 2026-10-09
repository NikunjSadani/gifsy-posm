import { describe, it, expect } from 'vitest';
import { installableElementSummary, type InstallablePosm } from '@/lib/field/installation-api';

const posm = (name: string | null, slotNo = 1): InstallablePosm => ({
  slotNo,
  posmType: name ? { id: name, code: name, name } : null,
});

describe('installableElementSummary', () => {
  it('joins the POSM type names when known', () => {
    expect(installableElementSummary([posm('Hoarding'), posm('Glow sign', 2)])).toBe(
      'Hoarding, Glow sign',
    );
  });

  it('falls back to an element count when no names are present', () => {
    expect(installableElementSummary([posm(null), posm(null, 2)])).toBe('2 Elements');
    expect(installableElementSummary([posm(null)])).toBe('1 Element');
  });

  it('ignores blank/whitespace names', () => {
    expect(installableElementSummary([posm('  '), posm('Banner', 2)])).toBe('Banner');
  });
});
