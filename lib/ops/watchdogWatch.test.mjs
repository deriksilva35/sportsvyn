// lib/ops/watchdogWatch.test.mjs - the live poller watches the watchdog (sun-8).
//
// Pure: the 26h rule and the start-time grace. DEV DB: a sentinel watchdog
// ledger with NO pass (only a flag and an alert row, neither of which is a
// pass) is alerted exactly once; a second check the same day is silent; a
// fresh pass makes it healthy. The alert sender is a stub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchdogStale, checkWatchdogAlive, NOT_A_PASS, STALE_HOURS, CHECK_EVERY_MS } from './watchdogWatch.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = 3_600_000;

test('26 hours: a daily pass plus two hours of slack', () => {
  const now = new Date('2026-10-05T17:00:00Z');
  assert.equal(STALE_HOURS, 26);
  assert.equal(watchdogStale('2026-10-04T15:17:30Z', now), false, 'yesterday 15:17 is fine at 17:00');
  assert.equal(watchdogStale(new Date(now - 26 * H + 60_000), now), false);
  assert.equal(watchdogStale(new Date(now - 26 * H - 60_000), now), true);
  assert.equal(watchdogStale(null, now), true, 'never is stale');
});

test('THE CLOCK STARTS NO EARLIER THAN THE WATCHER: a poller restarted at deploy does not page about a pass that could not exist yet', () => {
  const since = new Date('2026-10-05T10:00:00Z');
  assert.equal(watchdogStale(null, new Date('2026-10-05T11:00:00Z'), 26, since), false);
  assert.equal(watchdogStale(null, new Date('2026-10-06T12:01:00Z'), 26, since), true, '26h after start with still no pass');
  assert.equal(watchdogStale('2026-10-01T15:17:00Z', new Date('2026-10-05T11:00:00Z'), 26, since), false);
});

test('flag, alert and skipped-locked rows are not a pass', () => {
  assert.deepEqual([...NOT_A_PASS].sort(), ['alert', 'flag', 'skipped-locked']);
});

test('a check that cannot read never throws - it returns the error', async () => {
  const sql = async () => { throw new Error('db down'); };
  const r = await checkWatchdogAlive({ sql, alert: async () => { throw new Error('must not send'); } });
  assert.deepEqual(r, { error: 'db down' });
});

test('the poller wires it: hourly, off the league loops, contained, from the process start', () => {
  const s = readFileSync(path.join(REPO, 'services/live-poller/index.mjs'), 'utf8');
  assert.equal(CHECK_EVERY_MS, H);
  assert.match(s, /import \{ checkWatchdogAlive, CHECK_EVERY_MS as WATCHDOG_CHECK_MS \} from '\.\.\/\.\.\/lib\/ops\/watchdogWatch\.js'/);
  assert.match(s, /checkWatchdogAlive\(\{ sql, since, alert: \(a\) => maybeAlert\(sql, a\) \}\)/);
  assert.match(s, /await sleep\(WATCHDOG_CHECK_MS\)/);
  assert.match(s, /\}\)\(\)\.catch\(\(\) => \{\}\);/, 'the loop itself is caught');
  const loopBody = s.slice(s.indexOf('async function loop('), s.indexOf('log(`live-poller starting'));
  assert.doesNotMatch(loopBody, /checkWatchdogAlive/, 'never inside a league loop');
});

// ---------------------------------------------------------------------------
// DEV DB
// ---------------------------------------------------------------------------

const HAS_DB = Boolean(process.env.DATABASE_URL);
const REFUSE = HAS_DB && process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL;
const SRC = `sentinel-wdwatch-${process.pid}`;
const WATCH = `${SRC}-watch`;
let sql;

before(async () => {
  if (!HAS_DB || REFUSE) return;
  ({ sql } = await import('../db.js'));
  // THE PLANTED MISSING ROW: the last real pass is 30 hours old; fresher rows
  // exist, but they are a flag and an alert - not passes.
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary) VALUES
      (${SRC}, 'daily', now() - interval '30 hours', now() - interval '30 hours', true, '{}'::jsonb),
      (${SRC}, 'flag', now() - interval '1 hour', now() - interval '1 hour', true, '{"key":"x"}'::jsonb),
      (${SRC}, 'alert', now() - interval '1 hour', now() - interval '1 hour', true, '{"subject":"s"}'::jsonb)`;
});

after(async () => {
  if (!sql) return;
  await sql`DELETE FROM sync_runs WHERE source = ANY(${[SRC, WATCH]})`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM sync_runs WHERE source = ANY(${[SRC, WATCH]})`;
  assert.equal(n, 0, 'watchdogWatch test left rows behind on DEV');
});

test('DEV: a missing watchdog pass is alerted ONCE a day; a fresh pass is healthy', { skip: !HAS_DB || REFUSE ? 'no DEV database' : false }, async () => {
  const sent = [];
  const alert = async (a) => { sent.push(a); return { sent: true }; };
  const check = () => checkWatchdogAlive({ sql, alert, source: SRC, watchSource: WATCH });

  const first = await check();
  assert.equal(first.error, undefined);
  assert.equal(first.stale, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].source, WATCH);
  assert.match(sent[0].subject, /^\[watchdog\] the cron watchdog has not run since \d{4}-\d\d-\d\d \d\d:\d\dZ$/);
  assert.match(sent[0].body, /kind daily/, 'it names the 30-hour-old pass, not the fresh flag or alert row');

  const second = await check();
  assert.equal(second.stale, true);
  assert.equal(second.skipped, 'already alerted today');
  assert.equal(sent.length, 1, 'silent the second time the same day');

  // Nothing was written under the watched source by the watcher.
  const [{ n }] = await sql`SELECT count(*)::int n FROM sync_runs WHERE source = ${SRC}`;
  assert.equal(n, 3);

  await sql`INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
            VALUES (${SRC}, 'daily', now(), now(), true, '{}'::jsonb)`;
  const third = await check();
  assert.equal(third.stale, false);
  assert.equal(sent.length, 1);
});
