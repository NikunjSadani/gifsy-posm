'use client';

/**
 * HO recce-review detail — the Head-Office decision desk for one ASM-approved recce. Shows the
 * captured recce photos (reusing the ASM review console's `PhotoViewer` + integrity signals) and
 * the two decisions: Approve (recce clears HO, installation unlocks) and Reject (uphold back to
 * the field for re-capture — status returns to REJECTED).
 *
 * Data source: GET /api/recce-ho-review/recces/:id (CLIENT_ADMIN / GIFSY_ADMIN-scoped). Only a
 * recce still awaiting HO review (hoReviewStatus PENDING) is actionable; anything already decided
 * (or out of scope) shows the honest "no longer awaiting HO review" state with no dead action bar.
 */

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, CheckCircle2, XCircle, MapPin, User, Clock, ShieldCheck, ShieldAlert,
  ShieldQuestion, AlertTriangle, ClipboardPen, Info,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { PhotoViewer } from '@/components/review/photo-viewer';
import { ConfirmDialog } from '@/components/review/confirm-dialog';
import { RejectDialog } from '@/components/review/reject-dialog';
import { recceFlags, type RejectBody } from '@/lib/review/api';
import {
  approveHoRecce,
  fetchHoRecce,
  rejectHoRecce,
  type HoRecceItem,
} from '@/lib/recce-ho-review/api';
import { lookupSiteByOutletId } from '@/lib/field/sites';
import { formatDateTime } from '@/lib/utils';

