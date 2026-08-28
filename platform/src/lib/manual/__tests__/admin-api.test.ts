import { describe, it, expect } from 'vitest';
import {
  assembleSchema,
  validateBuilder,
  builderIsValid,
  makeDraftField,
  moveField,
  newFieldId,
  buildTaskListQuery,
  buildSubmissionListQuery,
  mediaViewUrl,
  resolveMediaUrl,
  submitterName,
  formatAnswer,
  readGps,
  readMedia,
  targetLabel,
  dateInputToIso,
  isoToDateInput,
  isOverdue,
  parseVendorList,
} from '@/lib/manual/admin-api';
import type { FormField, FormValue } from '@/lib/manual/form-types';

/** Tiny field factory. */
function field(partial: Partial<FormField> & Pick<FormField, 'id' | 'type'>): FormField {
  return { label: partial.id, required: false, order: 0, ...partial } as FormField;
}

/** A GPS_POINT answer is a {lat,lng} object stored in the FormValue slot (cast for the test). */
const gps = (lat: number, lng: number): FormValue => ({ lat, lng }) as unknown as FormValue;

// ── assembleSchema ────────────────────────────────────────────────────────────
describe('assembleSchema', () => {
  it('reindexes order sequentially by position', () => {
    const out = assembleSchema(
      [field({ id: 'a', type: 'TEXT', order: 5 }), field({ id: 'b', type: 'TEXT', order: 9 })],
      false,
    );
    expect(out.fields.map((f) => f.order)).toEqual([0, 1]);
  });

  it('trims labels and drops empty options on option fields', () => {
    const out = assembleSchema(
      [field({ id: 'a', type: 'DROPDOWN', label: '  Pick  ', options: [' one ', '', '  ', 'two'] })],
      false,
    );
    expect(out.fields[0].label).toBe('Pick');
    expect(out.fields[0].options).toEqual(['one', 'two']);
  });

  it('strips options from non-option field types', () => {
    const out = assembleSchema([field({ id: 'a', type: 'TEXT', options: ['x'] })], false);
    expect(out.fields[0].options).toBeUndefined();
  });

  it('normalises CAMERA flags and keeps the instruction', () => {
    const out = assembleSchema(
      [field({ id: 'a', type: 'CAMERA', geotag: true, geoFenceRequired: false, instruction: ' shoot ' })],
      false,
    );
    expect(out.fields[0].geotag).toBe(true);
    expect(out.fields[0].geoFenceRequired).toBe(false);
    expect(out.fields[0].instruction).toBe('shoot');
  });

  it('defaults GPS_POINT captureTrigger to ON_SUBMIT', () => {
    const out = assembleSchema([field({ id: 'a', type: 'GPS_POINT' })], false);
    expect(out.fields[0].captureTrigger).toBe('ON_SUBMIT');
  });

  it('carries captureGpsOnSubmit through', () => {
    expect(assembleSchema([], true).captureGpsOnSubmit).toBe(true);
  });
});

// ── validateBuilder ───────────────────────────────────────────────────────────
describe('validateBuilder', () => {
  it('rejects an empty form', () => {
    const errs = validateBuilder(assembleSchema([], false));
    expect(builderIsValid(errs)).toBe(false);
    expect(errs.general.length).toBeGreaterThan(0);
  });

  it('flags an unlabelled field', () => {
    const errs = validateBuilder(assembleSchema([field({ id: 'a', type: 'TEXT', label: '' })], false));
    expect(errs.byField['a']).toBeTruthy();
  });

  it('flags an option field with no options', () => {
    const errs = validateBuilder(assembleSchema([field({ id: 'a', type: 'DROPDOWN', label: 'Q', options: [''] })], false));
    expect(errs.byField['a']).toBeTruthy();
  });

  it('requires a GPS_POINT field when captureGpsOnSubmit is on', () => {
    const errs = validateBuilder(assembleSchema([field({ id: 'a', type: 'TEXT', label: 'Q' })], true));
    expect(errs.general.some((m) => m.toLowerCase().includes('gps'))).toBe(true);
  });

  it('accepts a valid schema', () => {
    const errs = validateBuilder(
      assembleSchema(
        [
          field({ id: 'a', type: 'TEXT', label: 'Name' }),
          field({ id: 'b', type: 'DROPDOWN', label: 'Size', options: ['S', 'M'] }),
          field({ id: 'g', type: 'GPS_POINT', label: 'Where' }),
        ],
        true,
      ),
    );
    expect(builderIsValid(errs)).toBe(true);
  });

  it('detects duplicate ids', () => {
    const errs = validateBuilder({
      captureGpsOnSubmit: false,
      fields: [field({ id: 'dup', type: 'TEXT', label: 'A' }), field({ id: 'dup', type: 'TEXT', label: 'B' })],
    });
    expect(errs.general.some((m) => m.toLowerCase().includes('identifier'))).toBe(true);
  });
});

// ── makeDraftField / moveField / newFieldId ──────────────────────────────────
describe('field builder helpers', () => {
  it('makeDraftField seeds option fields with one blank option', () => {
    expect(makeDraftField('MULTI_SELECT', 0).options).toEqual(['']);
  });
  it('makeDraftField enables geotag for CAMERA', () => {
    expect(makeDraftField('CAMERA', 0).geotag).toBe(true);
  });
  it('makeDraftField sets ON_SUBMIT for GPS_POINT', () => {
    expect(makeDraftField('GPS_POINT', 0).captureTrigger).toBe('ON_SUBMIT');
  });

  it('moveField swaps neighbours and re-orders', () => {
    const fields = [field({ id: 'a', type: 'TEXT', order: 0 }), field({ id: 'b', type: 'TEXT', order: 1 })];
    const moved = moveField(fields, 0, 1);
    expect(moved.map((f) => f.id)).toEqual(['b', 'a']);
    expect(moved.map((f) => f.order)).toEqual([0, 1]);
  });
  it('moveField is a no-op out of range', () => {
    const fields = [field({ id: 'a', type: 'TEXT' })];
    expect(moveField(fields, 0, -1)).toBe(fields);
  });

  it('newFieldId returns unique ids', () => {
    expect(newFieldId()).not.toBe(newFieldId());
  });
});

