'use client';

/**
 * Submission review — render each answer against its field, then Approve (confirm) or Reject
 * (reason required). Actions only show while the submission is awaiting review; both confirm,
 * disable while in-flight, and refetch after so the page reflects the new state.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, X, User, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { AnswerViewer } from '@/components/manual/answer-viewer';
import { SubmissionStatusPill } from '@/components/manual/status-pill';
import {
  type SubmissionDetail,
  manualApi,
  submitterName,
  formatDateTime,
} from '@/lib/manual/admin-api';

export default function SubmissionReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await manualApi.getSubmission(id);
    if (res.success) {
      setDetail(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error || 'Could not load this submission.');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const doApprove = async () => {
    setApproveBusy(true);
    setApproveError(null);
    const res = await manualApi.approveSubmission(id);
    setApproveBusy(false);
    if (!res.success) {
      setApproveError(res.error || 'Could not approve this submission.');
      return;
    }
    toast.success('Submission approved');
    setApproveOpen(false);
    void load();
  };

  const doReject = async () => {
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError('A rejection reason is required.');
      return;
    }
    setRejectBusy(true);
    setRejectError(null);
    const res = await manualApi.rejectSubmission(id, reason);
    setRejectBusy(false);
    if (!res.success) {
      setRejectError(res.error || 'Could not reject this submission.');
      return;
    }
    toast.success('Submission rejected');
    setRejectOpen(false);
    setRejectReason('');
    void load();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div>
        <Link href="/admin/manual" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" />
          Manual tasks
        </Link>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-red-700">{loadError || 'Submission not found.'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const canReview = detail.status === 'SUBMITTED';

  return (
    <div>
      <Link
        href={`/admin/manual/${detail.task.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        {detail.task.title}
      </Link>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">Review submission</h1>
            <SubmissionStatusPill status={detail.status} />
            <span className="text-sm text-gray-400">v{detail.version}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {submitterName(detail.submittedBy)}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Submitted {formatDateTime(detail.createdAt)}
            </span>
            {detail.reviewedAt && <span>Reviewed {formatDateTime(detail.reviewedAt)}</span>}
          </div>
        </div>

        {canReview && (
          <div className="flex items-center gap-2">
            <Button variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => { setRejectOpen(true); setRejectError(null); }}>
              <X className="h-4 w-4" />
              Reject
            </Button>
            <Button variant="primary" onClick={() => { setApproveOpen(true); setApproveError(null); }}>
              <Check className="h-4 w-4" />
              Approve
            </Button>
          </div>
        )}
      </div>

      {/* Rejection reason banner (for an already-rejected submission) */}
      {detail.status === 'REJECTED' && detail.rejectionReason && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Rejection reason</p>
          <p className="mt-1 text-sm text-red-800">{detail.rejectionReason}</p>
        </div>
      )}

      {/* Answers */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Answers</h2>
        {detail.values.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">This submission has no recorded answers.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {detail.values.map((row, i) => (
              <AnswerViewer key={row.field.id || i} row={row} />
            ))}
          </div>
        )}
      </div>

      {/* Approve confirm */}
      <ConfirmDialog
        open={approveOpen}
        onOpenChange={(o) => !o && setApproveOpen(false)}
        title="Approve this submission?"
        description="This marks the submission as approved. You can't undo it from here."
        confirmLabel="Approve"
        destructive={false}
        loading={approveBusy}
        error={approveError}
        onConfirm={doApprove}
      />

      {/* Reject with reason */}
      <Modal
        open={rejectOpen}
        onOpenChange={(o) => {
          if (!rejectBusy) setRejectOpen(o);
        }}
        title="Reject submission"
        description="Tell the field team what needs fixing. This reason is required."
      >
        <div className="flex flex-col gap-3">
          {rejectError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{rejectError}</div>
          )}
          <textarea
            value={rejectReason}
            onChange={(e) => {
              setRejectReason(e.target.value);
              if (rejectError) setRejectError(null);
            }}
            placeholder="e.g. The freezer photo is blurry — please recapture in daylight."
            rows={4}
            maxLength={1000}
            autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={rejectBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doReject} loading={rejectBusy} disabled={!rejectReason.trim()}>
              Reject submission
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
