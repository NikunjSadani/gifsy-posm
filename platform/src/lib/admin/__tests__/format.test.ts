import { describe, it, expect } from 'vitest';
import { summarizeUpload, formatCoords, base64ToBlob, displayPhone } from '@/lib/admin/format';
import type { BulkUploadResult } from '@/lib/admin/types';

const makeResult = (over: Partial<BulkUploadResult>): BulkUploadResult => ({
  batchId: 'b1',
  rowCount: 0,
  successCount: 0,
  errorCount: 0,
  errorFileBase64: null,
  successFileBase64: null,
  ...over,
});

describe('summarizeUpload', () => {
  it('all rows ok → success tone, no error file', () => {
    const s = summarizeUpload(makeResult({ rowCount: 5, successCount: 5, errorCount: 0 }));
    expect(s.tone).toBe('success');
    expect(s.hasErrorFile).toBe(false);
    expect(s.headline).toContain('5 rows');
  });
  it('partial → partial tone with exact counts (never inflates success)', () => {
    const s = summarizeUpload(
      makeResult({ rowCount: 50, successCount: 48, errorCount: 2, errorFileBase64: 'AAAA' }),
    );
    expect(s.tone).toBe('partial');
    expect(s.successCount).toBe(48);
    expect(s.errorCount).toBe(2);
    expect(s.hasErrorFile).toBe(true);
    expect(s.headline).toContain('48 of 50');
    expect(s.headline).toContain('2 rejected');
  });
  it('none imported → error tone', () => {
    const s = summarizeUpload(makeResult({ rowCount: 3, successCount: 0, errorCount: 3, errorFileBase64: 'AAAA' }));
    expect(s.tone).toBe('error');
    expect(s.headline).toContain('No rows imported');
  });
  it('singular row wording', () => {
    const s = summarizeUpload(makeResult({ rowCount: 1, successCount: 1, errorCount: 0 }));
    expect(s.headline).toContain('1 row ');
  });
  it('exposes hasSuccessFile from the success report payload', () => {
    expect(summarizeUpload(makeResult({ successFileBase64: 'AAAA' })).hasSuccessFile).toBe(true);
    expect(summarizeUpload(makeResult({ successFileBase64: null })).hasSuccessFile).toBe(false);
  });
});

describe('formatCoords', () => {
  it('formats numeric coords', () => {
    expect(formatCoords({ lat: 22.5, lng: 88.3 })).toBe('22.50000, 88.30000');
  });
  it('formats string (Decimal-over-JSON) coords', () => {
    expect(formatCoords({ lat: '22.5', lng: '88.3' })).toBe('22.50000, 88.30000');
  });
  it('returns a dash when a coord is missing or invalid', () => {
    expect(formatCoords({ lat: null, lng: 88.3 })).toBe('—');
    expect(formatCoords({ lat: 'abc', lng: '88.3' })).toBe('—');
  });
});

describe('displayPhone', () => {
  it('splits a +91 E.164 number', () => {
    expect(displayPhone('+919830011252')).toBe('+91 9830011252');
  });
  it('passes through a bare number', () => {
    expect(displayPhone('9830011252')).toBe('9830011252');
  });
});

describe('base64ToBlob', () => {
  it('decodes base64 into a blob of the right byte length', () => {
    const b64 = btoa('hello'); // 5 bytes
    const blob = base64ToBlob(b64, 'text/plain');
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('text/plain');
  });
});
