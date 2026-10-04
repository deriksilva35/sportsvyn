// lib/ops/cronExpr.test.mjs - the five-field reader the cron watchdog leans on.
// Every schedule in vercel.json is read here too, so a new expression shape
// that this parser cannot handle fails the suite rather than the watchdog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCron, prevFire, firesBetween, minIntervalMs } from './cronExpr.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = 3_600_000;
const iso = (d) => (d ? d.toISOString() : null);

test('parse: lists, ranges, steps, and 7 is Sunday', () => {
  const c = parseCron('0,30 6-20/7 * * 7');
  assert.deepEqual(c.minutes, [0, 30]);
  assert.deepEqual(c.hours, [6, 13, 20]);
  assert.deepEqual([...c.dows], [0]);
  assert.deepEqual(parseCron('40 */3 * * *').hours, [0, 3, 6, 9, 12, 15, 18, 21]);
  assert.deepEqual(parseCron('30 20,2 * * *').hours, [2, 20], 'sorted, whatever the order written');
  assert.deepEqual(parseCron('5/20 * * * *').minutes, [5, 25, 45], "'a/n' runs from a to the top");
});

test('parse: refuses what it cannot read exactly, instead of misreading it', () => {
  for (const bad of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *',
    '* * * * 8', '0 9 * * MON', '0 9 ? * *', '*/0 * * * *', '5-1 * * * *', 'L * * * *']) {
    assert.throws(() => parseCron(bad), Error, `'${bad}' should be refused`);
  }
});

test('prevFire: a fire exactly AT t counts; one second before it does not', () => {
  assert.equal(iso(prevFire('0 * * * *', '2026-10-04T15:00:00Z')), '2026-10-04T15:00:00.000Z');
  assert.equal(iso(prevFire('0 * * * *', '2026-10-04T14:59:59Z')), '2026-10-04T14:00:00.000Z');
  assert.equal(iso(prevFire('*/5 * * * *', '2026-10-04T15:17:42Z')), '2026-10-04T15:15:00.000Z');
});

test('prevFire: a windowed schedule (pickem-settle) - on a Wednesday the last fire is Tuesday 20:00Z', () => {
  const s = '0 6-20 * * 0,1,2';
  // 2026-10-07 is a Wednesday.
  assert.equal(new Date('2026-10-07T00:00:00Z').getUTCDay(), 3);
  assert.equal(iso(prevFire(s, '2026-10-07T15:17:00Z')), '2026-10-06T20:00:00.000Z');
  // Saturday too, and on Sunday before the window opens.
  assert.equal(iso(prevFire(s, '2026-10-10T12:00:00Z')), '2026-10-06T20:00:00.000Z');
  assert.equal(iso(prevFire(s, '2026-10-11T05:59:00Z')), '2026-10-06T20:00:00.000Z');
  assert.equal(iso(prevFire(s, '2026-10-11T06:00:00Z')), '2026-10-11T06:00:00.000Z');
  // Inside the window it is the top of the current hour.
  assert.equal(iso(prevFire(s, '2026-10-05T13:59:00Z')), '2026-10-05T13:00:00.000Z');
});

test('prevFire: weekly, crosses months and years', () => {
  // power-edition nfl, Tuesdays 13:05Z.
  assert.equal(iso(prevFire('5 13 * * 2', '2026-10-05T23:00:00Z')), '2026-09-29T13:05:00.000Z');
  assert.equal(iso(prevFire('5 13 * * 2', '2026-10-06T13:05:00Z')), '2026-10-06T13:05:00.000Z');
  assert.equal(iso(prevFire('0 0 1 1 *', '2026-06-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  assert.equal(iso(prevFire('59 23 31 12 *', '2027-01-01T00:00:00Z')), '2026-12-31T23:59:00.000Z');
});

test('prevFire: a day-of-month AND a day-of-week restriction match on EITHER (classic cron)', () => {
  // 1st of the month OR any Monday. 2026-10-01 is a Thursday; 2026-10-05 a Monday.
  assert.equal(iso(prevFire('0 12 1 * 1', '2026-10-04T00:00:00Z')), '2026-10-01T12:00:00.000Z');
  assert.equal(iso(prevFire('0 12 1 * 1', '2026-10-05T13:00:00Z')), '2026-10-05T12:00:00.000Z');
});

test('prevFire: null when nothing fires inside the look-back (Feb 30 never comes)', () => {
  assert.equal(prevFire('0 0 30 2 *', '2026-10-04T00:00:00Z'), null);
});

test('firesBetween: inclusive both ends, ascending', () => {
  const f = firesBetween('40 */3 * * *', '2026-10-03T00:40:00Z', '2026-10-03T06:40:00Z').map(iso);
  assert.deepEqual(f, ['2026-10-03T00:40:00.000Z', '2026-10-03T03:40:00.000Z', '2026-10-03T06:40:00.000Z']);
});

test('minIntervalMs: the NOMINAL cadence, not the closed window', () => {
  assert.equal(minIntervalMs('0 6-20 * * 0,1,2'), 1 * H, 'pickem-settle is hourly inside its window');
  assert.equal(minIntervalMs('0 9-20 * * 2'), 1 * H);
  assert.equal(minIntervalMs('40 */3 * * *'), 3 * H);
  assert.equal(minIntervalMs('*/5 * * * *'), 5 * 60_000);
  assert.equal(minIntervalMs('30 20,2 * * *'), 6 * H, 'the shorter of the two gaps');
  assert.equal(minIntervalMs('0 13,21 * * *'), 8 * H);
  assert.equal(minIntervalMs('50 10 * * *'), 24 * H);
  assert.equal(minIntervalMs('0 15 * * 1'), 7 * 24 * H);
  assert.equal(minIntervalMs('0 0 30 2 *'), null);
});

test('every schedule in vercel.json parses, fires, and has an interval', () => {
  const vercel = JSON.parse(readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.length > 20, 'reading the real file');
  for (const c of vercel.crons) {
    assert.ok(prevFire(c.schedule, '2026-10-04T15:17:00Z'), `${c.path}: '${c.schedule}' never fires`);
    assert.ok(minIntervalMs(c.schedule) > 0, `${c.path}: '${c.schedule}' has no interval`);
  }
});
