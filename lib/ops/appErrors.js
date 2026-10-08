// lib/ops/appErrors.js - uncaught errors from the droplet services -> app_errors.
//
// recordAppError(service, err)  never throws; one row per (service, stack_hash),
//                               a repeat is count+1, ts=now(), message refreshed.
// installAppErrorHooks(service) uncaughtException / unhandledRejection handlers
//                               that KEEP node's default semantics: print the
//                               error, exit 1 - after the write, bounded by ~2s.
//
// Registering ANY uncaughtException handler stops node exiting, so the handler
// must exit itself; unhandled rejections already crash node >= 15 (exit 1), so
// they exit 1 here too. Nothing here ever turns a crash into a survival.
import { createHash } from 'node:crypto';

export const MESSAGE_MAX = 2000;
export const EXIT_WAIT_MS = 2000;

// The same bug in a new release (~/deploy/sportsvyn/releases/<sha>/...) or a
// different checkout must hash the same: drop absolute path prefixes down to
// the repo-relative tail, and the :line:col numbers.
export function normaliseStack(stack) {
  return String(stack ?? '')
    .split('\n')
    .map((l) => l
      .replace(/file:\/\//g, '')
      .replace(/(\/[^\s():]*?)?\/(?:releases\/[^/\s]+|projects\/[^/\s]+|sv-[^/\s]+|sportsvyn)\/((?:lib|services|scripts|app|components)\/)/g, '$2')
      .replace(/\/(?:[^\s():/]+\/)*(node_modules\/)/g, '$1')
      .replace(/:\d+:\d+/g, '')
      .replace(/:\d+(?=\)|$)/g, '')
      .trimEnd())
    .join('\n');
}

export function stackHash(err) {
  const e = err instanceof Error ? err : null;
  const basis = e ? `${e.name}: ${e.message}\n${normaliseStack(e.stack?.split('\n').filter((l) => /^\s+at /.test(l)).join('\n'))}`
                  : `non-error: ${String(err)}`;
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

export async function recordAppError(service, err, { sql } = {}) {
  try {
    const db = sql ?? (await import('../db.js')).sql;
    const message = String(err instanceof Error ? err.message : err ?? '').slice(0, MESSAGE_MAX);
    await db`
      INSERT INTO app_errors (service, message, stack_hash)
      VALUES (${String(service)}, ${message}, ${stackHash(err)})
      ON CONFLICT (service, stack_hash)
      DO UPDATE SET count = app_errors.count + 1, ts = now(), message = EXCLUDED.message`;
    return true;
  } catch (e) {
    try { console.error(`[app-errors] write failed: ${String(e?.message ?? e).slice(0, 200)}`); } catch { /* nothing left to try */ }
    return false;
  }
}

// record, but never wait longer than ms for the database.
export async function recordWithin(service, err, ms = EXIT_WAIT_MS, opts) {
  let t;
  try {
    return await Promise.race([recordAppError(service, err, opts), new Promise((r) => { t = setTimeout(() => r(false), ms); })]);
  } finally { clearTimeout(t); }
}

export function installAppErrorHooks(service, { exit = (c) => process.exit(c), waitMs = EXIT_WAIT_MS, proc = process, sql } = {}) {
  let going = false;
  const crash = async (kind, err) => {
    try { console.error(`[${service}] ${kind}:`, err); } catch { /* ignore */ }
    if (going) return exit(1);
    going = true;
    await recordWithin(service, err, waitMs, { sql });
    exit(1);
  };
  proc.on('uncaughtException', (err) => crash('uncaughtException', err));
  proc.on('unhandledRejection', (reason) => crash('unhandledRejection', reason));
}
