import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Shared MSG91 provider (chassis transport). Sends OTPs via the MSG91 v5 OTP API,
 * transactional email via the MSG91 SMTP relay, and (optional, DLT-gated at deploy
 * time) SMS/WhatsApp templates. Same dev bypasses as the loyalty original: FIXED_OTP
 * and missing-authKey short-circuit, and the "HTTP 200 + {type:'error'}" failure check.
 */
@Injectable()
export class Msg91Service {
  private readonly logger = new Logger(Msg91Service.name);

  constructor(private readonly config: ConfigService) {}


  /**
   * Send a WhatsApp TEMPLATE message via the MSG91 v5 bulk WhatsApp API. Optional in the
   * chassis (kept as transport). DEV bypass when no authKey. ⚠️ Register the template +
   * WhatsApp number in MSG91 before relying on this.
   */
  async sendWhatsappTemplate(
    phone: string,
    templateName: string,
    bodyValues: string[],
    opts?: { crqid?: string; languageCode?: string },
  ): Promise<{ requestId: string | null }> {
    const authKey = this.config.get<string>('MSG91_AUTH_KEY')?.trim();
    const integratedNumber = this.config.get<string>('MSG91_WHATSAPP_NUMBER')?.trim();
    const languageCode = opts?.languageCode?.trim() || 'en';

    if (!authKey) {
      this.logger.warn(
        `[DEV] MSG91 not configured — WhatsApp template "${templateName}" for ${phone} not sent (values: ${JSON.stringify(bodyValues)})`,
      );
      return { requestId: null };
    }
    if (!integratedNumber) {
      this.logger.warn(
        `MSG91_WHATSAPP_NUMBER not configured — WhatsApp template "${templateName}" for ${phone} not sent.`,
      );
      return { requestId: null };
    }

    // Recipient sanity guard: the body prepends `91`, so the caller must pass a bare 10-digit
    // mobile. A malformed value would double-prefix into an invalid number — drop it with a log.
    if (!/^\d{10}$/.test(phone)) {
      this.logger.warn(
        `WhatsApp template "${templateName}" skipped — recipient is not a bare 10-digit mobile.`,
      );
      return { requestId: null };
    }

    const to_and_component: Record<string, unknown> = {
      to: [`91${phone}`],
      components: Object.fromEntries(
        bodyValues.map((value, i) => [`body_${i + 1}`, { type: 'text', value }]),
      ),
    };
    if (opts?.crqid) to_and_component.crqid = opts.crqid;

    const url =
      'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';
    const body = {
      integrated_number: integratedNumber,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode, policy: 'deterministic' },
          to_and_components: [to_and_component],
        },
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { authkey: authKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      const reason =
        (e as Error)?.name === 'TimeoutError'
          ? 'MSG91 did not respond within 10s (timeout — check MSG91 IP whitelisting / egress)'
          : String(e);
      this.logger.error(
        `MSG91 WhatsApp template "${templateName}" request failed for ${phone}: ${reason}`,
      );
      throw new Error(`Failed to send WhatsApp template ${templateName}: ${reason}`);
    }

    const json = (await res.json()) as {
      type?: string;
      message?: string;
      request_id?: string;
      requestId?: string;
      data?: { request_id?: string; requestId?: string };
    };
    if (!res.ok || json?.type === 'error') {
      const reason = json?.message ?? `HTTP ${res.status}`;
      this.logger.error(
        `MSG91 WhatsApp template "${templateName}" failed for ${phone}: ${reason}`,
      );
      throw new Error(`Failed to send WhatsApp template ${templateName}: ${reason}`);
    }

