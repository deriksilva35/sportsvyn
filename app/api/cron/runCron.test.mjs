// app/api/cron/runCron.test.mjs - the two Run crons: their schedules, their
// shape, and the one rule the nudge has that a settle does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// THE ALIAS RESOLVER, because the route imports '@/lib/...' - the same
// install() every other test that touches app/ code uses.
import { install } from '../../../lib/testing/nextResolve.mjs';
install();

const { dueForNudge, NUDGE_WINDOW_HOURS } = await import('./run-nudge/route.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const VERCEL = JSON.parse(src('vercel.json'));
const at = (p) => VERCEL.crons.find((c) => c.path === p);

test('BOTH CRONS ARE REGISTERED, at the stated times', () => {
  // 0 15 * * * UTC = 8 AM Pacific. `15 0` would be 00:15Z, which is the
  // mistake this assertion exists to keep caught - the minute comes first.
  assert.equal(at('/api/cron/run-nudge').schedule, '0 15 * * *');
  const [min, hour] = at('/api/cron/run-nudge').schedule.split(' ');
  assert.equal(min, '0');
  assert.equal(hour, '15', '15:00Z, not 00:15Z');

  // The settle runs hourly across the day, every day: baseball's postseason
  // plays every day for a month and a west-coast game can end near 05Z.
  assert.equal(at('/api/cron/run-settle').schedule, '0 6-20 * * *');
});

test('ONE NUDGE A DAY, not hourly, and the comment says why', () => {
  // A settle refuses until its gate opens and can fire harmlessly on the
  // hour; a nudge that finds work SENDS. Hourly would send the same reminder
  // fifteen times.
  const sched = at('/api/cron/run-nudge').schedule;
  assert.doesNotMatch(sched, /-|\//, 'no range and no step - one firing a day');
  assert.match(src('app/api/cron/run-nudge/route.js'), /ONE FIRING A DAY, not hourly/);
});

test('THE NUDGE WINDOW IS THE ROUND\'S LOCK, not the clock it runs on', () => {
  const now = new Date('2026-10-05T15:00:00Z');
  const h = (n) => new Date(now.getTime() + n * 3_600_000).toISOString();
  const rounds = [
    { id: 1, week: 1, locks_at: h(-1) },    // already locked
    { id: 2, week: 2, locks_at: h(2) },     // tonight
    { id: 3, week: 3, locks_at: h(23) },    // tomorrow, just inside
    { id: 4, week: 4, locks_at: h(25) },    // just outside
    { id: 5, week: 4, locks_at: h(120) },   // five days out
    { id: 6, week: 4, locks_at: null },     // no board, no lock
  ];
  assert.equal(NUDGE_WINDOW_HOURS, 24);
  assert.deepEqual(dueForNudge(rounds, now).map((r) => r.id), [2, 3]);

  // A LOCK ALREADY PASSED IS NOT A NUDGE, it is a DNF - telling somebody to
  // hurry would be a lie about what is still possible.
  assert.ok(!dueForNudge(rounds, now).some((r) => r.id === 1));
  // Exactly at the edge is inside; a minute past it is not.
  assert.equal(dueForNudge([{ id: 9, locks_at: h(24) }], now).length, 1);
  assert.equal(dueForNudge([{ id: 9, locks_at: h(24.01) }], now).length, 0);
  assert.deepEqual(dueForNudge([], now), []);
  assert.deepEqual(dueForNudge(null, now), []);
});

test('THE SIBLING SHAPE: auth, advisory lock, recordRun, alert on failure', () => {
  for (const f of ['app/api/cron/run-nudge/route.js', 'app/api/cron/run-settle/route.js']) {
    const s = src(f);
    assert.match(s, /cronAuthorized\(request\)/, `${f} checks the bearer`);
    assert.match(s, /withAdvisoryLock\(SOURCE/, `${f} takes the lock`);
    assert.match(s, /skipped-locked/, `${f} records a lost lock rather than running twice`);
    assert.match(s, /recordRun\(sql/, `${f} records its run`);
    assert.match(s, /maybeAlert\(sql/, `${f} pages on failure`);
    assert.match(s, /export const dynamic = 'force-dynamic'/, f);
  }
});

test('run-open FIRES FROM THE JOB THAT OPENS THE ROUND, not from a clock', () => {
  const s = src('app/api/cron/run-settle/route.js');
  // One job, both halves: the thing that notices a round is decided is the
  // only thing that knows when the next one's morning is.
  assert.match(s, /settleDueRun\(\)/);
  assert.match(s, /ensureRunRounds\(/);
  assert.match(s, /notifyEvent\(`run-open:\$\{o\.id\}`/);
  // Only on rounds THIS firing created - not on every round that exists.
  assert.match(s, /\.filter\(\(x\) => x\.created\)/);
  // The settled result is per reader; the open is bulk.
  assert.match(s, /notifyPersonalized\(`run-settled:\$\{r\.contestId\}`/);
  assert.match(s, /\.filter\(\(x\) => x\.settled\)/);
  // AND NO SEPARATE run-open CRON - a second job would be one guessing.
  assert.equal(VERCEL.crons.filter((c) => c.path.includes('run-open')).length, 0);
});
