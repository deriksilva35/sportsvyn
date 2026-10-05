// lib/ops/cfbdQuota.js - will the CFBD month last until the reset? (sun-9 e)
//
// The plan is 75,000 calls a month (Tier 3). It resets at the start of the
// month: PROD's own readings show 65,763 on 30 Sep and 74,994 on 1 Oct. On 3
// Oct it stood at 68,090 after a ~5,700-call Saturday - a pace that ends the
// month around the 16th. Nothing said so. This does.
//
// READINGS, NOT CALLS. Every ledgered CFBD run records the remaining quota in
// sync_runs.summary.budget (lib/pollers/runRecorder.js probeCfbdBudget, read
// off the response headers since sun-9). The burn is the drop across the last
// 7 DAYS of those readings, divided by the days they span - it includes every
// consumer, the droplet's poller and anything run by hand, which a count of
// our own calls never could.
//
// SEVEN DAYS, NOT 24 HOURS (sun-10, Derik). The month is spent in weekly
// shape: a CFB Saturday burns ~3,000+ and a weekday ~70. A 24 h window read
// every Sunday morning as a month running out mid-month, an alarm that cries
// weekly and is ignored by the third week. The weekly average is the pace the
// month is actually spent at, so it is the one that alerts.
//
// THE RESET STILL CUTS THE WINDOW. Readings before the monthly reset are
// dropped, so for the first day of a month there is no verdict ('unknown'),
// and for the first week the rate is over the days since the reset - which
// is why MIN_SPAN_HOURS is a full day.
//
// PURE CORE, THIN READ. projectCfbdQuota is pure (readings in, verdict out);
// checkCfbdQuota does the one read and builds the alert text. Neither sends
// anything: the caller (cron-watchdog, at merge) decides how to tell someone.

import { CFBD_BUDGET_RUNS } from '../pollers/runRecorder.js';

export const CFBD_MONTHLY_LIMIT = 75_000;
export const BURN_WINDOW_HOURS = 7 * 24;
// Less than a day between first and last reading is not a weekly rate: it is
// one day's shape, which is exactly what the 7-day window exists to avoid.
export const MIN_SPAN_HOURS = 24;
// A rise bigger than this between two readings is the monthly reset; smaller
// rises are two runs' readings arriving out of order.
export const RESET_JUMP = 1_000;
// The newest reading must be this fresh, or the projection is about a past.
// cfb-games records one at least every 30 min (baseline) all season, so half
// a day of silence means the readings stopped, not that nothing was spent.
export const STALE_HOURS = 12;

