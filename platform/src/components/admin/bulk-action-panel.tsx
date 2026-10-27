'use client';

import { useRef, useState } from 'react';
import { UploadCloud, Download, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ApiResponse } from '@/lib/api-client';
import { summarizeUpload, downloadErrorReport, downloadSuccessReport } from '@/lib/admin/format';
import type { BulkUploadResult } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

const MAX_BYTES = 5 * 1024 * 1024; // mirrors the backend Multer cap

/**
 * Compact Excel bulk-action panel for use INSIDE a modal (bulk upload / bulk deactivate).
 * Unlike the big <UploadPanel>, it skips the template-column chip grid: a one-line instruction,
 * a "Download template" button, a file picker (5 MB client pre-check), an "Upload" button, then
 * the EXACT backend result — total / processed / rejected — with a "Download rejected rows" button
 * (when there is a rejection report) AND a "Download success report" button (when there is one).
 * It never fabricates success — it reports precisely what the backend returned.
 */
export function BulkActionPanel({
  title,
  instructions,
  templateUrl,
  templateFileName = 'template.xlsx',
  reportBaseName = 'bulk',
  upload,
  onDone,
}: {
  title?: string;
  instructions?: React.ReactNode;
  /** Auth-gated blank .xlsx template endpoint. */
  templateUrl: string;
  templateFileName?: string;
  /** Prefix for the downloaded success/rejected report filenames (e.g. "outlet-deactivate"). */
  reportBaseName?: string;
  upload: (file: File) => Promise<ApiResponse<BulkUploadResult>>;
  /** Called after an upload that processed at least one row (successCount > 0). */
  onDone?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkUploadResult | null>(null);

  const downloadTemplate = async () => {
    setDownloadingTemplate(true);
    setError(null);
    try {
      const res = await fetch(templateUrl, { method: 'GET', credentials: 'include' });
      if (!res.ok) {
        setError(res.status === 403 ? 'You are not allowed to download the template.' : `Template download failed (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = templateFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError('Could not download the template. Please try again.');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const pick = (f: File | null) => {
    setError(null);
    setResult(null);
    if (!f) {
      setFile(null);
      return;
    }
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      setError('Please choose an .xlsx or .xls file (use the template).');
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('That file is larger than 5 MB. Split it and upload in batches.');
      setFile(null);
      return;
    }
    setFile(f);
  };

  const doUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    const res = await upload(file);
    setUploading(false);
    if (!res.success) {
      setError(res.error || 'Upload failed. Please try again.');
      return;
    }
    setResult(res.data);
    // Clear the chosen file so a re-upload is a deliberate re-pick.
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
    if (res.data.successCount > 0) onDone?.();
  };

  const summary = result ? summarizeUpload(result) : null;
  // A neutral processed/rejected headline that reads correctly for both import and deactivate.
  const headline = summary
    ? summary.tone === 'success'
      ? `All ${summary.rowCount} ${summary.rowCount === 1 ? 'row' : 'rows'} processed.`
      : summary.tone === 'error'
        ? `No rows processed — all ${summary.rowCount} rejected.`
        : `${summary.successCount} of ${summary.rowCount} processed — ${summary.errorCount} rejected.`
    : '';

  return (
    <div className="flex flex-col gap-3">
      {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
      {instructions && <p className="text-sm text-gray-500">{instructions}</p>}

      <div>
        <button
          type="button"
          onClick={downloadTemplate}
          disabled={downloadingTemplate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 active:scale-95 transition-all"
        >
          <Download className="h-3.5 w-3.5" />
          {downloadingTemplate ? 'Preparing…' : 'Download template'}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          aria-label="Choose an .xlsx or .xls file"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
        />
        <Button variant="primary" onClick={doUpload} disabled={!file} loading={uploading} className="shrink-0">
          <UploadCloud className="h-4 w-4" />
          Upload
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div
          className={cn(
            'rounded-xl border p-4',
            summary.tone === 'success' && 'border-emerald-200 bg-emerald-50',
            summary.tone === 'partial' && 'border-amber-200 bg-amber-50',
            summary.tone === 'error' && 'border-red-200 bg-red-50',
          )}
        >
          <div className="flex items-start gap-2">
            {summary.tone === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            ) : summary.tone === 'partial' ? (
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{headline}</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>Total rows: <strong>{summary.rowCount}</strong></span>
                <span>Processed: <strong className="text-emerald-700">{summary.successCount}</strong></span>
                <span>Rejected: <strong className="text-red-700">{summary.errorCount}</strong></span>
              </div>
              {(summary.hasErrorFile || summary.hasSuccessFile) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {summary.hasErrorFile && result?.errorFileBase64 && (
                    <button
                      type="button"
                      onClick={() => downloadErrorReport(result.errorFileBase64!, `${reportBaseName}-rejected.xlsx`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-all"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download rejected rows (with reasons)
                    </button>
                  )}
                  {summary.hasSuccessFile && result?.successFileBase64 && (
                    <button
                      type="button"
                      onClick={() => downloadSuccessReport(result.successFileBase64!, `${reportBaseName}-success.xlsx`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-all"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download success report
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BulkActionPanel;
