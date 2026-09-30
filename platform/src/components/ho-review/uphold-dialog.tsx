'use client';

/**
 * HO "uphold rejection" modal — the terminal reject side of the HO escalation stage.
 *
 * Unlike the auditor's reject (which needs a controlled reason CODE), HO is UPHOLDING the
 * auditor's already-recorded reason, so it only takes an OPTIONAL free-text note. Submit is
 * disabled while in flight to prevent a double-submit; backdrop/Escape are inert while loading.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { useFocusTrap } from '@/components/audit/use-focus-trap';

const NOTE_MAX = 500;

export function UpholdDialog({
  open,
  siteLabel,
  loading,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  siteLabel: string;
  loading: boolean;
  onSubmit: (note: string | undefined) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setNote(''); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  useFocusTrap(open, dialogRef);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Uphold rejection"
      onClick={() => !loading && onCancel()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
            <XCircle className="h-5 w-5 text-[var(--brand-primary)]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900">Uphold the rejection?</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              This is a final decision — {siteLabel} stays REJECTED and closes. Add an optional note.
            </p>
          </div>
        </div>

        <label className="block mt-4 text-xs font-semibold text-gray-500">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            rows={3}
            placeholder="Why the escalation is declined…"
            className="mt-1 w-full text-sm text-gray-900 bg-white rounded-xl border border-gray-200 px-3 py-2 focus:outline-none focus:border-[var(--brand-primary)] resize-none"
          />
          <span className="block text-right text-[10px] text-gray-400">{note.length}/{NOTE_MAX}</span>
        </label>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(note.trim() || undefined)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white font-bold px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Uphold rejection
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpholdDialog;
