/**
 * gifsy-posm edge worker — OPTIONAL TEMPLATE (see docs/plans/ENVIRONMENTS.md §6).
 *
 * Host-based reverse proxy: a public hostname (posm.<DOMAIN> / uat-posm.<DOMAIN>) → the Cloud Run
 * FRONTEND service of ONE environment. One worker deployment per environment; everything
 * environment/domain-specific comes from wrangler vars (nothing is hardcoded here):
 *
 *   UPSTREAM_ORIGIN  e.g. https://posm-frontend-prod-<hash>.asia-south1.run.app   (required)
 *   ALLOWED_HOSTS    comma-separated public hostnames this worker may serve        (recommended)
 *
 * Only the frontend is fronted. The browser calls same-origin /api/*; the Next server rewrites it to
 * the API (see platform/next.config.ts), so the API needs no public hostname.
 *
 * Why it rewrites `Location`: platform/src/proxy.ts builds redirects (e.g. → /auth/login) from the
 * request URL. Cloud Run only routes on its own *.run.app Host, so the worker must fetch that host;
 * if Next ever emits an absolute redirect to the upstream host, the browser would leave the edge
 * (and the host-only session cookie would not follow). We forward X-Forwarded-Host/Proto AND rewrite
 * any upstream-pointing Location back to the public origin as a safety net. Verify on staging.
 */

export default {
  async fetch(request, env) {
    if (!env.UPSTREAM_ORIGIN) {
      return new Response('Edge misconfigured: UPSTREAM_ORIGIN is not set', { status: 502 });
    }

    const publicUrl = new URL(request.url);
    const allowed = (env.ALLOWED_HOSTS || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    // Fail closed when a host list is configured: unknown hosts (incl. *.workers.dev) get a 404.
    if (allowed.length > 0 && !allowed.includes(publicUrl.hostname.toLowerCase())) {
      return new Response('Not found', { status: 404 });
    }

    const upstream = new URL(env.UPSTREAM_ORIGIN);
    const target = new URL(publicUrl.pathname + publicUrl.search, upstream);

    // `new Request(url, request)` carries method/body/headers; headers are mutable on this copy.
    // redirect:'manual' so we can inspect/rewrite redirects instead of silently following them.
    const upstreamReq = new Request(target.toString(), request);
    upstreamReq.headers.set('x-forwarded-host', publicUrl.host);
    upstreamReq.headers.set('x-forwarded-proto', 'https');
    // Host is set by fetch() from the target URL — Cloud Run requires its own *.run.app Host.

    const upstreamRes = await fetch(upstreamReq, { redirect: 'manual' });

    // Responses from fetch() are immutable — copy to adjust headers.
    const res = new Response(upstreamRes.body, upstreamRes);
    const location = res.headers.get('location');
    if (location && location.startsWith(upstream.origin)) {
      res.headers.set('location', publicUrl.origin + location.slice(upstream.origin.length));
    }
    return res;
  },
};
