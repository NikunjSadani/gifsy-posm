'use client';

/**
 * Recce DETAIL — the ASM's full-photo review of one recce, with Approve / Reject.
 *
 * Data source: `GET /api/approval/recces/:id` — the scoped single-recce read. It applies the
 * same tenant + ASM-territory confinement as the queue and returns a recce in ANY status, so
 * this view works for a recce past the queue's page cap or one that's already been reviewed. An
 * id outside the caller's scope (or missing) comes back 404 → honest not-found state.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  MapPin,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
} from 'lucide-react';
import {
  fetchRecce,
  approveRecce,
  rejectRecce,
  recceFlags,
  type RecceQueueItem,
  type RejectBody,
} from '@/lib/review/api';
import { formatDateTime } from '@/lib/utils';
import { PhotoViewer } from '@/components/review/photo-viewer';
import { ConfirmDialog } from '@/components/review/confirm-dialog';
import { RejectDialog } from '@/components/review/reject-dialog';
import { Spinner } from '@/components/ui/spinner';

export default function RecceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [item, setItem] = useState<RecceQueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Non-null when the recce is no longer SUBMITTED (already APPROVED/REJECTED). `getRecce`
  // returns a recce in ANY status, so the actionable detail is shown ONLY for SUBMITTED —
  // otherwise we render an honest "already reviewed" state with no dead Approve/Reject bar.
  const [reviewedStatus, setReviewedStatus] = useState<string | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setReviewedStatus(null);
    const res = await fetchRecce(id);
    if (!res.success) {
      // A 404 is the "not in your scope / no longer exists" case — a distinct, honest state
      // from a transport/server error (which offers a retry).
      if (res.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setError(res.error || 'Could not load this recce.');
      setLoading(false);
      return;
    }
    setItem(res.data);
    // Only a SUBMITTED recce is actionable; anything already reviewed shows the reviewed state.
    if (res.data.status !== 'SUBMITTED') setReviewedStatus(res.data.status);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onApprove = async () => {
    setActing(true);
    const res = await approveRecce(id);
    setActing(false);
    setApproveOpen(false);
    if (!res.success) {
      toast.error(res.error || 'Could not approve this recce.');
      // A 409 means it was reviewed by someone else between load and click — flip to the
      // honest reviewed state (re-fetch its true status) instead of leaving dead buttons.
      if (res.status === 409) void load();
      return;
    }
    toast.success('Recce approved. Installation is unlocked for this outlet.');
    router.push('/review/recces');
  };

  const onReject = async (body: RejectBody) => {
    setActing(true);
    const res = await rejectRecce(id, body);
    setActing(false);
    setRejectOpen(false);
    if (!res.success) {
      toast.error(res.error || 'Could not reject this recce.');
      if (res.status === 409) void load();
      return;
    }
    toast.success('Recce rejected. The vendor will be asked to re-capture.');
    router.push('/review/recces');
  };

  const back = (
    <Link
      href="/review/recces"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
    >
      <ArrowLeft className="h-4 w-4" /> Back to queue
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {back}
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-red-800">Couldn&apos;t load this recce</p>
          <p className="text-sm text-red-600 mt-1">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] rounded-xl px-4 py-2 active:scale-95 transition-all"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
          <p className="text-base font-semibold text-gray-900">This recce isn&apos;t available</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            It may have been removed, or it isn&apos;t in your territory. Return to the queue to see
            what&apos;s currently awaiting review.
          </p>
          <Link
            href="/review/recces"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] rounded-xl px-4 py-2 active:scale-95 transition-all"
          >
            <ArrowLeft className="h-4 w-4" /> Back to queue
          </Link>
        </div>
      </div>
    );
  }

  if (reviewedStatus) {
    const approved = reviewedStatus === 'APPROVED';
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
          <div
            className={`mx-auto mb-3 h-12 w-12 rounded-2xl flex items-center justify-center ${
              approved ? 'bg-emerald-50' : 'bg-red-50'
            }`}
          >
            {approved ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            ) : (
              <XCircle className="h-6 w-6 text-red-600" />
            )}
          </div>
          <p className="text-base font-semibold text-gray-900">
            This recce has already been {approved ? 'approved' : 'rejected'}
          </p>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            {item ? `${item.site.name} (${item.site.code}) ` : ''}is no longer awaiting review, so it
            can&apos;t be actioned here. Return to the queue to review what&apos;s pending.
          </p>
          <Link
            href="/review/recces"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] rounded-xl px-4 py-2 active:scale-95 transition-all"
          >
            <ArrowLeft className="h-4 w-4" /> Back to queue
          </Link>
        </div>
      </div>
    );
  }

  const flags = recceFlags(item);
  const captured = item.capturedAt;
  const received = item.receivedAt;

  return (
    <div className="space-y-5 fade-in pb-28">
      {back}

      {/* Site header */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{item.site.name}</h1>
              <span className="text-sm font-medium text-gray-400">{item.site.code}</span>
              {item.version > 1 && (
                <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                  Recapture v{item.version}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 mt-2 text-sm text-gray-600">
              {item.site.town && (
                <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-gray-400" /> {item.site.town}</span>
              )}
              {item.submittedBy && (
                <span className="flex items-center gap-1.5"><User className="h-4 w-4 text-gray-400" /> {item.submittedBy.name}</span>
              )}
              {captured && (
                <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" /> Captured {formatDateTime(captured)}</span>
              )}
              {received && (
                <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" /> Received {formatDateTime(received)}</span>
              )}
            </div>
          </div>

          {/* Geo-fence badge */}
          <div className="shrink-0">
            {item.integrity.geoFenceOk === true ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
                <ShieldCheck className="h-4 w-4" /> Inside geo-fence
              </span>
            ) : item.integrity.geoFenceOk === false ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
                <ShieldAlert className="h-4 w-4" /> Outside geo-fence
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-3 py-1.5">
                <ShieldQuestion className="h-4 w-4" /> Location not verified
              </span>
            )}
          </div>
        </div>

        {/* Integrity detail */}
        {(item.integrity.distanceMeters != null ||
          item.integrity.captureAccuracy != null ||
          (item.integrity.captureLat != null && item.integrity.captureLng != null)) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
            {item.integrity.distanceMeters != null && (
              <Stat label="Distance from outlet" value={`${Math.round(item.integrity.distanceMeters)} m`} />
            )}
            {item.integrity.captureAccuracy != null && (
              <Stat label="GPS accuracy" value={`±${Math.round(item.integrity.captureAccuracy)} m`} />
            )}
            {item.integrity.captureLat != null && item.integrity.captureLng != null && (
              <Stat
                label="Capture location"
                value={`${item.integrity.captureLat.toFixed(5)}, ${item.integrity.captureLng.toFixed(5)}`}
              />
            )}
          </div>
        )}
      </div>

      {/* Integrity flags */}
      {flags.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Review carefully — {flags.length} flag{flags.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-2 space-y-1">
            {flags.map((f) => (
              <li key={f} className="text-sm text-amber-700 flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-amber-500 shrink-0" /> {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Photos */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Element photos ({item.posms.length})
        </h2>
        <PhotoViewer posms={item.posms} />
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-end gap-3">
          <button
            onClick={() => setRejectOpen(true)}
            disabled={acting}
            className="flex items-center gap-1.5 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl px-4 py-2.5 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle className="h-4 w-4" /> Reject
          </button>
          <button
            onClick={() => setApproveOpen(true)}
            disabled={acting}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[var(--brand-confirm)] hover:brightness-95 rounded-xl px-5 py-2.5 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="h-4 w-4" /> Approve
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={approveOpen}
        title="Approve this recce?"
        message={
          <>
            Approving <span className="font-semibold">{item.site.name}</span> ({item.site.code}) unlocks
            installation for this outlet. This can&apos;t be undone from here.
          </>
        }
        confirmLabel="Approve"
        confirmVariant="primary"
        loading={acting}
        onConfirm={() => void onApprove()}
        onCancel={() => setApproveOpen(false)}
      />

      <RejectDialog
        open={rejectOpen}
        siteLabel={`${item.site.name} (${item.site.code})`}
        loading={acting}
        onConfirm={(body) => void onReject(body)}
        onCancel={() => setRejectOpen(false)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}
