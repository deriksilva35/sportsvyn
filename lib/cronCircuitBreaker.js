// lib/cronCircuitBreaker.js — daily-cap circuit breaker for poll-live.
//
// When API-Sports's daily request cap is exhausted, the cron has no point
// continuing to call the API (every call returns the daily-cap error body,
// burning latency and stay-alive cycles for no signal). The breaker sets
// a sentinel on first detection; subsequent poll-live ticks read the
// sentinel and skip the main poll loop entirely.
//
// Auto-clear: the sentinel stores the UTC date it was tripped. isDailyCapTripped()
// returns true ONLY when the stored trippedFor matches today's UTC date.
// At UTC midnight, the date comparison fails → breaker considered clear.
// No TTL job needed, no manual reset.
//
// THE BREAKER PAUSES NEW POLLING. It does NOT stop the stuck-live sweep
// (see lib/stuckLiveSweep.js) — the sweep continues to run, but when the
// breaker is tripped it operates in fallback mode (resolves stuck matches
// to final from last-known DB score without calling the API).

import { sql } from './db.js';

const SENTINEL_KEY = 'poll_live_daily_cap_tripped';

function todayUtcIso() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Pure helper exported for testing. Given a stored sentinel value (or null
// for "no row") and a "today" date string, decides whether the breaker is
// engaged. Engaged means: a sentinel exists AND its trippedFor matches today.
// A trippedFor of yesterday (or earlier) means the cap reset at midnight and
// the breaker should auto-clear.
export function isBreakerEngagedFor(sentinelValue, todayIso = todayUtcIso()) {
  if (!sentinelValue || typeof sentinelValue !== 'object') return false;
  return sentinelValue.trippedFor === todayIso;
}

// READ: is the breaker engaged right now?
export async function isDailyCapTripped() {
  const rows = await sql`SELECT value FROM cron_state WHERE key = ${SENTINEL_KEY} LIMIT 1`;
  if (rows.length === 0) return false;
  return isBreakerEngagedFor(rows[0].value);
}

// WRITE: trip the breaker. Idempotent — calling it multiple times the same
// UTC day is a no-op (just refreshes updated_at). UPSERT on the key.
export async function tripDailyCap({ reason = 'daily_cap_reached' } = {}) {
  const today = todayUtcIso();
  const value = JSON.stringify({
    trippedFor: today,
    trippedAt: new Date().toISOString(),
    reason,
  });
  await sql`
    INSERT INTO cron_state (key, value, updated_at)
    VALUES (${SENTINEL_KEY}, ${value}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = now()
  `;
}

// Manual clear (for tests + admin/dev use). Production callers should rely
// on the date-comparison auto-clear at UTC midnight.
export async function clearDailyCap() {
  await sql`DELETE FROM cron_state WHERE key = ${SENTINEL_KEY}`;
}

// Diagnostic read: return the raw sentinel value (or null) for logging.
export async function readBreakerSentinel() {
  const rows = await sql`SELECT value, updated_at FROM cron_state WHERE key = ${SENTINEL_KEY} LIMIT 1`;
  return rows[0] ?? null;
}