    const requestId =
      json.request_id ??
      json.requestId ??
      json.data?.request_id ??
      json.data?.requestId ??
      null;
    return { requestId };
  }

  /**
   * Send a transactional SMS via the MSG91 v5 FLOW API (DLT-registered template). Optional
   * in the chassis (kept as transport). DEV bypass when no authKey. ⚠️ Register the DLT
   * template + confirm the variable KEY NAMES in MSG91 before relying on this.
   */
  async sendSms(
    phone: string,
    templateId: string,
    variables: Record<string, string> = {},
    opts?: { crqid?: string },
  ): Promise<{ requestId: string | null }> {
    const authKey = this.config.get<string>('MSG91_AUTH_KEY')?.trim();

    if (!authKey) {
      this.logger.warn(
        `[DEV] MSG91 not configured — SMS template "${templateId}" for ${phone} not sent (vars: ${JSON.stringify(variables)})`,
      );
      return { requestId: null };
    }

    if (!/^\d{10}$/.test(phone)) {
      this.logger.warn(
        `SMS template "${templateId}" skipped — recipient is not a bare 10-digit mobile.`,
      );
      return { requestId: null };
    }

    const recipient: Record<string, string> = { mobiles: `91${phone}`, ...variables };
    if (opts?.crqid) recipient.crqid = opts.crqid;

    const url = 'https://control.msg91.com/api/v5/flow/';
    const body = {
      template_id: templateId,
      recipients: [recipient],
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { authkey: authKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      const reason =
        (e as Error)?.name === 'TimeoutError'
          ? 'MSG91 did not respond within 10s (timeout — check MSG91 IP whitelisting / egress)'
          : String(e);
      this.logger.error(`MSG91 SMS template "${templateId}" request failed for ${phone}: ${reason}`);
      throw new Error(`Failed to send SMS template ${templateId}: ${reason}`);
    }

    const json = (await res.json()) as {
      type?: string;
      message?: string;
      request_id?: string;
      requestId?: string;
      data?: { request_id?: string; requestId?: string };
    };
    if (!res.ok || json?.type === 'error') {
      const reason = json?.message ?? `HTTP ${res.status}`;
      this.logger.error(`MSG91 SMS template "${templateId}" failed for ${phone}: ${reason}`);
      throw new Error(`Failed to send SMS template ${templateId}: ${reason}`);
    }

    const requestId =
      json.request_id ??
      json.requestId ??
      json.data?.request_id ??
      json.data?.requestId ??
      null;
    return { requestId };
  }

  /**
   * Send a transactional EMAIL via the MSG91 SMTP RELAY (Domain Settings → SMTP
   * Integration), using nodemailer. Used by the report runner to deliver generated
   * report HTML. SMTP accepts the full rendered HTML unchanged (the v5 email HTTP API is
   * template-only).
   *
   * Conventions: STARTTLS on 587 (require it), DEV bypass when MSG91_SMTP_PASS is unset,
   * bounded timeouts. Throws on failure (the caller catches so one report can't block others).
   */
  async sendEmail(params: { to: string[]; subject: string; html: string }): Promise<void> {
    const { to, subject, html } = params;

    if (to.length === 0) {
      return;
    }

    const pass = this.config.get<string>('MSG91_SMTP_PASS')?.trim();

    // DEV bypass — a non-prod env without SMTP configured logs and returns instead of throwing.
    if (!pass) {
      this.logger.warn(
        `[DEV] MSG91 SMTP not configured — email "${subject}" to ${to.join(', ')} skipped`,
      );
      return;
    }

    const host = this.config.get<string>('MSG91_SMTP_HOST')?.trim() || 'smtp.mailer91.com';
    const port = Number(this.config.get<string>('MSG91_SMTP_PORT')?.trim() || '587');
    const user = this.config.get<string>('MSG91_SMTP_USER')?.trim() || 'emailer@notify.gifsy.in';
    const from =
      this.config.get<string>('REPORTS_FROM_EMAIL')?.trim() || 'reports@notify.gifsy.in';

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = implicit TLS
      // 587 = STARTTLS: require it (not opportunistic) so the SMTP password can NEVER be sent
      // in cleartext if the relay/path fails to advertise STARTTLS — fail the send instead.
      requireTLS: port !== 465,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    try {
      const info = await transporter.sendMail({ from, to, subject, html });
      this.logger.log(
        `Email "${subject}" sent to ${to.length} recipient(s) via SMTP (id ${info.messageId})`,
      );
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      this.logger.error(`MSG91 SMTP email "${subject}" failed: ${reason}`);
      throw new Error(`Failed to send email "${subject}": ${reason}`);
    } finally {
      transporter.close();
    }
  }
}
