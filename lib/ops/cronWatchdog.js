// lib/ops/cronWatchdog.js - is every critical cron still running? (sun-5)
//
// WHY. NFL Pick'em week 3 sat unsettled for five days. pickem-settle did not
// fire on Tuesdays then, and the stale-board alarm lived INSIDE that same
// route - so the one thing that could have noticed was the thing that was not
// running. This watchdog depends on NONE of the jobs it watches: its own
// route (app/api/cron/cron-watchdog), its own schedule, its own lock, and it
// reads only what every watched job already writes - its sync_runs rows.
//
// THE RULE, per job:
//   interval = the schedule's nominal interval (lib/ops/cronExpr.js), read
//              from the cron expression itself, never typed beside it;
//   grace    = min(interval, 24h) - see MAX_GRACE_MS;
//   due      = the latest EXPECTED fire at or before (now - grace): the most
//              recent fire that has had a full interval to produce a row;
//   overdue  = no successful row at or after `due`.
// A windowed schedule is handled by construction: pickem-settle fires hourly
// Sun-Tue, so on a Wednesday `due` is Tuesday 20:00Z and Wednesday is quiet.
//
// Plus every contest past settles_at + 48h and still unsettled, all game
// types - the stale-board alarm, moved out of the route it was guarding.
//
// ONCE PER JOB (AND PER CONTEST) PER UTC DAY, by a claim row in sync_runs:
// source 'cron-watchdog', kind 'flag', summary.key = 'job:<job>:<day>' or
// 'contest:<id>:<day>'. No new table. The claim is written BEFORE anything is
// sent - the maybeAlert law: one dropped alert is better than a retry storm.

import { parseCron, prevFire, minIntervalMs } from './cronExpr.js';

export const WATCHDOG_SOURCE = 'cron-watchdog';
export const FLAG_KIND = 'flag';
export const CONTEST_GRACE_HOURS = 48;

// THE GRACE IS CAPPED AT A DAY because the watchdog itself runs once a day.
// "Overdue by more than one interval" taken literally makes a weekly job (the
// power editions) a WEEK late before anyone hears - the exact silence this
// exists to end. Capped, a missed Tuesday publish is named on Wednesday.
export const MAX_GRACE_MS = 24 * 3_600_000;

// A row's started_at sits a few seconds AFTER the minute it was fired for, but
// a scheduler that fires a hair early must not read as a miss. One minute is
// below every watched interval (the shortest is stuck-live's five).
export const TOLERANCE_MS = 60_000;

// ROWS THAT ARE NOT A RUN. Everything else with ok = true counts, and each
// exclusion is deliberate:
//   alert           maybeAlert's rate-limit marker, written under the JOB'S
//                   OWN source with ok = true. Counting it would let a job
//                   that is failing every hour look healthy BECAUSE it is
//                   failing. This is the one that matters most.
//   skipped-locked  the cron fired but the work did not run - another run
//                   held the lock. One is noise; a lock held across a whole
//                   interval is a stuck job and should be heard about.
//   bad-league      power-edition refused its own query string: nothing ran.
//   dry             nba-schedule ?dry=1, an operator probe that writes nothing.
// COUNTED, on purpose:
//   noop / refusals the job fired and decided there was nothing to do
//                   (gridiron-odds' hourly noop sample, a settle that refused
//                   because a game is not final). Liveness is the question,
//                   and "nothing to do" is a live answer.
//   manual-*        an operator re-ran the job by hand and it succeeded - the
//                   work the cron owed is done (power-edition 29 Sep: the cron
//                   failed at 13:05Z, the 15:18Z manual run published).
export const NOT_A_RUN = Object.freeze(['alert', 'skipped-locked', 'bad-league', 'dry']);

/**
 * THE WATCHED JOBS. `schedule` is vercel.json's, verbatim, and
 * lib/pollers/cronWiring.test.mjs pins every one to the file. `watch` is set
 * only where the job writes a row on a narrower rhythm than it is invoked on,
 * and each one says why. `source` is the sync_runs source the route records
 * under (its SOURCE / recordRun call), which is not always the path.
 */
