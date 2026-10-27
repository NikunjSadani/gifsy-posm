'use client';

import { useRef, useState } from 'react';
import { UploadCloud, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ApiResponse } from '@/lib/api-client';
import { summarizeUpload, downloadErrorReport, downloadSuccessReport } from '@/lib/admin/format';
import type { BulkUploadResult } from '@/lib/admin/types';
import { cn } from '@/lib/utils';

const MAX_BYTES = 5 * 1024 * 1024; // mirrors the backend Multer cap (F2)

/**
 * Generic Excel bulk-upload panel (shared by the Sites and Users masters). Renders the exact
 * template contract for the given `headers`, enforces the 5 MB client pre-check (the backend also
 * caps at 5 MB / 5000 rows), then reports EXACTLY what the backend returned — imported / rejected
 * counts + a downloadable per-row rejection report. It never fabricates success.
 */
export function UploadPanel({
  title,
  description,
  headers,
  requiredHeaders,
  hint,
  upload,
  templateUrl,
  templateFileName = 'upload-template.xlsx',
  onUploaded,
}: {
  title: string;
  description: React.ReactNode;
  headers: readonly string[];
  requiredHeaders: readonly string[];
  hint?: React.ReactNode;
  upload: (file: File) => Promise<ApiResponse<BulkUploadResult>>;
  /** When set, shows a "Download template" button that fetches this auth-gated blank .xlsx. */
  templateUrl?: string;
  templateFileName?: string;
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkUploadResult | null>(null);

  const downloadTemplate = async () => {
    if (!templateUrl) return;
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
      setError('Please choose an .xlsx or .xls file (use the template columns below).');
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
    if (res.data.successCount > 0) onUploaded?.();
  };

  const summary = result ? summarizeUpload(result) : null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileSpreadsheet className="h-5 w-5 text-[var(--brand-primary)]" />
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">{description}</p>

      {/* Template contract */}
      <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-xs font-medium text-gray-600">Template columns (header row 1):</p>
          {templateUrl && (
            <button
              type="button"
              onClick={downloadTemplate}
              disabled={downloadingTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 active:scale-95 transition-all"
            >
              <Download className="h-3.5 w-3.5" />
              {downloadingTemplate ? 'Preparing…' : 'Download template'}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {headers.map((h) => {
            const required = (requiredHeaders as readonly string[]).includes(h);
            return (
              <span
                key={h}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-mono',
                  required
                    ? 'border-[var(--brand-primary)]/30 bg-[var(--brand-primary-light)] text-[var(--brand-primary-dark)]'
                    : 'border-gray-200 bg-white text-gray-600',
                )}
              >
                {h}
                {required && <span className="text-[10px] font-sans font-semibold">req</span>}
              </span>
            );
          })}
        </div>
        {hint && <p className="text-[11px] text-gray-500 mt-2">{hint}</p>}
      </div>

      {/* File picker */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
        />
        <Button variant="primary" onClick={doUpload} disabled={!file} loading={uploading} className="shrink-0">
          <UploadCloud className="h-4 w-4" />
          Upload
        </Button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div
          className={cn(
            'mt-4 rounded-xl border p-4',
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
              <p className="text-sm font-medium text-gray-900">{summary.headline}</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>Total rows: <strong>{summary.rowCount}</strong></span>
                <span>Imported: <strong className="text-emerald-700">{summary.successCount}</strong></span>
                <span>Rejected: <strong className="text-red-700">{summary.errorCount}</strong></span>
              </div>
              {(summary.hasErrorFile || summary.hasSuccessFile) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {summary.hasErrorFile && result?.errorFileBase64 && (
                    <button
                      type="button"
                      onClick={() => downloadErrorReport(result.errorFileBase64!)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 active:scale-95 transition-all"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download rejected rows (with reasons)
                    </button>
                  )}
                  {summary.hasSuccessFile && result?.successFileBase64 && (
                    <button
                      type="button"
                      onClick={() => downloadSuccessReport(result.successFileBase64!)}
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

export default UploadPanel;