/** Reset instant: 00:00Z on the 1st of the month after `now`. */
export function nextResetAt(now = new Date()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/**
 * PURE. readings: [{ at, remaining }] in any order.
 * Returns { status: 'ok' | 'alert' | 'unknown', reason, remaining, burnPerDay,
 *   daysToReset, projectedUse, sustainablePerDay, exhaustsAt, readings, spanHours }.
 */
export function projectCfbdQuota(readings, { now = new Date(), resetAt = nextResetAt(now) } = {}) {
  const t = new Date(now).getTime();
  const lo = t - BURN_WINDOW_HOURS * 3600_000;
  let rs = (readings ?? [])
    .map((r) => ({ at: new Date(r.at).getTime(), remaining: Number(r.remaining) }))
    .filter((r) => Number.isFinite(r.at) && Number.isFinite(r.remaining) && r.at >= lo && r.at <= t)
    .sort((a, b) => a.at - b.at);
  // Only the readings after the last reset count: across a reset the drop
  // is negative and would read as a month of free calls.
  for (let i = rs.length - 1; i > 0; i--) {
    if (rs[i].remaining - rs[i - 1].remaining > RESET_JUMP) { rs = rs.slice(i); break; }
  }
  const daysToReset = Math.max(0, (new Date(resetAt).getTime() - t) / 86_400_000);
  const base = { readings: rs.length, daysToReset: round(daysToReset, 2), resetAt: new Date(resetAt).toISOString() };
  if (!rs.length) return { ...base, status: 'unknown', reason: `no CFBD quota reading in the last ${BURN_WINDOW_HOURS / 24} days` };
  const first = rs[0]; const last = rs[rs.length - 1];
  const remaining = last.remaining;
  const sustainablePerDay = daysToReset > 0 ? Math.floor(remaining / daysToReset) : remaining;
  const spanHours = (last.at - first.at) / 3600_000;
  const out = { ...base, remaining, sustainablePerDay, spanHours: round(spanHours, 1), lastReadingAt: new Date(last.at).toISOString() };
  if ((t - last.at) / 3600_000 > STALE_HOURS) {
    return { ...out, status: 'unknown', reason: `newest reading is ${round((t - last.at) / 3600_000, 1)} h old` };
  }
  if (spanHours < MIN_SPAN_HOURS) {
    return { ...out, status: 'unknown', reason: `readings span ${round(spanHours, 1)} h, need ${MIN_SPAN_HOURS}` };
  }
  const spanDays = spanHours / 24;
  const burnPerDay = Math.max(0, Math.round((first.remaining - last.remaining) / spanDays));
  const projectedUse = Math.round(burnPerDay * daysToReset);
  const exhaustsAt = burnPerDay > 0 ? new Date(last.at + (remaining / burnPerDay) * 86_400_000).toISOString() : null;
  const alert = projectedUse > remaining;
  return {
    ...out, burnPerDay, projectedUse, exhaustsAt,
    status: alert ? 'alert' : 'ok',
    reason: alert
      ? `burning ${burnPerDay}/day, ${remaining} left, ${round(daysToReset, 1)} days to reset: runs out ${exhaustsAt.slice(0, 10)}`
      : `burning ${burnPerDay}/day, ${remaining} left, sustainable ${sustainablePerDay}/day`,
  };
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * The last BURN_WINDOW_HOURS of recorded readings, ONE PER HOUR (the newest in
 * each hour). Seven days of raw rows is ~5,000 - plays-live alone writes one
 * a minute on a Saturday - and the rate needs only the ends and the reset.
 */
export async function readCfbdQuotaReadings(sql, { now = new Date() } = {}) {
  const since = new Date(new Date(now).getTime() - BURN_WINDOW_HOURS * 3600_000).toISOString();
  const rows = await sql`
    SELECT DISTINCT ON (date_trunc('hour', started_at))
           summary->'budget'->>'at' AS read_at, COALESCE(finished_at, started_at) AS run_at,
           summary->'budget'->>'cfbd_calllimit_remaining' AS remaining
      FROM sync_runs
     WHERE source = ANY(${[...CFBD_BUDGET_RUNS.sources]}) AND kind = ANY(${[...CFBD_BUDGET_RUNS.kinds]})
       AND started_at >= ${since}
       AND summary->'budget'->>'cfbd_calllimit_remaining' ~ '^[0-9]+$'
     ORDER BY date_trunc('hour', started_at), started_at DESC
     LIMIT 400`;
  // A reading's own time when it carries one (since sun-9), else its run's end.
  return rows.map((r) => ({ at: r.read_at ?? r.run_at, remaining: Number(r.remaining) }));
}

/**
 * THE CHECK cron-watchdog CALLS. Reads, projects, and returns what to say:
 *   { alert: boolean, flagKey, subject, body, projection }
 * flagKey is one per UTC day, for the watchdog's claimFlag - one email a day
 * while the pace is wrong, not one a pass. Never sends; never throws on a
 * thin ledger (status 'unknown' is not an alert).
 */
export async function checkCfbdQuota(sql, { now = new Date(), readings = null } = {}) {
  const rs = readings ?? await readCfbdQuotaReadings(sql, { now });
  const p = projectCfbdQuota(rs, { now });
  const day = new Date(now).toISOString().slice(0, 10);
  const alert = p.status === 'alert';
  return {
    alert,
    flagKey: `cfbd-quota:${day}`,
    subject: alert
      ? `[ops] CFBD quota runs out ${p.exhaustsAt.slice(0, 10)}, before the ${p.resetAt.slice(0, 10)} reset`
      : `[ops] CFBD quota ${p.status}`,
    body: [
      `CFBD remaining: ${p.remaining ?? 'n/a'} of ${CFBD_MONTHLY_LIMIT}`,
      `burn (last ${BURN_WINDOW_HOURS / 24} days of readings, averaged): ${p.burnPerDay ?? 'n/a'}/day over ${p.spanHours ?? 0} h, ${p.readings} readings`,
      `days to reset (${p.resetAt}): ${p.daysToReset}`,
      `projected use to reset: ${p.projectedUse ?? 'n/a'}; sustainable pace: ${p.sustainablePerDay ?? 'n/a'}/day`,
      `verdict: ${p.status} - ${p.reason}`,
      '',
      'Who spent it: sync_runs.summary.cfbdCalls / cfbdByEndpoint per run (sun-9).',
    ].join('\n'),
    projection: p,
  };
}