export const WATCHED_JOBS = Object.freeze([
  { job: 'pickem-settle', path: '/api/cron/pickem-settle', source: 'pickem-settle', schedule: '0 6-20 * * 0,1,2' },
  { job: 'weekly-settle', path: '/api/cron/weekly-settle', source: 'weekly-settle', schedule: '0 9-20 * * 2' },
  { job: 'draft-settle', path: '/api/cron/draft-settle', source: 'draft-settle', schedule: '0 10-21 * * 2' },
  { job: 'run-settle', path: '/api/cron/run-settle', source: 'run-settle', schedule: '0 6-20 * * *' },
  { job: 'october-settle', path: '/api/cron/october-settle', source: 'october-settle', schedule: '30 6-20 * * *' },
  { job: 'epl-weekly-5', path: '/api/cron/epl-weekly-5', source: 'epl-weekly-5', schedule: '40 */3 * * *' },
  // The route also records nba-pickem and nba-six, but only AFTER this one
  // succeeds; the resync row is the route's heartbeat.
  { job: 'nba-schedule', path: '/api/cron/nba-schedule', source: 'nba-schedule', schedule: '52 * * * *' },
  // ODDS LEGS. Invoked every 15 minutes, but the :00 tick ALWAYS writes a row
  // for every unfixed leg ('tight' inside a kickoff window, else 'baseline');
  // the other ticks write only when tight, or one noop sample. Hourly is the
  // rhythm a healthy leg is guaranteed to keep.
  { job: 'nfl-odds', path: '/api/cron/gridiron-odds', source: 'nfl-odds', schedule: '*/15 * * * *', watch: '0 * * * *' },
  { job: 'cfb-odds', path: '/api/cron/gridiron-odds', source: 'cfb-odds', schedule: '*/15 * * * *', watch: '0 * * * *' },
  { job: 'epl-odds', path: '/api/cron/gridiron-odds', source: 'epl-odds', schedule: '*/15 * * * *', watch: '0 * * * *' },
  // A FIXED-CLOCK leg (lib/gridiron/oddsLegs.js legDue): 13:00Z and 21:00Z only.
  { job: 'mlb-odds', path: '/api/cron/gridiron-odds', source: 'mlb-odds', schedule: '*/15 * * * *', watch: '0 13,21 * * *' },
  // RUNS WHEN DUE (lib/mlb/resync.js resyncDue): a not-due tick writes no row
  // at all. The one fire it owes EVERY day is 10:50Z ('daily'); the postseason
  // two-hourly and pre-first-pitch runs are extra and cannot be read off a
  // schedule, so the watch is the floor it always keeps.
  { job: 'mlb-schedule', path: '/api/cron/mlb-schedule', source: 'mlb-schedule', schedule: '50 * * * *', watch: '50 10 * * *' },
  { job: 'stuck-live', path: '/api/cron/stuck-live', source: 'stuck-live', schedule: '*/5 * * * *' },
  { job: 'leagues-tick', path: '/api/cron/leagues-tick', source: 'leagues-tick', schedule: '25 * * * *' },
  // ONE SOURCE, TWO JOBS: both leagues record under 'power-edition'. A
  // successful publish carries its league in summary.summary.league (a manual
  // run's summary carries it at the top level), so each is watched alone.
  { job: 'power-edition-cfb', path: '/api/cron/power-edition?league=cfb', source: 'power-edition', schedule: '0 15 * * 1', league: 'cfb' },
  { job: 'power-edition-nfl', path: '/api/cron/power-edition?league=nfl', source: 'power-edition', schedule: '5 13 * * 2', league: 'nfl' },
]);

export const dayKey = (now) => new Date(now).toISOString().slice(0, 10);
export const jobFlagKey = (job, now) => `job:${job}:${dayKey(now)}`;
export const contestFlagKey = (id, now) => `contest:${id}:${dayKey(now)}`;

