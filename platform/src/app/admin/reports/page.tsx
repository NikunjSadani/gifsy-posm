'use client';

/**
 * Admin — Email reports configuration.
 *
 * Admins set who receives the scheduled daily POSM digest, at what IST hour it goes
 * out, and the stale-item thresholds that flag overdue recces / installs. They can
 * preview the rendered digest (server-generated HTML, shown in a SANDBOXED iframe —
 * never injected into this page's DOM) and dispatch a real test send to the saved
 * recipients.
 *
 * The backend re-validates emails / hour / thresholds and owns the actual mail
 * delivery; in local dev its SMTP is a log-only bypass, so a successful test send only
 * means the digest was dispatched to the mailer, not that a message landed in an inbox.
 */

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Mail, Send, Save, AlertTriangle, Loader2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  fetchConfig,
  saveConfig,
  fetchPreview,
  sendTest,
  parseRecipients,
  HOUR_OPTIONS,
  type ReportConfig,
  type PreviewResult,
} from '@/lib/reports/api';

// A stale-hours field is valid when it is a positive whole number of hours.
function parsePositiveInt(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function AdminReportsPage() {
  // ─── Config load ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The last config the backend confirmed as saved (drives the send-test gate). */
  const [savedConfig, setSavedConfig] = useState<ReportConfig | null>(null);

  // ─── Editable form fields ─────────────────────────────────────────────────
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [sendHourLocal, setSendHourLocal] = useState(9);
  const [staleRecceRaw, setStaleRecceRaw] = useState('24');
  const [staleInstallRaw, setStaleInstallRaw] = useState('48');
  // ASM pending-recce reminder (threshold-triggered)
  const [asmReminderEnabled, setAsmReminderEnabled] = useState(false);
  const [asmThresholdRaw, setAsmThresholdRaw] = useState('24');
  const [asmIntervalRaw, setAsmIntervalRaw] = useState('24');
  const [saving, setSaving] = useState(false);

  // ─── Preview panel ────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ─── Send test ────────────────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const applyConfig = useCallback((c: ReportConfig) => {
    setSavedConfig(c);
    setRecipientsRaw(c.recipients.join('\n'));
    setEnabled(c.enabled);
    setSendHourLocal(c.sendHourLocal);
    setStaleRecceRaw(String(c.staleRecceHours));
    setStaleInstallRaw(String(c.staleInstallHours));
    const asm = c.asmRecceReminders ?? { enabled: false, thresholdHours: 24, reminderIntervalHours: 24 };
    setAsmReminderEnabled(asm.enabled);
    setAsmThresholdRaw(String(asm.thresholdHours));
    setAsmIntervalRaw(String(asm.reminderIntervalHours));
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await fetchConfig();
    if (res.success) {
      applyConfig(res.data);
    } else {
      setLoadError(res.error);
    }
    setLoading(false);
  }, [applyConfig]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    const res = await fetchPreview();
    if (res.success) {
      setPreview(res.data);
    } else {
      setPreview(null);
      setPreviewError(res.error);
    }
    setPreviewLoading(false);
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadPreview();
  }, [loadConfig, loadPreview]);

  // ─── Derived validation ───────────────────────────────────────────────────
  const parsed = parseRecipients(recipientsRaw);
  const staleRecce = parsePositiveInt(staleRecceRaw);
  const staleInstall = parsePositiveInt(staleInstallRaw);
  const hasInvalidRecipients = parsed.invalid.length > 0;
  const asmThreshold = parsePositiveInt(asmThresholdRaw);
  const asmInterval = parsePositiveInt(asmIntervalRaw);
  // ASM-reminder thresholds only need to be valid WHEN the reminder is enabled.
  // Mirror the backend DTO's 1–720h bound so a save can't bounce with a 400.
  const asmInRange = (n: number | null): boolean => n !== null && n >= 1 && n <= 720;
  const asmValid = !asmReminderEnabled || (asmInRange(asmThreshold) && asmInRange(asmInterval));
  const thresholdsValid = staleRecce !== null && staleInstall !== null && asmValid;
  const canSave = !saving && !hasInvalidRecipients && thresholdsValid;

  const savedRecipientCount = savedConfig?.recipients.length ?? 0;
  const canSendTest = !sending && !saving && savedRecipientCount > 0;

  const handleSave = async () => {
    if (!canSave) return;
    if (staleRecce === null || staleInstall === null) return;
    setSaving(true);
    const body: ReportConfig = {
      enabled,
      recipients: parsed.valid,
      sendHourLocal,
      staleRecceHours: staleRecce,
      staleInstallHours: staleInstall,
      asmRecceReminders: {
        enabled: asmReminderEnabled,
        // When disabled, send the last-valid (or default) values so the DTO still validates.
        thresholdHours: asmThreshold ?? 24,
        reminderIntervalHours: asmInterval ?? 24,
      },
    };
    const res = await saveConfig(body);
    setSaving(false);
    if (res.success) {
      applyConfig(res.data);
      toast.success('Report settings saved');
      // Config changes the digest content — refresh the preview so it stays truthful.
      void loadPreview();
    } else {
      toast.error(res.error || 'Could not save settings');
    }
  };

  const handleSendTest = async () => {
    setSending(true);
    const res = await sendTest();
    setSending(false);
    setConfirmOpen(false);
    if (res.success) {
      const to = res.data.recipients?.length ?? 0;
      toast.success(`Digest dispatched to ${to} recipient${to === 1 ? '' : 's'} (delivery depends on the mailer)`);
    } else {
      toast.error(res.error || 'Could not send the test digest');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Email reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Configure the scheduled daily Elements digest — recipients, send time, stale-item thresholds — and
          per-ASM reminders for recces pending approval.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 flex items-start justify-between gap-4">
          <span>Couldn&apos;t load settings: {loadError}</span>
          <button
            onClick={() => void loadConfig()}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white text-red-700 px-3 py-1.5 font-medium hover:bg-red-50 active:scale-95 transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* ─── Config form ─────────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
            <h2 className="text-base font-semibold text-gray-900">Settings</h2>

            {/* Enabled toggle */}
            <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
              <span>
                <span className="block text-sm font-medium text-gray-800">Daily digest enabled</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  When off, no scheduled digest is sent (you can still send a test).
                </span>
              </span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-5 h-5 flex-none accent-[var(--brand-primary)] cursor-pointer"
              />
            </label>

            {/* Recipients */}
            <div>
              <label htmlFor="recipients" className="block text-sm font-medium text-gray-800 mb-1.5">
                Recipients
              </label>
              <textarea
                id="recipients"
                value={recipientsRaw}
                onChange={(e) => setRecipientsRaw(e.target.value)}
                rows={4}
                placeholder="ops@kwality.co.in, manager@kwality.co.in"
                className="w-full rounded-xl border-2 border-gray-200 focus:border-[var(--brand-primary)] focus:outline-none px-3 py-2 text-sm text-gray-900 transition-colors font-mono"
              />
              <p className="text-xs text-gray-500 mt-1">
                Separate with commas or new lines.{' '}
                {parsed.valid.length > 0 && (
                  <span className="text-gray-600 font-medium">
                    {parsed.valid.length} valid recipient{parsed.valid.length === 1 ? '' : 's'}.
                  </span>
                )}
              </p>
              {hasInvalidRecipients && (
                <p className="mt-1.5 text-xs text-red-600 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Not valid email{parsed.invalid.length === 1 ? '' : 's'}:{' '}
                    <span className="font-medium break-all">{parsed.invalid.join(', ')}</span>
                  </span>
                </p>
              )}
            </div>

            {/* Send hour */}
            <div>
              <label htmlFor="sendHour" className="block text-sm font-medium text-gray-800 mb-1.5">
                Send time (IST)
              </label>
              <select
                id="sendHour"
                value={sendHourLocal}
                onChange={(e) => setSendHourLocal(Number(e.target.value))}
                className="w-full rounded-xl border-2 border-gray-200 focus:border-[var(--brand-primary)] focus:outline-none px-3 py-2.5 text-sm text-gray-900 bg-white transition-colors"
              >
                {HOUR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Stale thresholds */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="staleRecce" className="block text-sm font-medium text-gray-800 mb-1.5">
                  Stale recce (hours)
                </label>
                <input
                  id="staleRecce"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={staleRecceRaw}
                  onChange={(e) => setStaleRecceRaw(e.target.value)}
                  className={`w-full rounded-xl border-2 focus:outline-none px-3 py-2.5 text-sm text-gray-900 transition-colors ${
                    staleRecce === null ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[var(--brand-primary)]'
                  }`}
                />
              </div>
              <div>
                <label htmlFor="staleInstall" className="block text-sm font-medium text-gray-800 mb-1.5">
                  Stale install (hours)
                </label>
                <input
                  id="staleInstall"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={staleInstallRaw}
                  onChange={(e) => setStaleInstallRaw(e.target.value)}
                  className={`w-full rounded-xl border-2 focus:outline-none px-3 py-2.5 text-sm text-gray-900 transition-colors ${
                    staleInstall === null ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[var(--brand-primary)]'
                  }`}
                />
              </div>
            </div>
            {!thresholdsValid && (
              <p className="-mt-2 text-xs text-red-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Thresholds must be whole numbers of hours greater than 0.
              </p>
            )}

            {/* ─── ASM pending-recce reminder ──────────────────────────────── */}
            <div className="pt-4 mt-1 border-t border-gray-100 space-y-4">
              <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
                <span>
                  <span className="block text-sm font-medium text-gray-800">ASM pending-recce reminders</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Email each ASM about recces awaiting their approval past the threshold below — only their own
                    assigned outlets, with the days each has been pending.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={asmReminderEnabled}
                  onChange={(e) => setAsmReminderEnabled(e.target.checked)}
                  className="w-5 h-5 flex-none accent-[var(--brand-primary)] cursor-pointer"
                />
              </label>

              {asmReminderEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="asmThreshold" className="block text-sm font-medium text-gray-800 mb-1.5">
                        Remind after (hours)
                      </label>
                      <input
                        id="asmThreshold"
                        type="number"
                        min={1}
                        max={720}
                        inputMode="numeric"
                        value={asmThresholdRaw}
                        onChange={(e) => setAsmThresholdRaw(e.target.value)}
                        className={`w-full rounded-xl border-2 focus:outline-none px-3 py-2.5 text-sm text-gray-900 transition-colors ${
                          asmThreshold === null ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[var(--brand-primary)]'
                        }`}
                      />
                      <p className="text-xs text-gray-500 mt-1">How long a recce sits unapproved before the first reminder.</p>
                    </div>
                    <div>
                      <label htmlFor="asmInterval" className="block text-sm font-medium text-gray-800 mb-1.5">
                        Re-remind every (hours)
                      </label>
                      <input
                        id="asmInterval"
                        type="number"
                        min={1}
                        max={720}
                        inputMode="numeric"
                        value={asmIntervalRaw}
                        onChange={(e) => setAsmIntervalRaw(e.target.value)}
                        className={`w-full rounded-xl border-2 focus:outline-none px-3 py-2.5 text-sm text-gray-900 transition-colors ${
                          asmInterval === null ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[var(--brand-primary)]'
                        }`}
                      />
                      <p className="text-xs text-gray-500 mt-1">Minimum gap between repeat reminders for the same recce.</p>
                    </div>
                  </div>
                  {!asmValid && (
                    <p className="-mt-1 text-xs text-red-600 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Both must be whole numbers of hours between 1 and 720.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => void handleSave()}
                disabled={!canSave}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Save settings'}
              </button>

              <button
                onClick={() => setConfirmOpen(true)}
                disabled={!canSendTest}
                title={savedRecipientCount === 0 ? 'Save at least one recipient first' : undefined}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-medium px-4 py-2.5 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              >
                <Send className="h-4 w-4" /> Send test now
              </button>
            </div>
            {savedRecipientCount === 0 && (
              <p className="-mt-2 text-xs text-gray-500">
                Save at least one recipient before you can send a test.
              </p>
            )}
            <p className="text-xs text-gray-400">
              A test send goes to the saved recipients via the mailer. In local dev the mailer is a
              log-only bypass, so a success means it was dispatched — not that a message was delivered.
            </p>
          </section>

          {/* ─── Preview panel ───────────────────────────────────────────── */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-400" /> Digest preview
              </h2>
              <button
                onClick={() => void loadPreview()}
                disabled={previewLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-medium px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-50 active:scale-95 transition-all"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {previewLoading ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-16 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Rendering preview…
              </div>
            ) : previewError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Couldn&apos;t render the preview: {previewError}
              </div>
            ) : preview ? (
              <>
                {/* Server-generated HTML — rendered ONLY inside a sandboxed iframe (no scripts,
                    no same-origin, no forms) so nothing from the digest can touch this page. */}
                <iframe
                  title="Digest preview"
                  srcDoc={preview.html}
                  sandbox=""
                  className="w-full h-[420px] rounded-xl border border-gray-200 bg-white"
                />
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-600 font-medium select-none">Raw counts</summary>
                  <pre className="mt-2 rounded-lg bg-gray-50 border border-gray-100 p-3 overflow-x-auto text-gray-700">
                    {JSON.stringify(preview.counts, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <div className="text-sm text-gray-500 py-16 text-center">No preview available.</div>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !sending && setConfirmOpen(o)}
        title="Send test digest now?"
        description={`This dispatches the digest to the ${savedRecipientCount} saved recipient${
          savedRecipientCount === 1 ? '' : 's'
        } via the mailer. In local dev the mailer is a log-only bypass.`}
        confirmLabel={sending ? 'Sending…' : 'Send now'}
        destructive={false}
        loading={sending}
        onConfirm={() => void handleSendTest()}
      />
    </div>
  );
}
