'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  REJECT_REASON_CODES,
  REJECT_REASON_LABELS,
  type RejectReasonCode,
  type RejectBody,
} from '@/lib/review/api';
import { useFocusTrap } from './use-focus-trap';

/**
 * Reject modal for a recce. A rejection REQUIRES a controlled reason code (the backend refuses
 * a free-text-only rejection); an optional note (≤500 chars) rides alongside. The confirm
 * button stays disabled until a code is chosen and while the request is in flight, preventing
 * an empty or double submit. State resets each time the dialog opens.
 */
export function RejectDialog({
  open,
  siteLabel,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  siteLabel?: string;
  loading?: boolean;
  onConfirm: (body: RejectBody) => void;
  onCancel: () => void;
}) {
  const [reasonCode, setReasonCode] = useState<RejectReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Fresh state each open.
  useEffect(() => {
    if (open) {
      setReasonCode('');
      setReason('');
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

  useFocusTrap(open, panelRef);

  if (!open) return null;

  // A free-text note is mandatory when the reason is "Other" — the code alone says nothing.
  const noteRequired = reasonCode === 'OTHER';
  const noteOk = !noteRequired || reason.trim().length > 0;
  const canSubmit = reasonCode !== '' && noteOk && !loading;

  const submit = () => {
    if (reasonCode === '' || !noteOk) return;
    const trimmed = reason.trim();
    onConfirm({ reasonCode, ...(trimmed ? { reason: trimmed } : {}) });
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      onClick={() => !loading && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-label="Reject recce"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 fade-in outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900">Reject recce</h2>
        <p className="text-sm text-gray-600 mt-1">
          {siteLabel ? (
            <>
              The vendor will be asked to re-capture <span className="font-semibold">{siteLabel}</span>.
            </>
          ) : (
            'The vendor will be asked to re-capture this site.'
          )}
        </p>

        <label htmlFor="reject-reason-code" className="block text-sm font-medium text-gray-700 mt-4 mb-1.5">
          Reason <span className="text-[var(--brand-primary)]">*</span>
        </label>
        <select
          id="reject-reason-code"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value as RejectReasonCode | '')}
          disabled={loading}
          className="w-full rounded-xl border-2 border-gray-200 focus:border-[var(--brand-primary)] focus:outline-none px-3 py-2.5 text-sm text-gray-900 bg-white disabled:opacity-50"
        >
          <option value="">Select a reason…</option>
          {REJECT_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {REJECT_REASON_LABELS[code]}
            </option>
          ))}
        </select>

        <label htmlFor="reject-reason-note" className="block text-sm font-medium text-gray-700 mt-4 mb-1.5">
          Note{' '}
          {noteRequired ? (
            <span className="text-[var(--brand-primary)]">*</span>
          ) : (
            <span className="font-normal text-gray-400">(optional)</span>
          )}
        </label>
        <textarea
          id="reject-reason-note"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 500))}
          disabled={loading}
          rows={3}
          placeholder={
            noteRequired
              ? 'Describe the issue (required for “Other”)'
              : 'Add any detail that helps the vendor fix the recapture…'
          }
          className="w-full rounded-xl border-2 border-gray-200 focus:border-[var(--brand-primary)] focus:outline-none px-3 py-2.5 text-sm text-gray-900 resize-none disabled:opacity-50"
        />
        <p className="text-xs text-gray-400 mt-1 text-right">{reason.length}/500</p>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit} loading={loading}>
            Reject recce
          </Button>
        </div>
      </div>
    </div>
  );
}

export default RejectDialog;
