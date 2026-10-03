#!/usr/bin/env node
/**
 * Start (or stop) the bundled local Postgres for POSM dev.
 *
 * The dev DB is a self-contained Postgres under `.localdb/` (gitignored). It does NOT auto-start
 * with the app, and it does NOT start on the port the app expects by default: the data dir's
 * postgresql.conf leaves `port` at the 5432 default, so the server must be launched with an
 * explicit `-p 5433` override (matching DATABASE_URL). A plain `pg_ctl start` comes up on 5432 and
 * every DB call then 500s with ECONNREFUSED. This script encodes that override so a reboot / stopped
 * DB can't silently break the dev servers.
 *
 * Wired as `prestart:dev` in api/package.json, so `npm run start:dev` brings the DB up first.
 * Also runnable directly:  node scripts/start-db.mjs [start|stop|status]
 *
 * Idempotent: if something is already listening on the port, `start` is a no-op. If there is no
 * bundled DB (e.g. CI, or a dev using an external DATABASE_URL), it skips quietly with exit 0 so it
 * never blocks a non-bundled environment.
 */

import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.POSM_DB_PORT || 5433);
const HOST = '127.0.0.1';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const isWin = process.platform === 'win32';
const pgCtl = join(repoRoot, '.localdb', 'pgsql', 'bin', isWin ? 'pg_ctl.exe' : 'pg_ctl');
const dataDir = join(repoRoot, '.localdb', 'data');
const logFile = join(repoRoot, '.localdb', 'logfile.txt');
const lockFile = join(repoRoot, '.localdb', 'start.lock');

/** Resolve true if a TCP connection to host:port succeeds within the timeout. */
function portOpen(port, host, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const finish = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function waitForPort(port, host, tries = 40, gapMs = 500) {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(port, host)) return true;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

const cmd = (process.argv[2] || 'start').toLowerCase();

// No bundled DB present → skip quietly (CI / external DATABASE_URL). Never block the dev command.
if (!existsSync(pgCtl)) {
  console.log(`[db] No bundled Postgres at ${pgCtl} — skipping (using an external DATABASE_URL?).`);
  process.exit(0);
}

if (cmd === 'status') {
  const up = await portOpen(PORT, HOST);
  console.log(`[db] Postgres on ${HOST}:${PORT} is ${up ? 'UP' : 'DOWN'}.`);
  process.exit(up ? 0 : 1);
}

if (cmd === 'stop') {
  const r = spawnSync(pgCtl, ['-D', dataDir, 'stop', '-m', 'fast'], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

// cmd === 'start' (default)
if (await portOpen(PORT, HOST)) {
  console.log(`[db] Postgres already listening on ${HOST}:${PORT} — ok.`);
  process.exit(0);
}

if (!existsSync(dataDir)) {
  console.error(`[db] Bundled Postgres found but data dir is missing: ${dataDir}`);
  process.exit(1);
}

// ── Serialize concurrent starts (the real cause of the crash loop) ──────────────────────────────
// Two starts racing past the port check — e.g. a manual `start-db` + the api's `prestart:dev`, or two
// dev sessions sharing this repo — would BOTH spawn a postmaster against the same data dir and corrupt
// it ("terminating any other active server processes" → not-cleanly-shut-down → recovery). An atomic
// lock file lets only one process start; the others just wait for it to come up.
let haveLock = false;
try {
  if (existsSync(lockFile) && Date.now() - statSync(lockFile).mtimeMs > 60_000) {
    try { unlinkSync(lockFile); } catch { /* stale lock from a dead start */ }
  }
  writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); // atomic create-or-fail
  haveLock = true;
} catch {
  console.log('[db] Another start is already in progress — waiting for Postgres to come up…');
  const up = await waitForPort(PORT, HOST);
  console.log(up ? `[db] Postgres ready on ${HOST}:${PORT}.` : `[db] Postgres did not come up; see ${logFile}.`);
  process.exit(up ? 0 : 1);
}

function releaseLock() {
  if (haveLock) { try { unlinkSync(lockFile); } catch { /* ignore */ } haveLock = false; }
}
process.on('exit', releaseLock);

// Authoritative recheck under the lock: is a postmaster already running for this data dir? (pg_ctl
// status reads postmaster.pid AND verifies the process — catching a server that is mid-startup, before
// its port is listening, which a bare port probe misses and would then double-start.)
const status = spawnSync(pgCtl, ['-D', dataDir, 'status'], { stdio: 'ignore' });
if (status.status === 0) {
  console.log('[db] A Postgres server is already running for this data dir — waiting for its port…');
  const up = await waitForPort(PORT, HOST);
  process.exit(up ? 0 : 1);
}

console.log(`[db] Starting bundled Postgres on port ${PORT}…`);
// Detached + stdio ignored so pg_ctl can't hold this process open (on Windows it otherwise stays
// attached to the server's output pipe and never returns). We confirm readiness by polling the port.
const child = spawn(pgCtl, ['-D', dataDir, '-o', `-p ${PORT}`, '-l', logFile, 'start'], {
  detached: true,
  stdio: 'ignore',
});
child.on('error', (e) => {
  console.error(`[db] Failed to launch pg_ctl: ${e.message}`);
  process.exit(1);
});
child.unref();

if (await waitForPort(PORT, HOST)) {
  console.log(`[db] Postgres ready on ${HOST}:${PORT}.`);
  process.exit(0);
}
console.error(`[db] Postgres did not become ready on ${HOST}:${PORT} within ~20s. See ${logFile}.`);
process.exit(1);
