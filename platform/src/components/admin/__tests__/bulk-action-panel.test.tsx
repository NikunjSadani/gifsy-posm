import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { ApiResponse } from '@/lib/api-client';
import type { BulkUploadResult } from '@/lib/admin/types';
import { BulkActionPanel } from '../bulk-action-panel';

const makeResult = (over: Partial<BulkUploadResult>): BulkUploadResult => ({
  batchId: 'b1',
  rowCount: 0,
  successCount: 0,
  errorCount: 0,
  errorFileBase64: null,
  successFileBase64: null,
  ...over,
});

/** A valid .xlsx file of a given size (size overridden so we don't allocate megabytes). */
const makeFile = (name: string, size: number): File => {
  const f = new File(['x'], name, { type: 'application/octet-stream' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const pickFile = (file: File) => {
  const input = screen.getByLabelText('Choose an .xlsx or .xls file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  // URL object-url APIs are not implemented in jsdom.
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('BulkActionPanel', () => {
  it('downloads the template from the given templateUrl', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['x']) });
    vi.stubGlobal('fetch', fetchMock);

    const upload = vi.fn(async () => ({ success: true, data: makeResult({}) }) as ApiResponse<BulkUploadResult>);
    render(<BulkActionPanel templateUrl="/api/sites/bulk-deactivate/template" upload={upload} />);

    fireEvent.click(screen.getByRole('button', { name: /download template/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/sites/bulk-deactivate/template', expect.anything()),
    );
    vi.unstubAllGlobals();
  });

  it('on a successful upload with BOTH reports, shows both download buttons', async () => {
    const upload = vi.fn().mockResolvedValue({
      success: true,
      data: makeResult({ rowCount: 5, successCount: 3, errorCount: 2, errorFileBase64: 'AAAA', successFileBase64: 'BBBB' }),
    });
    const onDone = vi.fn();
    render(<BulkActionPanel templateUrl="/t" upload={upload} onDone={onDone} />);

    pickFile(makeFile('ok.xlsx', 1000));
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /download rejected rows/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download success report/i })).toBeInTheDocument();
    // Processed at least one row → onDone fires (list refresh).
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // Neutral counts (works for deactivate too) — present in both headline and count chip.
    expect(screen.getAllByText(/processed/i).length).toBeGreaterThan(0);
  });

  it('shows ONLY the error button when there is no success file', async () => {
    const upload = vi.fn().mockResolvedValue({
      success: true,
      data: makeResult({ rowCount: 3, successCount: 0, errorCount: 3, errorFileBase64: 'AAAA', successFileBase64: null }),
    });
    const onDone = vi.fn();
    render(<BulkActionPanel templateUrl="/t" upload={upload} onDone={onDone} />);

    pickFile(makeFile('ok.xlsx', 1000));
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /download rejected rows/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download success report/i })).toBeNull();
    // Nothing processed → onDone must NOT fire.
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows NEITHER report button when both files are null', async () => {
    const upload = vi.fn().mockResolvedValue({
      success: true,
      data: makeResult({ rowCount: 2, successCount: 2, errorCount: 0, errorFileBase64: null, successFileBase64: null }),
    });
    render(<BulkActionPanel templateUrl="/t" upload={upload} />);

    pickFile(makeFile('ok.xlsx', 1000));
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /download rejected rows/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /download success report/i })).toBeNull();
  });

  it('rejects a file larger than 5 MB before uploading', async () => {
    const upload = vi.fn();
    render(<BulkActionPanel templateUrl="/t" upload={upload} />);

    pickFile(makeFile('big.xlsx', 6 * 1024 * 1024));
    expect(screen.getByText(/larger than 5 MB/i)).toBeInTheDocument();
    // The upload button stays disabled (no valid file selected).
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeDisabled();
    expect(upload).not.toHaveBeenCalled();
  });
});
