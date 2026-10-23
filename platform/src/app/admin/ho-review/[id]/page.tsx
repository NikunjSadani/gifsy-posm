'use client';

/**
 * HO review detail — the Head-Office decision desk for one audit-rejected installation
 * (owner decision 2026-09-30). Shows the auditor's rejection reason prominently, the same
 * before(recce)/after(install) compare the auditor saw, and the two terminal decisions:
 * Approve (override the audit reject) and Uphold rejection (final REJECTED).
 *
 * Data source: GET /api/ho-review/installations/:id (CLIENT_ADMIN/GIFSY_ADMIN-scoped). Only an
 * installation still awaiting HO review (hoReviewStatus PENDING) is actionable; anything already
 * decided (or out of scope) shows the honest "no longer awaiting HO review" state.
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, XCircle, MapPin, User, Clock, Camera, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { BeforeAfter } from '@/components/audit/before-after';
import { GeoBadge } from '@/components/audit/geo-badge';
import { ConfirmDialog } from '@/components/audit/confirm-dialog';
import { Lightbox } from '@/components/audit/media-image';
import { UpholdDialog } from '@/components/ho-review/uphold-dialog';
import {
  approveHoInstallation,
  fetchHoInstallation,
  rejectHoInstallation,
  type HoQueueItem,
} from '@/lib/ho-review/api';
import { reasonLabel, formatLatLng } from '@/lib/audit/api';
import { formatDateTime } from '@/lib/utils';

export default function HoReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [item, setItem] = useState<HoQueueItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false); // no longer PENDING HO review

  const [confirmApprove, setConfirmApprove] = useState(false);
  const [upholdOpen, setUpholdOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [lightbox, setLightbox] = useState<{ src: string; alt: string; markup?: unknown } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setGone(false);
    fetchHoInstallation(id).then((res) => {
      if (cancelled) return;
      if (res.success) {
        if (res.data.hoReviewStatus === 'PENDING') setItem(res.data);
        else setGone(true);
      } else if (res.status === 404) {
        setGone(true);
      } else {
        setError(res.error || 'Could not load this installation.');
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const siteLabel = item ? `${item.site.name} (${item.site.code})` : 'this installation';

  const doApprove = async () => {
    setSubmitting(true);
    const res = await approveHoInstallation(id);
    setSubmitting(false);
    if (res.success) {
      setConfirmApprove(false);
      toast.success('Approved — audit rejection overridden');
      router.push('/admin/ho-review');
    } else {
      toast.error(res.error || 'Could not approve. Please try again.');
      if (res.status === 409) { setConfirmApprove(false); setGone(true); }
    }
  };

  const doUphold = async (note: string | undefined) => {
    setSubmitting(true);
    const res = await rejectHoInstallation(id, { reason: note });
    setSubmitting(false);
    if (res.success) {
      setUpholdOpen(false);
      toast.success('Rejection upheld');
      router.push('/admin/ho-review');
    } else {
      toast.error(res.error || 'Could not submit. Please try again.');
      if (res.status === 409) { setUpholdOpen(false); setGone(true); }
    }
  };

  return (
    <div className="fade-in pb-24">
      <Link
        href="/admin/ho-review"
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to HO review
      </Link>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
          <Link href="/admin/ho-review" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all">
            Back to HO review
          </Link>
        </div>
      ) : gone || !item ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No longer awaiting HO review</p>
          <p className="text-xs text-gray-500 mt-1">This installation has already been decided or is outside your scope.</p>
          <Link href="/admin/ho-review" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all">
            Back to HO review
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
              <Meta icon={User} label="Rejected by (auditor)" value={item.auditedBy?.name ?? 'Unknown'} />
              <Meta icon={Camera} label="Elements" value={String(item.compare.length)} />
              <Meta icon={Clock} label="Rejected" value={item.auditedAt ? formatDateTime(item.auditedAt) : '—'} />
            </div>

            {formatLatLng(item.site.lat, item.site.lng) && (
              <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-gray-500 font-mono">
                <MapPin className="h-3.5 w-3.5 text-gray-400" />
                Outlet: {formatLatLng(item.site.lat, item.site.lng)}
              </p>
            )}
          </div>

          {/* Why it escalated — the auditor's rejection reason */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              Auditor rejection
            </p>
            <p className="mt-1 text-sm font-semibold text-amber-900">
              {item.auditRejection.reasonCode ? reasonLabel(item.auditRejection.reasonCode) : 'No reason code'}
            </p>
            {item.auditRejection.reason && (
              <p className="mt-0.5 text-sm text-amber-800">{item.auditRejection.reason}</p>
            )}
            <p className="mt-2 text-[11px] text-amber-700">
              Approve to OVERRIDE this rejection (the installation is accepted), or uphold it to close as rejected.
            </p>
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
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-end gap-3">
              <button
                onClick={() => setUpholdOpen(true)}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-[var(--brand-primary)] text-[var(--brand-primary)] hover:bg-[var(--brand-primary-light)] font-bold px-5 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                <XCircle className="h-4 w-4" />
                Uphold rejection
              </button>
              <button
                onClick={() => setConfirmApprove(true)}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-confirm)] hover:brightness-95 text-white font-bold px-5 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve (override)
              </button>
            </div>
          </div>

          <ConfirmDialog
            open={confirmApprove}
            title="Override the audit rejection?"
            message={`This APPROVES ${siteLabel}, overriding the auditor's rejection. The audit record stays on file; this cannot be changed from here.`}
            confirmLabel="Approve"
            loading={submitting}
            onConfirm={doApprove}
            onCancel={() => !submitting && setConfirmApprove(false)}
          />

          <UpholdDialog
            open={upholdOpen}
            siteLabel={siteLabel}
            loading={submitting}
            onSubmit={doUphold}
            onCancel={() => !submitting && setUpholdOpen(false)}
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
