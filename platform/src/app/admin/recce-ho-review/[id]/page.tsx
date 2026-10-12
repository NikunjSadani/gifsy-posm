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
  ShieldQuestion, AlertTriangle, ClipboardPen, Info, Link2,
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
  const [confirmAttach, setConfirmAttach] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Outlet ID — mandatory + editable for a MANUAL recce (D5). Seeded from the recce's current
  // Outlet ID (a provisional manual outlet has none yet → the HO must assign one).
  const [outletId, setOutletId] = useState('');
  // The backend's authoritative collision message (409) — names the other outlet; cleared on edit.
  const [collisionMsg, setCollisionMsg] = useState<string | null>(null);
  // When the 409 is a genuine Outlet-ID collision (not the cross-vendor guard), the existing outlet
  // we CAN attach onto — its name labels the "Attach to <name>" action and its id is sent on attach.
  // Null for a cross-vendor 409 (attach impossible there — the HO must pick another Outlet ID).
  const [attachTarget, setAttachTarget] = useState<{ id: string; name: string } | null>(null);
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
    // keep the admin on the page to EITHER change the Outlet ID OR attach onto that existing outlet.
    // A 409 on an APP approve is the already-decided race, which still resolves to "no longer
    // awaiting HO".
    if (res.status === 409) {
      setConfirmApprove(false);
      if (isManual) {
        const msg = res.error || 'That Outlet ID already belongs to another outlet. Enter a different Outlet ID.';
        surfaceManual409(msg, trimmedOutletId);
        toast.error(msg);
        return;
      }
      setGone(true);
      toast.error(res.error || 'This recce is no longer awaiting HO review.');
      return;
    }
    toast.error(res.error || 'Could not approve. Please try again.');
  };

  // Record a manual 409: a genuine collision (the message names the outlet) offers Attach; the
  // cross-vendor guard ("serviced by a different fleet") does NOT — only "change the ID".
  const surfaceManual409 = (msg: string, attemptedOutletId: string) => {
    setCollisionMsg(msg);
    const name = parseCollisionOutletName(msg);
    setAttachTarget(name ? { id: attemptedOutletId, name } : null);
  };

  // HO attach — re-send the colliding approve with `attachToExisting` so the recce is re-parented
  // onto that existing outlet (it IS an approval: same success redirect/toast as doApprove). A 409
  // here is the cross-vendor guard — surface it and drop the attach affordance (attach impossible).
  const doAttach = async () => {
    if (!attachTarget) return;
    setSubmitting(true);
    const res = await approveHoRecce(id, { outletId: attachTarget.id, attachToExisting: true });
    setSubmitting(false);
    if (res.success) {
      setConfirmAttach(false);
      toast.success('Attached — recorded against the existing outlet; installation is unlocked.');
      router.push('/admin/recce-ho-review');
      return;
    }
    if (res.status === 409) {
      // Most likely the cross-vendor guard: this outlet is a different fleet's, so attach can't
      // happen here. Show the message and remove Attach — the HO must pick another Outlet ID.
      setConfirmAttach(false);
      const msg = res.error || 'This recce can’t be attached to that outlet.';
      surfaceManual409(msg, attachTarget.id);
      toast.error(msg);
      return;
    }
    toast.error(res.error || 'Could not attach. Please try again.');
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
              {/* Enter a free Outlet ID to register a NEW outlet. If the ID already belongs to an
                  existing outlet in this fleet, the approve returns a collision and Head-Office can
                  then ATTACH this recce onto that outlet instead (see the collision prompt below). */}
              <p className="mt-1 text-xs text-gray-400">
                Enter a free Outlet ID to register this as a new outlet. If the ID already belongs to
                an existing outlet in this fleet, you can attach this recce to that outlet instead.
              </p>
              <input
                id="ho-outlet-id"
                value={outletId}
                onChange={(e) => { setOutletId(e.target.value); setCollisionMsg(null); setAttachTarget(null); }}
                placeholder="Enter the Outlet ID"
                autoComplete="off"
                data-testid="recce-ho-review-outlet-id"
                className="mt-2 w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-[var(--brand-primary)] focus:outline-none"
              />
              {/* Backend-authoritative collision (409) — names the other outlet. Wrapped in an
                  aria-live region so the async collision/advisory result is announced. */}
              <div role="status" aria-live="polite">
                {collisionMsg ? (
                  <>
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700" data-testid="recce-ho-review-outlet-id-collision">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {collisionMsg}{' '}
                        {attachTarget
                          ? 'Attach this recce to that outlet, enter a different Outlet ID, or reject this recce.'
                          : 'Enter a different Outlet ID, or reject this recce.'}
                      </span>
                    </p>
                    {attachTarget && (
                      <button
                        type="button"
                        onClick={() => setConfirmAttach(true)}
                        disabled={submitting}
                        data-testid="recce-ho-review-attach"
                        className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-[var(--brand-primary)] bg-[var(--brand-primary)]/5 px-3 py-2 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Link2 className="h-3.5 w-3.5 shrink-0" /> Attach to {attachTarget.name}
                      </button>
                    )}
                  </>
                ) : idInUseName ? (
                  /* Advisory pre-flight warning (before approve) — this id is already another outlet's. */
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Outlet ID already exists — Outlet:{' '}
                      <span className="font-semibold">{idInUseName}</span>. Approving with this ID is
                      blocked, but you can then attach this recce to that outlet (or enter a different
                      Outlet ID).
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

          <ConfirmDialog
            open={confirmAttach}
            title="Attach to this outlet?"
            message={
              attachTarget ? (
                <>
                  Attach this recce to <span className="font-semibold">{attachTarget.name}</span>{' '}
                  (Outlet ID <span className="font-semibold">{attachTarget.id}</span>)? It will be
                  recorded against that existing outlet — the walk-in details you entered won&apos;t
                  create a new outlet. This can&apos;t be undone from here.
                </>
              ) : null
            }
            confirmLabel="Attach"
            confirmVariant="primary"
            confirmTestId="recce-ho-review-attach-confirm"
            loading={submitting}
            onConfirm={() => void doAttach()}
            onCancel={() => !submitting && setConfirmAttach(false)}
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

/**
 * Pull the colliding outlet's NAME out of the backend collision 409, whose message is shaped
 * `Outlet ID "X" already belongs to another outlet: <name>.` Returns the name (trailing period
 * stripped) when the message is that collision, or null for any other 409 (notably the cross-vendor
 * guard `"<name>" is serviced by a different fleet …`, where attach is impossible). The name is
 * only used to LABEL the Attach action; the attach call itself keys off the typed Outlet ID.
 */
function parseCollisionOutletName(msg: string): string | null {
  const marker = 'already belongs to another outlet:';
  const i = msg.indexOf(marker);
  if (i < 0) return null;
  let name = msg.slice(i + marker.length).trim();
  if (name.endsWith('.')) name = name.slice(0, -1).trim();
  return name || null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}
