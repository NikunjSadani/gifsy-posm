'use client';

/**
 * Audit detail — the per-installation review desk. Shows site + submission context and a
 * side-by-side before(recce)/after(install) comparison for every POSM, then the two
 * consequential decisions: Approve (confirm step) and Reject (reason required).
 *
 * Data source: `GET /api/audit/installations/:id` — the auditor/admin-scoped single-record
 * read (the `GET /v1/installation/:id` endpoint is VENDOR_FIELD-only and would 403 here). It
 * returns an installation in any status and works past the queue's page cap. Only a SUBMITTED
 * installation is actionable; anything already audited (or out of scope) shows the honest "no
 * longer awaiting audit" state. After a decision the record leaves the queue → back to queue.
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  MapPin,
  User,
  Clock,
  Camera,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { BeforeAfter } from '@/components/audit/before-after';
import { GeoBadge } from '@/components/audit/geo-badge';
import { ConfirmDialog } from '@/components/audit/confirm-dialog';
import { RejectDialog } from '@/components/audit/reject-dialog';
import { Lightbox } from '@/components/audit/media-image';
import {
  approveInstallation,
  fetchInstallation,
  rejectInstallation,
  formatLatLng,
  type QueueItem,
  type RejectBody,
} from '@/lib/audit/api';
import { formatDateTime } from '@/lib/utils';

export default function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [item, setItem] = useState<QueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false); // no longer in the SUBMITTED queue

  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [lightbox, setLightbox] = useState<{ src: string; alt: string; markup?: unknown } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setGone(false);
    fetchInstallation(id).then((res) => {
      if (cancelled) return;
      if (res.success) {
        // Only a SUBMITTED installation is actionable; anything already audited shows the
        // honest "no longer awaiting audit" state (same UX as before, now also correct for a
        // record beyond the queue's page cap).
        if (res.data.status === 'SUBMITTED') setItem(res.data);
        else setGone(true);
      } else if (res.status === 404) {
        // Not found or outside this auditor's tenant scope.
        setGone(true);
      } else {
        setError(res.error || 'Could not load this installation.');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const siteLabel = item ? `${item.site.name} (${item.site.code})` : 'this installation';

  const doApprove = async () => {
    setSubmitting(true);
    const res = await approveInstallation(id);
    setSubmitting(false);
    if (res.success) {
      setConfirmApprove(false);
      toast.success('Installation approved');
      router.push('/audit/installations');
    } else {
      // Keep the dialog open on a recoverable error; surface a clear message.
      toast.error(res.error || 'Could not approve. Please try again.');
      if (res.status === 409) {
        setConfirmApprove(false);
        setGone(true);
      }
    }
  };

  const doReject = async (body: RejectBody) => {
    setSubmitting(true);
    const res = await rejectInstallation(id, body);
    setSubmitting(false);
    if (res.success) {
      setRejectOpen(false);
      toast.success('Installation rejected');
      router.push('/audit/installations');
    } else {
      toast.error(res.error || 'Could not reject. Please try again.');
      if (res.status === 409) {
        setRejectOpen(false);
        setGone(true);
      }
    }
  };

  return (
    <div className="fade-in pb-24">
      <Link
        href="/audit/installations"
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to queue
      </Link>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
          <Link
            href="/audit/installations"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all"
          >
            Back to queue
          </Link>
        </div>
      ) : gone || !item ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No longer awaiting audit</p>
          <p className="text-xs text-gray-500 mt-1">
            This installation has already been audited or is outside your scope.
          </p>
          <Link
            href="/audit/installations"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all"
          >
            Back to queue
          </Link>
        </div>
      ) : (
        <>
          {/* Site + submission context */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-gray-900">{item.site.name}</h1>
                <p className="text-xs font-mono text-gray-400">{item.site.code}</p>
                {item.site.town && <p className="text-sm text-gray-600 mt-0.5">{item.site.town}</p>}
              </div>
              <GeoBadge geoFenceOk={item.recceGeo.geoFenceOk} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <Meta icon={User} label="Submitted by" value={item.submittedBy?.name ?? 'Unknown'} />
              <Meta icon={Camera} label="Elements" value={String(item.compare.length)} />
              <Meta
                icon={Clock}
                label="Captured"
                value={item.capturedAt ? formatDateTime(item.capturedAt) : '—'}
              />
              <Meta icon={Clock} label="Received" value={formatDateTime(item.receivedAt)} />
            </div>

            {formatLatLng(item.site.lat, item.site.lng) && (
              <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-gray-500 font-mono">
                <MapPin className="h-3.5 w-3.5 text-gray-400" />
                Site: {formatLatLng(item.site.lat, item.site.lng)}
              </p>
            )}
          </div>

          {/* Per-POSM before/after */}
          <div className="space-y-4">
            {item.compare.map((row, i) => (
              <BeforeAfter
                key={row.installPosmId}
                row={row}
                index={i + 1}
                onEnlarge={(src, alt, markup) => setLightbox({ src, alt, markup })}
              />
            ))}
          </div>

          {/* Sticky action bar */}
          <div className="fixed inset-x-0 bottom-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-end gap-3">
              <button
                onClick={() => setRejectOpen(true)}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-[var(--brand-primary)] text-[var(--brand-primary)] hover:bg-[var(--brand-primary-light)] font-bold px-5 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
              <button
                onClick={() => setConfirmApprove(true)}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-confirm)] hover:brightness-95 text-white font-bold px-5 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve
              </button>
            </div>
          </div>

          <ConfirmDialog
            open={confirmApprove}
            title="Approve this installation?"
            message={`This marks ${siteLabel} as AUDIT_APPROVED — the final QA sign-off. This cannot be changed from here.`}
            confirmLabel="Approve"
            loading={submitting}
            onConfirm={doApprove}
            onCancel={() => !submitting && setConfirmApprove(false)}
          />

          <RejectDialog
            open={rejectOpen}
            siteLabel={siteLabel}
            loading={submitting}
            onSubmit={doReject}
            onCancel={() => !submitting && setRejectOpen(false)}
          />
        </>
      )}

      <Lightbox src={lightbox?.src ?? null} alt={lightbox?.alt ?? ''} markup={lightbox?.markup} onClose={() => setLightbox(null)} />
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="text-sm text-gray-800 mt-0.5 truncate">{value}</p>
    </div>
  );
}
