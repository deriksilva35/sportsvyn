// lib/ops/cronWatchdog.test.mjs - the cron watchdog (sun-5).
//
// Pure: the overdue rule against real schedules, the alert copy, the keys.
// DEV DB: a planted stale job and a planted overdue contest are each flagged
// EXACTLY ONCE, and a second pass the same day sends nothing. The senders are
// stubs - a suite run must never put mail in an inbox or buzz a phone
// (lib/pollers/alerts.js has the receipt for why that is written down).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WATCHED_JOBS, NOT_A_RUN, assessJob, jobAlert, contestAlert, contestList, fmtAt,
  jobFlagKey, contestFlagKey, runWatchdog, WATCHDOG_SOURCE, FLAG_KIND, MAX_GRACE_MS,
} from './cronWatchdog.js';
import { renderCopy } from '../push/copy.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = 3_600_000;

// ---------------------------------------------------------------------------
// pure
// ---------------------------------------------------------------------------

test('THE INCIDENT: pickem-settle silent from Monday night is overdue by Tuesday 15:17Z', () => {
  const schedule = '0 6-20 * * 0,1,2';
  // Last success Mon 28 Sep 20:00Z (the real PROD row); Tuesday's 06-14Z fires never came.
  const a = assessJob({ schedule, lastOkAt: '2026-09-28T20:00:35Z', now: '2026-09-29T15:17:00Z' });
  assert.equal(a.overdue, true);
  assert.equal(a.dueAt.toISOString(), '2026-09-29T14:00:00.000Z');
});

test('a windowed job is QUIET outside its window: Wednesday after a healthy Tuesday', () => {
  const schedule = '0 6-20 * * 0,1,2';
  const a = assessJob({ schedule, lastOkAt: '2026-10-06T20:00:31Z', now: '2026-10-07T15:17:00Z' });
  assert.equal(a.overdue, false);
  assert.equal(a.dueAt.toISOString(), '2026-10-06T20:00:00.000Z');
  // ...and still quiet Saturday; the Sunday window reopening is what can make it late.
  assert.equal(assessJob({ schedule, lastOkAt: '2026-10-06T20:00:31Z', now: '2026-10-10T15:17:00Z' }).overdue, false);
  assert.equal(assessJob({ schedule, lastOkAt: '2026-10-06T20:00:31Z', now: '2026-10-11T15:17:00Z' }).overdue, true);
});

test('ONE missed fire is tolerated, two are not (hourly)', () => {
  const s = '25 * * * *';
  const now = '2026-10-04T15:17:00Z';
  // 14:25 missed, 13:25 ran: the 14:25 fire has not had its full hour yet.
  assert.equal(assessJob({ schedule: s, lastOkAt: '2026-10-04T13:25:05Z', now }).overdue, false);
  assert.equal(assessJob({ schedule: s, lastOkAt: '2026-10-04T12:25:05Z', now }).overdue, true);
  assert.equal(assessJob({ schedule: s, lastOkAt: null, now }).overdue, true, 'never is overdue');
});

test('the tolerance: a row a few seconds BEFORE the fire minute still counts, a minute and more does not', () => {
  const s = '0 * * * *';
  const now = '2026-10-04T15:17:00Z'; // due = 14:00
  assert.equal(assessJob({ schedule: s, lastOkAt: '2026-10-04T13:59:30Z', now }).overdue, false);
  assert.equal(assessJob({ schedule: s, lastOkAt: '2026-10-04T13:58:30Z', now }).overdue, true);
});

test('a WEEKLY job is named the next day, not a week late (grace capped at a day)', () => {
  const s = '5 13 * * 2'; // power-edition nfl
  const last = '2026-09-29T15:18:55Z'; // the previous Tuesday's manual publish
  assert.equal(assessJob({ schedule: s, lastOkAt: last, now: '2026-10-06T15:17:00Z' }).overdue, false, 'Tuesday: not a full day yet');
  const wed = assessJob({ schedule: s, lastOkAt: last, now: '2026-10-07T15:17:00Z' });
  assert.equal(wed.overdue, true, 'Wednesday: named');
  assert.equal(wed.graceMs, MAX_GRACE_MS);
  assert.equal(wed.intervalMs, 7 * 24 * H);
});

