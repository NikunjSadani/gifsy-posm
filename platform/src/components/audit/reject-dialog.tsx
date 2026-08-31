'use client';

/**
 * Reject modal — the consequential "fail" side of the audit QA gate.
 *
 * Requires a controlled reason CODE (the backend `reasonCode` is mandatory) before it will
 * submit; a free-text note is also required when the reason is OTHER. The submit button is
 * disabled while the request is in flight to prevent a double-submit.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { REJECT_REASONS, type RejectBody, type RejectReasonCode } from '@/lib/audit/api';
import { useFocusTrap } from '@/components/audit/use-focus-trap';

const NOTE_MAX = 500;

export function RejectDialog({
  open,
  siteLabel,
  loading,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  siteLabel: string;
  loading: boolean;
  onSubmit: (body: RejectBody) => void;
  onCancel: () => void;
}) {
  const [reasonCode, setReasonCode] = useState<RejectReasonCode | ''>('');
  const [note, setNote] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset the form each time the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setReasonCode('');
      setNote('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  // Move focus into the dialog on open, trap Tab, and return focus to the trigger on close.
  useFocusTrap(open, dialogRef);

  if (!open) return null;

  const noteRequired = reasonCode === 'OTHER';
  const noteOk = !noteRequired || note.trim().length > 0;
  const canSubmit = !!reasonCode && noteOk && !loading;

  const submit = () => {
    if (!reasonCode || !noteOk) return;
    const trimmed = note.trim();
    onSubmit({ reasonCode, ...(trimmed ? { reason: trimmed } : {}) });
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4 fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Reject installation"
      onClick={() => !loading && onCancel()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-2xl bg-red-50 flex items-center justify-center shrink-0">
            <XCircle className="h-5 w-5 text-[var(--brand-primary)]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900">Reject installation</h2>
            <p className="text-sm text-gray-600 mt-1">
              This sends <span className="font-semibold">{siteLabel}</span> back as AUDIT_REJECTED.
              Pick a reason.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="reject-reason" className="block text-sm font-medium text-gray-700 mb-1.5">
            Reason <span className="text-[var(--brand-primary)]">*</span>
          </label>
          <select
            id="reject-reason"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as RejectReasonCode | '')}
            disabled={loading}
            className="w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-[var(--brand-primary)] disabled:opacity-50"
          >
            <option value="" disabled>
              Select a reason…
            </option>
            {REJECT_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <label htmlFor="reject-note" className="block text-sm font-medium text-gray-700 mb-1.5">
            Note {noteRequired ? <span className="text-[var(--brand-primary)]">*</span> : <span className="text-gray-400 font-normal">(optional)</span>}
          </label>
          <textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            disabled={loading}
            rows={3}
            placeholder={noteRequired ? 'Describe the issue (required for “Other”)' : 'Add any detail for the vendor…'}
            className="w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-[var(--brand-primary)] disabled:opacity-50 resize-none"
          />
          <p className="text-[11px] text-gray-400 mt-1 text-right">
            {note.length}/{NOTE_MAX}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] disabled:opacity-60 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Rejecting…' : 'Reject installation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RejectDialog;
