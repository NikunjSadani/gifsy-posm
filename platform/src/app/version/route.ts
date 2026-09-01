import { NextResponse } from 'next/server';

/**
 * GET /version — the build id of the CURRENTLY DEPLOYED server, read live at request time.
 *
 * UpdateNudge (online-only, no service worker) fetches this and compares it against the build id
 * baked into the running client (`NEXT_PUBLIC_BUILD_ID`). A mismatch means a newer build has been
 * deployed while an installed PWA tab stayed open → it offers a "Refresh". `force-dynamic` +
 * no-store so it is never cached and always reflects the live deploy. Public (see proxy.ts
 * PUBLIC_PATHS) — it exposes only an opaque build token, no data.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