test('mlb-schedule is watched at its daily floor; a postseason day of two-hourly rows is healthy', () => {
  const job = WATCHED_JOBS.find((j) => j.job === 'mlb-schedule');
  assert.equal(job.watch, '50 10 * * *');
  assert.equal(assessJob({ schedule: job.watch, lastOkAt: '2026-10-03T20:50:24Z', now: '2026-10-04T15:17:00Z' }).overdue, false);
  assert.equal(assessJob({ schedule: job.watch, lastOkAt: '2026-10-02T10:50:24Z', now: '2026-10-04T15:17:00Z' }).overdue, true);
});

test('THE WATCHED LIST names every job the relay asked for', () => {
  const jobs = WATCHED_JOBS.map((j) => j.job);
  for (const j of ['pickem-settle', 'weekly-settle', 'draft-settle', 'run-settle', 'october-settle', 'epl-weekly-5',
    'nba-schedule', 'nfl-odds', 'cfb-odds', 'epl-odds', 'mlb-odds', 'mlb-schedule', 'stuck-live', 'leagues-tick',
    'power-edition-cfb', 'power-edition-nfl']) {
    assert.ok(jobs.includes(j), `${j} is not watched`);
  }
  assert.equal(new Set(jobs).size, jobs.length, 'job names are unique - they key the once-a-day flag');
  for (const j of WATCHED_JOBS) assert.doesNotMatch(j.job, /:/, 'a colon would split the push event id');
});

