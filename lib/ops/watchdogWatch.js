// lib/ops/watchdogWatch.js - who watches the watchdog? The live poller. (sun-8)
//
// The cron watchdog (lib/ops/cronWatchdog.js) cannot report its own silence:
// if its Vercel cron stops, nothing it owns runs. The live poller is the one
// process that is ALWAYS up and lives on another host (the droplet, systemd),
// so it reads the watchdog's ledger about once an hour and emails when the
// last successful pass is older than 26 hours (a daily cron plus two hours of
// slack for a late fire or a slow run).
//
// CONTAINED. checkWatchdogAlive never throws: a failed read or a failed send
// is returned as { error }, and the poller logs it and carries on. A check
// must never cost the poller a poll.
//
// ONCE PER UTC DAY, by a claim row under ITS OWN source ('cron-watchdog-watch',
// kind 'flag') - nothing written under 'cron-watchdog' itself, so this can
// never make the watchdog look alive.

import { WATCHDOG_SOURCE, dayKey, fmtAt } from './cronWatchdog.js';

export const WATCH_SOURCE = 'cron-watchdog-watch';
export const STALE_HOURS = 26;
export const CHECK_EVERY_MS = 60 * 60 * 1000;

// Rows under 'cron-watchdog' that are NOT a pass: its own once-a-day claims,
// maybeAlert markers, and a fire that found the lock held.
export const NOT_A_PASS = Object.freeze(['flag', 'alert', 'skipped-locked']);

export async function lastWatchdogPass(sql, { source = WATCHDOG_SOURCE } = {}) {
  const r = await sql`
    SELECT id, kind, started_at FROM sync_runs
     WHERE source = ${source} AND ok = true AND kind <> ALL(${NOT_A_PASS})
     ORDER BY started_at DESC LIMIT 1`;
  return r[0] ?? null;
}

/**
 * PURE. Is the last pass older than the limit (or missing)?
 *
 * `since` is when the WATCHER started watching (the poller's start time). The
 * clock runs from the later of the two, so a poller restarted right after the
 * deploy that introduces the watchdog does not page about a pass that could
 * not have happened yet - it pages 26h later if there is still none.
 */
export function watchdogStale(lastAt, now, staleHours = STALE_HOURS, since = null) {
  const from = Math.max(lastAt ? new Date(lastAt).getTime() : -Infinity, since ? new Date(since).getTime() : -Infinity);
  if (!Number.isFinite(from)) return true;
  return new Date(now).getTime() - from > staleHours * 3_600_000;
}

/**
 * One check. `alert({ source, subject, body })` is injected (the poller passes
 * maybeAlert; tests pass a stub). `source` / `watchSource` are injectable so a
 * test can plant a sentinel ledger without touching the real one.
 * @returns {{ stale, last, sent?, skipped?, error? }}
 */
export async function checkWatchdogAlive({
  sql, alert, now = new Date(), since = null, source = WATCHDOG_SOURCE, watchSource = WATCH_SOURCE, staleHours = STALE_HOURS,
}) {
  try {
    const last = await lastWatchdogPass(sql, { source });
    const stale = watchdogStale(last?.started_at, now, staleHours, since);
    if (!stale) return { stale: false, last: fmtAt(last?.started_at) };
    const key = `watchdog-missing:${source}:${dayKey(now)}`;
    const claimed = await sql`
      INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
      SELECT ${watchSource}, 'flag', now(), now(), true, ${JSON.stringify({ key, last: last?.started_at ?? null })}::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM sync_runs
          WHERE source = ${watchSource} AND kind = 'flag'
            AND started_at > now() - interval '3 days'
            AND summary->>'key' = ${key})
      RETURNING id`;
    if (!claimed.length) return { stale: true, last: fmtAt(last?.started_at), skipped: 'already alerted today' };
    const subject = `[watchdog] the cron watchdog has not run since ${fmtAt(last?.started_at)}`;
    const body = [
      `No successful '${source}' pass in the last ${staleHours}h (last: ${last ? `${fmtAt(last.started_at)}, kind ${last.kind}, #${last.id}` : 'never'}).`,
      'Every critical cron is unwatched until it runs again.',
      'Check the Vercel cron for /api/cron/cron-watchdog (17 15 * * *), then fire it by hand:',
      '  curl -s -H "Authorization: Bearer $CRON_SECRET" "https://sportsvyn.com/api/cron/cron-watchdog"',
      '',
      'Sent by the live poller (lib/ops/watchdogWatch.js), once per UTC day.',
    ].join('\n');
    const sent = await alert({ source: watchSource, subject, body });
    return { stale: true, last: fmtAt(last?.started_at), sent };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 200) };
  }
}