/** '2026-10-03 21:25Z', or 'never'. */
export function fmtAt(t) {
  if (!t) return 'never';
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/**
 * PURE. Is a job overdue at `now`, given its last successful row?
 * @returns {{ overdue, intervalMs, graceMs, dueAt }}
 */
export function assessJob({ schedule, lastOkAt, now }) {
  const cron = parseCron(schedule);
  const intervalMs = minIntervalMs(cron);
  const graceMs = Math.min(intervalMs ?? MAX_GRACE_MS, MAX_GRACE_MS);
  const dueAt = prevFire(cron, new Date(new Date(now).getTime() - graceMs));
  if (!dueAt) return { overdue: false, intervalMs, graceMs, dueAt: null };
  const last = lastOkAt ? new Date(lastOkAt).getTime() : null;
  const overdue = last == null || last < dueAt.getTime() - TOLERANCE_MS;
  return { overdue, intervalMs, graceMs, dueAt };
}

const hours = (ms) => (ms == null ? '?' : `${+(ms / 3_600_000).toFixed(2)}h`);

/** PURE. The email for one overdue job. */
export function jobAlert(job, a, { lastOk, lastAttempt }) {
  const subject = `[watchdog] ${job.job} overdue - last ok run ${fmtAt(lastOk?.started_at)}`;
  const body = [
    `job: ${job.job}`,
    `path: ${job.path}`,
    `sync_runs source: ${job.source}${job.league ? ` (league ${job.league})` : ''}`,
    `schedule: ${job.schedule}${job.watch ? ` (watched as ${job.watch})` : ''}`,
    `interval: ${hours(a.intervalMs)}, grace ${hours(a.graceMs)}`,
    `expected a successful run at or after: ${fmtAt(a.dueAt)}`,
    `last successful run: ${lastOk ? `${fmtAt(lastOk.started_at)} (kind ${lastOk.kind}, #${lastOk.id})` : 'never'}`,
    `last attempt: ${lastAttempt ? `${fmtAt(lastAttempt.started_at)} (kind ${lastAttempt.kind}, ok ${lastAttempt.ok}, #${lastAttempt.id})` : 'none'}`,
    lastAttempt?.error ? `\nlast error:\n${String(lastAttempt.error).slice(0, 800)}` : '',
    '',
    'Fire it by hand (Bearer CRON_SECRET):',
    `  curl -s -H "Authorization: Bearer $CRON_SECRET" "https://sportsvyn.com${job.path}"`,
  ].filter((l) => l !== null).join('\n');
  return { subject, body };
}

/** PURE. The one email for the contests newly flagged on this run. */
export function contestAlert(contests) {
  const subject = `[watchdog] ${contests.length} contest(s) unsettled ${CONTEST_GRACE_HOURS}h past settles_at`;
  const body = contests.map((c) =>
    `contest ${c.id} (${c.game_type} ${c.sport}${c.week != null ? ` wk${c.week}` : ''}${c.puzzle_date ? ` ${dayKey(c.puzzle_date)}` : ''}): settles_at ${fmtAt(c.settles_at)}, still unsettled`,
  ).join('\n') + '\n\nA game that never turns final (cancelled, postponed) keeps a board open forever; so does a settle cron that is not firing. Check the job above first.';
  return { subject, body };
}

/** PURE. "pickem #13, run #26" - the push's list, short enough for a lock screen. */
export function contestList(contests, max = 4) {
  const head = contests.slice(0, max).map((c) => `${c.game_type} #${c.id}`).join(', ');
  return contests.length > max ? `${head} +${contests.length - max} more` : head;
}

/**
 * Claim a flag key for today. Returns true when THIS call claimed it, false
 * when it was already claimed. Bounded to three days back - a key carries its
 * own date, so nothing older can match.
 */
export async function claimFlag(sql, key, summary = {}) {
  const r = await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    SELECT ${WATCHDOG_SOURCE}, ${FLAG_KIND}, now(), now(), true,
           ${JSON.stringify({ ...summary, key })}::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM sync_runs
        WHERE source = ${WATCHDOG_SOURCE} AND kind = ${FLAG_KIND}
          AND started_at > now() - interval '3 days'
          AND summary->>'key' = ${key})
    RETURNING id`;
  return r.length > 0;
}

/** The last successful row, and the last attempt of any outcome, for a job. */
export async function lastRuns(sql, job) {
  const league = job.league ?? null;
  const ok = await sql`
    SELECT id, kind, started_at FROM sync_runs
     WHERE source = ${job.source} AND ok = true
       AND kind <> ALL(${NOT_A_RUN})
       AND (${league}::text IS NULL
            OR COALESCE(summary->'summary'->>'league', summary->>'league') = ${league})
     ORDER BY started_at DESC LIMIT 1`;
  // A FAILED run carries no summary (recordRun writes only the error), so a
  // league job's failures cannot be told apart by league - they are shown.
  const attempt = await sql`
    SELECT id, kind, started_at, ok, left(error, 800) AS error FROM sync_runs
     WHERE source = ${job.source}
       AND kind <> ALL(${NOT_A_RUN})
       AND (${league}::text IS NULL OR ok = false
            OR COALESCE(summary->'summary'->>'league', summary->>'league') = ${league})
     ORDER BY started_at DESC LIMIT 1`;
  return { lastOk: ok[0] ?? null, lastAttempt: attempt[0] ?? null };
}

/** Contests past settles_at + grace and still unsettled, every game type. */
export async function staleContests(sql, { now = new Date(), graceHours = CONTEST_GRACE_HOURS, onlyIds = null } = {}) {
  // `settled` is NOT NULL (default false), so NOT settled is "IS NOT TRUE" -
  // and it is the form idx_contests_settle's partial predicate can use.
  return sql`
    SELECT id, game_type, sport, week, puzzle_date, settles_at FROM contests
     WHERE NOT settled
       AND settles_at IS NOT NULL
       AND settles_at + make_interval(hours => ${graceHours}) < ${new Date(now).toISOString()}::timestamptz
       AND (${onlyIds}::int[] IS NULL OR id = ANY(${onlyIds}::int[]))
     ORDER BY settles_at, id
     LIMIT 200`;
}

/**
 * One pass. `sendEmail({ source, subject, body })` and
 * `sendPush(eventId, params)` are injected - the route wires maybeAlert and
 * notifyPersonalized-to-the-admin; tests pass stubs, so no suite run can put
 * mail in an inbox (lib/pollers/alerts.js has the receipt for that).
 * Each send is caught on its own: a dead mailer never costs the push, and
 * neither costs the rest of the pass.
 */
export async function runWatchdog({
  sql, now = new Date(), jobs = WATCHED_JOBS, sendEmail, sendPush, onlyContestIds = null,
}) {
  const day = dayKey(now);
  const checked = [];
  const flagged = [];
  const errors = [];
  const safe = async (what, fn) => {
    try { return await fn(); } catch (e) { errors.push({ what, error: String(e?.message ?? e).slice(0, 200) }); return null; }
  };

  for (const job of jobs) {
    const runs = await safe(`read ${job.job}`, () => lastRuns(sql, job));
    if (!runs) continue;
    const a = assessJob({ schedule: job.watch ?? job.schedule, lastOkAt: runs.lastOk?.started_at, now });
    checked.push({ job: job.job, lastOk: fmtAt(runs.lastOk?.started_at), dueAt: fmtAt(a.dueAt), overdue: a.overdue });
    if (!a.overdue) continue;
    const claimed = await safe(`claim ${job.job}`, () => claimFlag(sql, jobFlagKey(job.job, now), { job: job.job, lastOk: runs.lastOk?.started_at ?? null, dueAt: a.dueAt }));
    if (!claimed) continue;   // already named today (or the claim failed - see errors)
    const { subject, body } = jobAlert(job, a, runs);
    const email = await safe(`email ${job.job}`, () => sendEmail({ source: `${WATCHDOG_SOURCE}:${job.job}`, subject, body }));
    const push = await safe(`push ${job.job}`, () => sendPush(`ops-cron-overdue:${job.job}:${day}`, { job: job.job, last: fmtAt(runs.lastOk?.started_at) }));
    flagged.push({ job: job.job, lastOk: fmtAt(runs.lastOk?.started_at), email, push });
  }

  const stale = (await safe('read contests', () => staleContests(sql, { now, onlyIds: onlyContestIds }))) ?? [];
  const fresh = [];
  for (const c of stale) {
    if (await safe(`claim contest ${c.id}`, () => claimFlag(sql, contestFlagKey(c.id, now), { contestId: c.id, gameType: c.game_type }))) fresh.push(c);
  }
  let contests = { stale: stale.length, flagged: [] };
  if (fresh.length) {
    const { subject, body } = contestAlert(fresh);
    const email = await safe('email contests', () => sendEmail({ source: `${WATCHDOG_SOURCE}:contests`, subject, body }));
    const push = await safe('push contests', () => sendPush(
      `ops-contest-unsettled:${day}:${fresh.map((c) => c.id).join('+')}`,
      { count: fresh.length, list: contestList(fresh) }));
    contests = { stale: stale.length, flagged: fresh.map((c) => c.id), email, push };
  }

  return { day, checked: checked.length, overdue: flagged, contests, errors, detail: checked };
}
