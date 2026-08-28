import { describe, it, expect } from 'vitest';
import {
  taskDisplayStatus,
  isFillable,
  missingRequiredFields,
  isComplete,
  buildFormValues,
} from '@/lib/manual/field-api';
import type { FormField, ManualFormSchema, FormValues } from '@/lib/manual/form-types';

/** Tiny field factory for the schema fixtures. */
function field(partial: Partial<FormField> & Pick<FormField, 'id' | 'type'>): FormField {
  return {
    label: partial.id,
    required: false,
    order: 0,
    ...partial,
  } as FormField;
}

function schema(fields: FormField[]): ManualFormSchema {
  return { captureGpsOnSubmit: false, fields };
}

describe('taskDisplayStatus', () => {
  it('is NEW when there is no submission', () => {
    expect(taskDisplayStatus({ mySubmission: null })).toBe('NEW');
  });
  it('mirrors the submission status', () => {
    expect(taskDisplayStatus({ mySubmission: { status: 'SUBMITTED', version: 1 } })).toBe('SUBMITTED');
    expect(taskDisplayStatus({ mySubmission: { status: 'APPROVED', version: 1 } })).toBe('APPROVED');
    expect(taskDisplayStatus({ mySubmission: { status: 'REJECTED', version: 2 } })).toBe('REJECTED');
  });
});

describe('isFillable', () => {
  it('allows NEW and REJECTED', () => {
    expect(isFillable({ mySubmission: null })).toBe(true);
    expect(isFillable({ mySubmission: { status: 'REJECTED', version: 1 } })).toBe(true);
  });
  it('blocks SUBMITTED (under review) and APPROVED', () => {
    expect(isFillable({ mySubmission: { status: 'SUBMITTED', version: 1 } })).toBe(false);
    expect(isFillable({ mySubmission: { status: 'APPROVED', version: 1 } })).toBe(false);
  });
});

describe('missingRequiredFields / isComplete', () => {
  const s = schema([
    field({ id: 'name', type: 'TEXT', required: true, order: 1 }),
    field({ id: 'note', type: 'TEXTAREA', required: false, order: 2 }),
    field({ id: 'qty', type: 'NUMBER', required: true, order: 3 }),
    field({ id: 'tags', type: 'MULTI_SELECT', required: true, order: 4, options: ['a', 'b'] }),
    field({ id: 'ok', type: 'TOGGLE', required: true, order: 5 }),
    field({ id: 'photo', type: 'CAMERA', required: true, order: 6 }),
    field({ id: 'loc', type: 'GPS_POINT', required: true, order: 7 }),
  ]);

  it('lists all required fields when nothing is answered (in order)', () => {
    const missing = missingRequiredFields(s, {}).map((f) => f.id);
    expect(missing).toEqual(['name', 'qty', 'tags', 'ok', 'photo', 'loc']);
    expect(isComplete(s, {})).toBe(false);
  });

  it('treats blank/empty answers as missing', () => {
    const values: FormValues = {
      name: '   ', // whitespace-only
      qty: null,
      tags: [], // empty multi-select
      ok: null, // no boolean yet
      photo: { key: '' }, // media with no key
      loc: null,
    };
    expect(missingRequiredFields(s, values).map((f) => f.id)).toEqual([
      'name',
      'qty',
      'tags',
      'ok',
      'photo',
      'loc',
    ]);
  });

  it('is complete once every required field has a valid answer', () => {
    const values: FormValues = {
      name: 'Store A',
      qty: 0, // zero is a valid number answer
      tags: ['a'],
      ok: false, // false is a valid toggle answer
      photo: { key: 'media/123.jpg', geo: { lat: 1, lng: 2 } },
      // GPS value is a {lat,lng,…} object; not enumerated in the FormValue union, matching
      // how the runtime stores it (hasValue checks `'lat' in v`).
      loc: { lat: 19.07, lng: 72.87, accuracy: 12 } as unknown as FormValues[string],
    };
    expect(missingRequiredFields(s, values)).toEqual([]);
    expect(isComplete(s, values)).toBe(true);
  });

  it('ignores optional fields for completeness', () => {
    const optional = schema([field({ id: 'note', type: 'TEXTAREA', required: false, order: 1 })]);
    expect(isComplete(optional, {})).toBe(true);
  });
});

describe('buildFormValues', () => {
  const s = schema([
    field({ id: 'name', type: 'TEXT', required: true, order: 1 }),
    field({ id: 'note', type: 'TEXTAREA', required: false, order: 2 }),
    field({ id: 'ok', type: 'TOGGLE', required: false, order: 3 }),
    field({ id: 'qty', type: 'NUMBER', required: false, order: 4 }),
  ]);

  it('drops untouched / empty optional answers', () => {
    const built = buildFormValues(s, { name: 'A', note: '', ok: null, qty: null });
    expect(built).toEqual({ name: 'A' });
  });

  it('keeps real answers including falsy-but-valid ones (false, 0)', () => {
    const built = buildFormValues(s, { name: 'A', ok: false, qty: 0 });
    expect(built).toEqual({ name: 'A', ok: false, qty: 0 });
  });

  it('never includes keys not present in the schema', () => {
    const built = buildFormValues(s, { name: 'A', stray: 'x' } as FormValues);
    expect(built).toEqual({ name: 'A' });
    expect('stray' in built).toBe(false);
  });

  it('passes media/gps objects through unchanged', () => {
    const media = { key: 'm/1.jpg', geo: { lat: 1, lng: 2 } };
    const s2 = schema([field({ id: 'p', type: 'CAMERA', required: true, order: 1 })]);
    expect(buildFormValues(s2, { p: media })).toEqual({ p: media });
  });
});
