/**
 * lib/pollers/lock.js — per-source Postgres advisory lock so overlapping ticks
 * don't double-run a sync (idempotent upserts make it data-safe, but a mutex
 * avoids wasted API calls + racing summaries).
 *
 * Advisory locks are SESSION-scoped, and lib/db.js's neon HTTP driver is one-shot
 * per query (a lock taken there would release immediately). So we hold a dedicated
 * WebSocket Client open for the run's duration; the wrapped fn's own queries run
 * on separate lib/db connections, which is fine — the lock is just a gate.
 */

import * as neonmod from '@neondatabase/serverless';

const { Client, neonConfig } = neonmod;
if (!neonConfig.webSocketConstructor && typeof WebSocket !== 'undefined') {
  neonConfig.webSocketConstructor = WebSocket;
}

// Session advisory locks must NOT go through Neon's -pooler endpoint: PgBouncer
// transaction pooling reuses backends, so a second acquire can land on the same
// backend that already holds the lock and succeed re-entrantly (the mutex
// silently fails open). Use the DIRECT endpoint (drop the -pooler suffix) so each
// Client is a distinct session and advisory-lock visibility is correct.
export function directConnectionString(url) {
  return (url ?? '').replace('-pooler.', '.');
}

// Stable 32-bit signed key from a source string — fits pg_try_advisory_lock(bigint).
export function lockKey(source) {
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (Math.imul(31, h) + source.charCodeAt(i)) | 0;
  return h;
}

// Run `fn` while holding the advisory lock for `source`. If already held,
// returns { locked: true } WITHOUT running fn. Otherwise runs it and returns
// { locked: false, result }. The lock is always released (finally).
export async function withAdvisoryLock(source, fn, { connectionString = process.env.DATABASE_URL } = {}) {
  let client;
  try {
    client = new Client(directConnectionString(connectionString));
    await client.connect();
  } catch (e) {
    // Lock backend unreachable (WS issue). The wrapped work is idempotent, so
    // degrade to running unlocked rather than dropping the tick entirely.
    const result = await fn();
    return { locked: false, result, lockUnavailable: String(e?.message ?? e).slice(0, 120) };
  }
  const key = lockKey(source);
  try {
    const got = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key])).rows[0].ok;
    if (!got) return { locked: true };
    try {
      const result = await fn();
      return { locked: false, result };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    await client.end();
  }
}