test('THE SOURCES are the ones each route records under (read from the route, not assumed)', () => {
  // A job watched under the wrong source is a job that is overdue forever - or,
  // worse, healthy forever on some other job's rows.
  const route = (p) => readFileSync(path.join(REPO, 'app', p.split('?')[0].replace(/^\//, ''), 'route.js'), 'utf8');
  const lib = (f) => readFileSync(path.join(REPO, f), 'utf8');
  for (const j of WATCHED_JOBS) {
    const s = route(j.path);
    const named = new RegExp(`(SOURCE = |source: )'${j.source}'`).test(s)
      || new RegExp(`source: '${j.source}'`).test(s);
    const viaConst = (j.source === 'mlb-schedule' && /SOURCE = RESYNC_SOURCE/.test(s) && /RESYNC_SOURCE = 'mlb-schedule'/.test(lib('lib/mlb/resync.js')))
      || (j.source === 'nba-schedule' && /SOURCE = NBA_RESYNC_SOURCE/.test(s) && /NBA_RESYNC_SOURCE = 'nba-schedule'/.test(lib('lib/nba/schedule.js')))
      || (/-odds$/.test(j.source) && new RegExp(`source: '${j.source}'`).test(s));
    assert.ok(named || viaConst, `${j.job}: route does not record source '${j.source}'`);
  }
});

test('NOT_A_RUN keeps the alert marker out - a failing job must not look healthy because it is failing', () => {
  assert.ok(NOT_A_RUN.includes('alert'));
  assert.ok(NOT_A_RUN.includes('skipped-locked'));
  assert.ok(!NOT_A_RUN.includes('noop'), 'a noop is the job firing and finding nothing to do: alive');
});

test('the email names the job, its last run, and how to fire it', () => {
  const job = WATCHED_JOBS.find((j) => j.job === 'pickem-settle');
  const a = assessJob({ schedule: job.schedule, lastOkAt: '2026-09-28T20:00:35Z', now: '2026-09-29T15:17:00Z' });
  const { subject, body } = jobAlert(job, a, {
    lastOk: { id: 1, kind: 'settle', started_at: '2026-09-28T20:00:35Z' },
    lastAttempt: { id: 2, kind: 'settle', ok: false, started_at: '2026-09-29T06:00:01Z', error: 'Error: boom' },
  });
  assert.equal(subject, '[watchdog] pickem-settle overdue - last ok run 2026-09-28 20:00Z');
  assert.match(body, /schedule: 0 6-20 \* \* 0,1,2/);
  assert.match(body, /expected a successful run at or after: 2026-09-29 14:00Z/);
  assert.match(body, /last attempt: 2026-09-29 06:00Z \(kind settle, ok false, #2\)/);
  assert.match(body, /Error: boom/);
  assert.match(body, /\/api\/cron\/pickem-settle/);
  assert.doesNotMatch(subject + body, /[‐-―−]/, 'hyphens only');
  assert.equal(fmtAt(null), 'never');
});

test('contest copy and the lock-screen list', () => {
  const cs = [
    { id: 13, game_type: 'pickem', sport: 'nfl', week: 3, settles_at: '2026-09-29T12:15:00Z' },
    { id: 26, game_type: 'run', sport: 'mlb', puzzle_date: '2026-09-27T00:00:00Z', settles_at: '2026-09-28T13:05:00Z' },
  ];
  const { subject, body } = contestAlert(cs);
  assert.match(subject, /2 contest\(s\) unsettled 48h past settles_at/);
  assert.match(body, /contest 13 \(pickem nfl wk3\): settles_at 2026-09-29 12:15Z/);
  assert.match(body, /contest 26 \(run mlb 2026-09-27\)/);
  assert.equal(contestList(cs), 'pickem #13, run #26');
  assert.equal(contestList([...cs, ...cs, ...cs], 4), 'pickem #13, run #26, pickem #13, run #26 +2 more');
});

test('the push copy exists for both events and renders with the params the watchdog sends', () => {
  const j = renderCopy('ops-cron-overdue:pickem-settle:2026-09-29', { job: 'pickem-settle', last: '2026-09-28 20:00Z' });
  assert.equal(j.body, 'pickem-settle is overdue. Last successful run 2026-09-28 20:00Z. The email has the detail.');
  const c = renderCopy('ops-contest-unsettled:2026-10-04:13+26', { count: 2, list: 'pickem #13, run #26' });
  assert.match(c.body, /^2 contest\(s\) unsettled 48h past settles_at: pickem #13, run #26\.$/);
  assert.ok(j.url.startsWith('/admin') && c.url.startsWith('/admin'));
});

test('flag keys are per job / per contest, per UTC day', () => {
  assert.equal(jobFlagKey('stuck-live', '2026-10-04T23:59:59Z'), 'job:stuck-live:2026-10-04');
  assert.equal(jobFlagKey('stuck-live', '2026-10-05T00:00:00Z'), 'job:stuck-live:2026-10-05');
  assert.equal(contestFlagKey(13, '2026-10-04T15:17:00Z'), 'contest:13:2026-10-04');
});

// ---------------------------------------------------------------------------
// DEV DB: a planted stale job and a planted overdue contest
// ---------------------------------------------------------------------------

const HAS_DB = Boolean(process.env.DATABASE_URL);
const REFUSE = HAS_DB && process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL;
const TAG = `sentinel-watchdog-${process.pid}`;
const STALE = { job: `${TAG}-stale`, path: '/api/cron/sentinel', source: `${TAG}-stale`, schedule: '0 * * * *' };
const HEALTHY = { job: `${TAG}-ok`, path: '/api/cron/sentinel', source: `${TAG}-ok`, schedule: '0 * * * *' };
let sql;
let contestId;

before(async () => {
  if (!HAS_DB || REFUSE) return;
  ({ sql } = await import('../db.js'));
  // STALE: last success five hours ago - and a FRESH alert row and a FRESH
  // skipped-locked row on the same source, neither of which is a run.
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary) VALUES
      (${STALE.source}, 'settle', now() - interval '5 hours', now() - interval '5 hours', true, '{}'::jsonb),
      (${STALE.source}, 'alert', now(), now(), true, '{"subject":"s"}'::jsonb),
      (${STALE.source}, 'skipped-locked', now(), now(), true, '{}'::jsonb),
      (${HEALTHY.source}, 'noop', now() - interval '10 minutes', now() - interval '10 minutes', true, '{}'::jsonb)`;
  // A game_type no settle job selects, so a parallel settle test can never
  // pick this board up; a sport no real league has, so dev-orphan-sweep sees
  // it if a killed run strands it.
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, settled)
    VALUES ('sentinel-watchdog', ${TAG}, 2026, 99, '[]'::jsonb,
            now() - interval '6 days', now() - interval '5 days', now() - interval '3 days', false)
    RETURNING id`;
  contestId = c.id;
});

after(async () => {
  if (!sql) return;
  const keys = [jobFlagKey(STALE.job, new Date()), jobFlagKey(HEALTHY.job, new Date()), contestFlagKey(contestId, new Date())];
  await sql`DELETE FROM sync_runs WHERE source = ANY(${[STALE.source, HEALTHY.source]})`;
  await sql`DELETE FROM sync_runs WHERE source = ${WATCHDOG_SOURCE} AND kind = ${FLAG_KIND} AND summary->>'key' = ANY(${keys})`;
  if (contestId) await sql`DELETE FROM contests WHERE id = ${contestId}`;
  // THE TEARDOWN ASSERTS ITSELF.
  const [{ n }] = await sql`
    SELECT ((SELECT count(*) FROM sync_runs WHERE source = ANY(${[STALE.source, HEALTHY.source]}))
          + (SELECT count(*) FROM sync_runs WHERE source = ${WATCHDOG_SOURCE} AND summary->>'key' = ANY(${keys}))
          + (SELECT count(*) FROM contests WHERE id = ${contestId ?? -1} OR sport = ${TAG}))::int AS n`;
  assert.equal(n, 0, 'cron-watchdog test left rows behind on DEV');
});

test('DEV: the planted stale job and overdue contest are flagged EXACTLY ONCE; a second pass sends nothing', { skip: !HAS_DB || REFUSE ? 'no DEV database' : false }, async () => {
  const emails = [];
  const pushes = [];
  const sendEmail = async (a) => { emails.push(a); return { sent: true }; };
  const sendPush = async (id, params) => { pushes.push({ id, params }); return { sent: 1 }; };
  const run = () => runWatchdog({ sql, jobs: [STALE, HEALTHY], sendEmail, sendPush, onlyContestIds: [contestId] });

  const first = await run();
  assert.deepEqual(first.errors, []);
  assert.equal(first.checked, 2);
  assert.deepEqual(first.overdue.map((o) => o.job), [STALE.job], 'the stale job, and only it');
  assert.deepEqual(first.contests.flagged, [contestId]);

  assert.equal(emails.length, 2, 'one email for the job, one for the contest');
  assert.equal(emails[0].source, `cron-watchdog:${STALE.job}`);
  assert.match(emails[0].subject, new RegExp(`${STALE.job} overdue - last ok run \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\dZ`),
    'it names the 5-hour-old run - the fresh alert and skipped-locked rows are not runs');
  assert.equal(emails[1].source, 'cron-watchdog:contests');
  assert.match(emails[1].body, new RegExp(`contest ${contestId} \\(sentinel-watchdog ${TAG} wk99\\)`));

  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(pushes.map((p) => p.id), [`ops-cron-overdue:${STALE.job}:${day}`, `ops-contest-unsettled:${day}:${contestId}`]);
  assert.equal(pushes[0].params.job, STALE.job);
  assert.equal(pushes[1].params.list, `sentinel-watchdog #${contestId}`);

  // THE SAME DAY AGAIN: still stale, still unsettled, and silent.
  const second = await run();
  assert.deepEqual(second.errors, []);
  assert.deepEqual(second.overdue, [], 'no job is named twice in a day');
  assert.deepEqual(second.contests.flagged, [], 'no contest is named twice in a day');
  assert.equal(second.contests.stale, 1, 'it still SEES the contest - it just does not repeat itself');
  assert.equal(emails.length, 2);
  assert.equal(pushes.length, 2);

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM sync_runs
     WHERE source = ${WATCHDOG_SOURCE} AND kind = ${FLAG_KIND}
       AND summary->>'key' = ANY(${[jobFlagKey(STALE.job, new Date()), contestFlagKey(contestId, new Date())]})`;
  assert.equal(n, 2, 'one claim row per flagged thing');
});
