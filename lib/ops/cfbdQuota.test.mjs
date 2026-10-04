// lib/ops/cfbdQuota.test.mjs - will the month last? Pure projection + the check's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectCfbdQuota, checkCfbdQuota, nextResetAt, CFBD_MONTHLY_LIMIT } from './cfbdQuota.js';

const now = new Date('2026-10-04T00:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000).toISOString();

test('the reset is 00:00Z on the 1st of next month (PROD: 65,763 on 30 Sep, 74,994 on 1 Oct)', () => {
  assert.equal(nextResetAt(now).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(nextResetAt(new Date('2026-12-31T23:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(CFBD_MONTHLY_LIMIT, 75_000);
});

test('3 Oct\'s pace alerts: ~5,700 a day runs out mid-month', () => {
  const p = projectCfbdQuota([
    { at: hoursAgo(24), remaining: 73838 }, { at: hoursAgo(12), remaining: 71000 }, { at: hoursAgo(0.2), remaining: 68090 },
  ], { now });
  assert.equal(p.status, 'alert');
  assert.equal(p.remaining, 68090);
  assert.ok(p.burnPerDay > 5700 && p.burnPerDay < 5900, String(p.burnPerDay));
  assert.ok(p.exhaustsAt < '2026-10-17', p.exhaustsAt);
  assert.equal(p.sustainablePerDay, Math.floor(68090 / 28));
});

test('the 2,000/day target passes', () => {
  const p = projectCfbdQuota([{ at: hoursAgo(24), remaining: 70090 }, { at: hoursAgo(0), remaining: 68090 }], { now });
  assert.equal(p.burnPerDay, 2000);
  assert.equal(p.status, 'ok');
});

test('readings across the monthly reset count only after it', () => {
  const p = projectCfbdQuota([
    { at: '2026-09-30T20:00:00Z', remaining: 65800 }, { at: '2026-09-30T23:00:00Z', remaining: 65763 },
    { at: '2026-10-01T00:10:00Z', remaining: 74994 }, { at: '2026-10-01T12:00:00Z', remaining: 74790 },
  ], { now: new Date('2026-10-01T12:05:00Z') });
  assert.equal(p.remaining, 74790);
  assert.ok(p.burnPerDay > 300 && p.burnPerDay < 500, `post-reset rate only: ${p.burnPerDay}`);
  assert.equal(p.status, 'ok');
});

test('out-of-order readings from concurrent runs do not read as a reset', () => {
  const p = projectCfbdQuota([
    { at: hoursAgo(20), remaining: 70000 }, { at: hoursAgo(10), remaining: 69000 },
    { at: hoursAgo(9.9), remaining: 69004 }, { at: hoursAgo(0), remaining: 68000 },
  ], { now });
  assert.equal(p.readings, 4);
  assert.equal(p.burnPerDay, 2400);
});

test('thin, stale or empty ledgers say unknown - never alert', () => {
  assert.equal(projectCfbdQuota([], { now }).status, 'unknown');
  assert.equal(projectCfbdQuota([{ at: hoursAgo(1), remaining: 1 }, { at: hoursAgo(0), remaining: 0 }], { now }).status, 'unknown', 'one hour is not a rate');
  const stale = projectCfbdQuota([{ at: hoursAgo(23), remaining: 9000 }, { at: hoursAgo(10), remaining: 100 }], { now });
  assert.equal(stale.status, 'unknown');
  assert.match(stale.reason, /h old/);
  assert.equal(projectCfbdQuota([{ at: hoursAgo(30), remaining: 5 }], { now }).status, 'unknown', 'older than the window');
});

test('checkCfbdQuota returns what to send and a once-a-day flag key, sends nothing', async () => {
  const sql = () => { throw new Error('must not read when readings are given'); };
  const r = await checkCfbdQuota(sql, { now, readings: [{ at: hoursAgo(24), remaining: 73838 }, { at: hoursAgo(0), remaining: 68090 }] });
  assert.equal(r.alert, true);
  assert.equal(r.flagKey, 'cfbd-quota:2026-10-04');
  assert.match(r.subject, /^\[ops\] CFBD quota runs out 2026-10-1\d, before the 2026-11-01 reset$/);
  assert.match(r.body, /CFBD remaining: 68090 of 75000/);
  assert.match(r.body, /burn \(last 24 h of readings\): 5748\/day/);
  const quiet = await checkCfbdQuota(sql, { now, readings: [] });
  assert.equal(quiet.alert, false);
});