export default function RecceHoReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [item, setItem] = useState<HoRecceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false); // no longer PENDING HO review

  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Outlet ID — mandatory + editable for a MANUAL recce (D5). Seeded from the recce's current
  // Outlet ID (a provisional manual outlet has none yet → the HO must assign one).
  const [outletId, setOutletId] = useState('');
  // The backend's authoritative collision message (409) — names the other outlet; cleared on edit.
  const [collisionMsg, setCollisionMsg] = useState<string | null>(null);
  // Advisory pre-flight lookup: the typed Outlet ID resolves to a DIFFERENT existing outlet.
  const [idInUseName, setIdInUseName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setGone(false);
    fetchHoRecce(id).then((res) => {
      if (cancelled) return;
      if (res.success) {
        if (res.data.hoReviewStatus === 'PENDING') {
          setItem(res.data);
          setOutletId(res.data.outletId ?? '');
        } else setGone(true);
      } else if (res.status === 404) {
        setGone(true);
      } else {
        setError(res.error || 'Could not load this recce.');
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const isManual = item?.recceMode === 'MANUAL';
  const trimmedOutletId = outletId.trim();
  // Mandatory for a manual recce that has no real Outlet ID yet (blocks Approve when empty).
  const outletIdMissing = !!isManual && trimmedOutletId === '';

  // Debounced pre-flight lookup: warn (before the 409) when the typed Outlet ID already belongs to
  // a DIFFERENT outlet than this recce's own. Only for manual recces; skipped when the id equals
  // the recce's current code (that's this outlet itself).
  const lookupSeq = useRef(0);
  useEffect(() => {
    if (!isManual || trimmedOutletId === '' || trimmedOutletId === (item?.outletId ?? '')) {
      setIdInUseName(null);
      return;
    }
    const seq = ++lookupSeq.current;
    const t = setTimeout(async () => {
      const res = await lookupSiteByOutletId(trimmedOutletId);
      if (seq !== lookupSeq.current) return;
      if (res.success && res.data.exists && res.data.site && res.data.site.id !== item?.site.id) {
        setIdInUseName(res.data.site.name);
      } else {
        setIdInUseName(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [isManual, trimmedOutletId, item?.outletId, item?.site.id]);

  const siteLabel = item ? `${item.site.name} (${item.site.code})` : 'this recce';

  const doApprove = async () => {
    if (outletIdMissing) return; // guarded by the disabled button; defensive
    setSubmitting(true);
    const res = await approveHoRecce(id, isManual ? { outletId: trimmedOutletId } : {});
    setSubmitting(false);
    if (res.success) {
      setConfirmApprove(false);
      toast.success('Approved — installation is unlocked for this site.');
      router.push('/admin/recce-ho-review');
      return;
    }
    // A 409 on a MANUAL approve is an Outlet ID collision (the message names the other outlet) —
    // keep the admin on the page to change the Outlet ID. A 409 on an APP approve is the
    // already-decided race, which still resolves to the "no longer awaiting HO" state.
    if (res.status === 409) {
      setConfirmApprove(false);
      if (isManual) {
        setCollisionMsg(res.error || 'That Outlet ID already belongs to another outlet. Enter a different Outlet ID.');
        toast.error(res.error || 'Outlet ID already in use by another outlet.');
        return;
      }
      setGone(true);
      toast.error(res.error || 'This recce is no longer awaiting HO review.');
      return;
    }
    toast.error(res.error || 'Could not approve. Please try again.');
  };

  const doReject = async (body: RejectBody) => {
    setSubmitting(true);
    const res = await rejectHoRecce(id, body);
    setSubmitting(false);
    if (res.success) {
      setRejectOpen(false);
      toast.success('Rejected — the recce is sent back for re-capture.');
      router.push('/admin/recce-ho-review');
    } else {
      toast.error(res.error || 'Could not submit. Please try again.');
      if (res.status === 409) { setRejectOpen(false); setGone(true); }
    }
  };

  const flags = item ? recceFlags(item) : [];

  return (
    <div className="fade-in pb-24" data-testid="recce-ho-review-detail">
      <Link
        href="/admin/recce-ho-review"
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4 active:scale-95 transition-transform"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to HO recce review
      </Link>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-gray-600">{error}</p>
          <Link href="/admin/recce-ho-review" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all">
            Back to HO recce review
          </Link>
        </div>
      ) : gone || !item ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 px-6" data-testid="recce-ho-review-already-reviewed">
          <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No longer awaiting HO review</p>
          <p className="text-xs text-gray-500 mt-1">This recce has already been decided or is outside your scope.</p>
          <Link href="/admin/recce-ho-review" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-all">
            Back to HO recce review
          </Link>
        </div>
      ) : (
        <>
          {/* Site header + submission context */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">{item.site.name}</h1>
                  <span className="text-sm font-medium text-gray-400">{item.site.code}</span>
                  {isManual && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-indigo-700">
                      <ClipboardPen className="h-3.5 w-3.5" />
                      Manual
                    </span>
                  )}
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
                  {item.capturedAt && (
                    <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" /> Captured {formatDateTime(item.capturedAt)}</span>
                  )}
                  {item.receivedAt && (
                    <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" /> Received {formatDateTime(item.receivedAt)}</span>
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
                  <Stat label="Distance from site" value={`${Math.round(item.integrity.distanceMeters)} m`} />
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

          {/* HO context banner */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              {isManual ? 'Manual recce · awaiting HO' : 'ASM approved · awaiting HO'}
            </p>
            <p className="mt-1 text-sm text-emerald-900">
              {isManual
                ? 'This is a field-entered manual recce (no ASM stage). Set a valid Outlet ID below, then approve to clear Head-Office review and unlock installation — or reject to send it back to the field.'
                : 'Approve to clear Head-Office review (installation unlocks for this site), or reject to send it back to the field for re-capture.'}
            </p>
          </div>

          {/* Outlet ID — MANDATORY + EDITABLE for a manual recce (D5). HO assigns/overwrites the
              real Outlet ID here; the exists-check (D6) runs server-side at approve. App recces
              keep their master Outlet ID and show no entry. */}
          {isManual && (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm mb-4">
              <label htmlFor="ho-outlet-id" className="block text-sm font-semibold text-gray-800">
                Outlet ID <span className="text-[var(--brand-primary)]">*</span>
              </label>
              <p className="mt-0.5 text-xs text-gray-500">
                Required to approve a manual recce. It must be unique — it becomes this outlet’s
                Outlet ID in the master.
              </p>
              {/* D6: HO can only assign a free Outlet ID here, not merge into an existing outlet.
                  Attach-to-existing happens at capture, so say so plainly rather than leave the
                  reviewer wondering why a colliding ID just blocks. */}
              <p className="mt-1 text-xs text-gray-400">
                To attach this recce to an existing outlet, that outlet’s exact Outlet ID must be
                entered at capture — Head-Office can’t merge outlets here.
              </p>
              <input
                id="ho-outlet-id"
                value={outletId}
                onChange={(e) => { setOutletId(e.target.value); setCollisionMsg(null); }}
                placeholder="Enter the Outlet ID"
                autoComplete="off"
                data-testid="recce-ho-review-outlet-id"
                className="mt-2 w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
              />
              {/* Backend-authoritative collision (409) — names the other outlet. Wrapped in an
                  aria-live region so the async collision/advisory result is announced. */}
              <div role="status" aria-live="polite">
                {collisionMsg ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700" data-testid="recce-ho-review-outlet-id-collision">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{collisionMsg} Enter a different Outlet ID, or reject this recce.</span>
                  </p>
                ) : idInUseName ? (
                  /* Advisory pre-flight warning (before approve) — this id is already another outlet's. */
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Outlet ID already exists — Outlet:{' '}
                      <span className="font-semibold">{idInUseName}</span>. Approving with this ID will
                      be blocked; enter a different Outlet ID.
                    </span>
                  </p>
                ) : outletIdMissing ? (
                  <p className="mt-2 text-xs text-gray-400">Enter an Outlet ID to enable Approve.</p>
                ) : null}
              </div>
            </div>
          )}

          {/* Integrity flags */}
          {flags.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-4">
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
          <div className="fixed inset-x-0 bottom-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-end gap-3">
              <button
                onClick={() => setRejectOpen(true)}
                disabled={submitting}
                data-testid="recce-ho-review-reject"
                className="flex items-center gap-1.5 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl px-4 py-2.5 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <XCircle className="h-4 w-4" /> Reject (uphold back to recce)
              </button>
              <button
                onClick={() => setConfirmApprove(true)}
                disabled={submitting || outletIdMissing}
                title={outletIdMissing ? 'Enter an Outlet ID to approve this manual recce' : undefined}
                data-testid="recce-ho-review-approve"
                className="flex items-center gap-1.5 text-sm font-semibold text-white bg-[var(--brand-confirm)] hover:brightness-95 rounded-xl px-5 py-2.5 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="h-4 w-4" /> Approve
              </button>
            </div>
          </div>

          <ConfirmDialog
            open={confirmApprove}
            title="Approve this recce?"
            message={
              <>
                Approving <span className="font-semibold">{item.site.name}</span>
                {isManual ? (
                  <> with Outlet ID <span className="font-semibold">{trimmedOutletId}</span></>
                ) : (
                  <> ({item.site.code})</>
                )}{' '}
                clears Head-Office review and unlocks installation for this site. This can&apos;t be
                undone from here.
              </>
            }
            confirmLabel="Approve"
            confirmVariant="primary"
            loading={submitting}
            onConfirm={() => void doApprove()}
            onCancel={() => !submitting && setConfirmApprove(false)}
          />

          <RejectDialog
            open={rejectOpen}
            siteLabel={siteLabel}
            loading={submitting}
            onConfirm={(body) => void doReject(body)}
            onCancel={() => !submitting && setRejectOpen(false)}
          />
        </>
      )}
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