// ── query builders ───────────────────────────────────────────────────────────
describe('query builders', () => {
  it('omits status when ALL and vendor when absent', () => {
    const q = buildTaskListQuery({ status: 'ALL', page: 2 });
    expect(q).toContain('page=2');
    expect(q).not.toContain('status=');
    expect(q).not.toContain('vendorId=');
  });
  it('includes status + vendor when set', () => {
    const q = buildTaskListQuery({ status: 'OPEN', vendorId: 'v1' });
    expect(q).toContain('status=OPEN');
    expect(q).toContain('vendorId=v1');
  });
  it('submissions query defaults page/limit', () => {
    const q = buildSubmissionListQuery({ status: 'SUBMITTED' });
    expect(q).toContain('status=SUBMITTED');
    expect(q).toContain('page=1');
  });
});

// ── media urls ───────────────────────────────────────────────────────────────
describe('media urls', () => {
  it('encodes the key', () => {
    expect(mediaViewUrl('a/b c.jpg')).toBe('/api/media/view?key=a%2Fb%20c.jpg');
  });
  it('maps a /v1/ viewPath onto /api/', () => {
    expect(resolveMediaUrl({ key: 'k', viewPath: '/v1/media/view?key=k' })).toBe('/api/media/view?key=k');
  });
  it('keeps an already /api/ viewPath', () => {
    expect(resolveMediaUrl({ key: 'k', viewPath: '/api/media/view?key=k' })).toBe('/api/media/view?key=k');
  });
  it('falls back to the key when no viewPath', () => {
    expect(resolveMediaUrl({ key: 'k' })).toBe('/api/media/view?key=k');
  });
  it('returns null for nothing', () => {
    expect(resolveMediaUrl(null)).toBeNull();
  });
});

// ── formatAnswer / readers ───────────────────────────────────────────────────
describe('formatAnswer', () => {
  it('formats a toggle', () => {
    expect(formatAnswer(field({ id: 't', type: 'TOGGLE' }), true)).toBe('Yes');
    expect(formatAnswer(field({ id: 't', type: 'TOGGLE' }), false)).toBe('No');
  });
  it('joins a multi-select', () => {
    expect(formatAnswer(field({ id: 'm', type: 'MULTI_SELECT' }), ['a', 'b'])).toBe('a, b');
  });
  it('returns em-dash for empty', () => {
    expect(formatAnswer(field({ id: 'x', type: 'TEXT' }), null)).toBe('—');
    expect(formatAnswer(field({ id: 'x', type: 'TEXT' }), '   ')).toBe('—');
  });
  it('returns empty string for a CAMERA field (rendered as a photo)', () => {
    expect(formatAnswer(field({ id: 'c', type: 'CAMERA' }), { key: 'k' })).toBe('');
  });
  it('formats a GPS point', () => {
    expect(formatAnswer(field({ id: 'g', type: 'GPS_POINT' }), gps(12.34, 56.78))).toBe('12.340000, 56.780000');
  });
});

describe('readers', () => {
  it('readGps extracts lat/lng', () => {
    expect(readGps(gps(1, 2))).toEqual({ lat: 1, lng: 2 });
    expect(readGps('nope')).toBeNull();
  });
  it('readMedia extracts a media key object or bare string', () => {
    expect(readMedia({ key: 'k' })).toEqual({ key: 'k' });
    expect(readMedia('bare')).toEqual({ key: 'bare' });
    expect(readMedia({ key: '' })).toBeNull();
    expect(readMedia(null)).toBeNull();
  });
});

// ── misc helpers ─────────────────────────────────────────────────────────────
describe('misc helpers', () => {
  it('targetLabel', () => {
    expect(targetLabel(null, null)).toBe('All fleets');
    expect(targetLabel('Acme', 'v1')).toBe('Acme');
    expect(targetLabel(null, 'v1')).toBe('Assigned fleet');
  });
  it('submitterName tolerates shapes', () => {
    expect(submitterName({ id: '1', name: 'Ann' })).toBe('Ann');
    expect(submitterName('Bob')).toBe('Bob');
    expect(submitterName(null)).toBe('Unknown');
  });
  it('date round-trip', () => {
    const iso = dateInputToIso('2026-03-15');
    expect(iso).toBeTruthy();
    expect(isoToDateInput(iso!)).toBe('2026-03-15');
    expect(dateInputToIso('')).toBeUndefined();
    expect(isoToDateInput(null)).toBe('');
  });
  it('isOverdue', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(isOverdue('2026-05-01T00:00:00Z', now)).toBe(true);
    expect(isOverdue('2026-07-01T00:00:00Z', now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });
  it('parseVendorList tolerates array and {vendors} shapes', () => {
    expect(parseVendorList([{ id: 'a', code: 'A', name: 'Acme' }])).toEqual([{ id: 'a', code: 'A', name: 'Acme' }]);
    expect(parseVendorList({ vendors: [{ id: 'b', code: 'B', name: 'Beta' }] })).toEqual([
      { id: 'b', code: 'B', name: 'Beta' },
    ]);
    expect(parseVendorList(null)).toEqual([]);
    expect(parseVendorList([{ code: 'no-id' }])).toEqual([]);
  });
});
