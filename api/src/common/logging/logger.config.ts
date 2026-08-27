import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Params } from 'nestjs-pino';

/**
 * nestjs-pino configuration.
 *
 * Emits structured JSON logs to stdout in production (picked up by Cloud
 * Logging) and pretty single-line logs in dev. Level severities are mapped to
 * Cloud Logging's `severity` field so log levels surface correctly in GCP.
 *
 * Every request gets a stable request id (reused from the Cloud Trace / request
 * headers when present) that is echoed back on the `x-request-id` response
 * header for client-side correlation.
 *
 * Secrets are never logged: the `redact` paths below strip auth headers,
 * cookies, API keys, and any otp/password/token/jwt fields from req/res bodies.
 */
export function buildLoggerParams(): Params {
  const isProd = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),

      // Cloud Logging expects the message under `message` and the level under
      // `severity` (upper-cased label).
      messageKey: 'message',
      formatters: {
        level: (label: string) => ({ severity: label.toUpperCase() }),
      },

      // Reuse an inbound correlation id when present so a request can be traced
      // across Cloud Run → API. Prefer the Cloud Trace context (trace id is the
      // segment before the first '/'), then x-request-id, else a fresh UUID.
      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const cloudTrace = req.headers['x-cloud-trace-context'];
        const requestId = req.headers['x-request-id'];
        const fromCloudTrace =
          typeof cloudTrace === 'string' ? cloudTrace.split('/')[0] : undefined;
        const fromRequestId =
          typeof requestId === 'string' ? requestId : undefined;
        const id = fromCloudTrace || fromRequestId || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },

      // Attach tenant/user/role to every request log line for scoped debugging.
      customProps: (req: IncomingMessage) => {
        const r = req as IncomingMessage & {
          tenantId?: string | null;
          user?: { clientId?: string | null; sub?: string | null; role?: string | null };
        };
        return {
          tenantId: r.tenantId ?? r.user?.clientId ?? null,
          userId: r.user?.sub ?? null,
          role: r.user?.role ?? null,
        };
      },

      // Custom req serializer — SECURITY-CRITICAL. pino-http's default req serializer logs
      // `req.url` (WITH the query string), `req.query` and `req.params`, any of which can
      // carry a secret. Redact paths can't scrub a token embedded inside the `url` string,
      // so we PROJECT the request to a minimal, secret-free shape instead: method + PATH
      // ONLY (query stripped) + id. Query, params, headers and body are deliberately omitted.
      serializers: {
        req: (req: IncomingMessage & { id?: unknown }) => {
          const rawUrl = typeof req.url === 'string' ? req.url : '';
          const ua = req.headers?.['user-agent'];
          return {
            id: req.id,
            method: req.method,
            url: rawUrl.split('?')[0],
            userAgent: typeof ua === 'string' ? ua : undefined,
          };
        },
      },

      // Defense-in-depth on the fields that ARE still logged (the default `res` serializer
      // logs response headers → Set-Cookie must be scrubbed).
      redact: {
        paths: [
          'res.headers["set-cookie"]',
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.authkey',
          'req.headers["x-api-key"]',
          'req.body.otp',
          'req.body.password',
          'req.body.token',
          'req.body.refreshToken',
        ],
        censor: '[REDACTED]',
      },

      // Health/readiness probes are noisy and unauthenticated — skip request logs.
      // Match on the PATH only (a probe may append a query string).
      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const path =
            typeof req.url === 'string' ? req.url.split('?')[0] : req.url;
          return path === '/health' || path === '/health/ready';
        },
      },

      // Pretty single-line logs in dev; raw JSON to stdout in prod.
      transport: isProd
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true } },
    },
  };
}
