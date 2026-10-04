// lib/ops/cfbdQuota.test.mjs - will the month last? Pure projection over a
// 7-day window (sun-10, Derik) + the check's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  projectCfbdQuota, checkCfbdQuota, nextResetAt, CFBD_MONTHLY_LIMIT,
  BURN_WINDOW_HOURS, MIN_SPAN_HOURS, STALE_HOURS,
} from './cfbdQuota.js';

const now = new Date('2026-10-18T12:00:00Z');          // a Sunday, the morning after a Saturday
const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000).toISOString();

/** Hourly readings for the last `days` days, spending `perDay(at)` a day. */
function week(start, perDay, days = 7) {
  const out = []; let left = start;
  for (let h = days * 24; h >= 0; h--) {
    const at = new Date(now.getTime() - h * 3600_000);
    out.push({ at: at.toISOString(), remaining: Math.round(left) });
    left -= perDay(at) / 24;
  }
  return out;
}
const saturday = (at) => at.getUTCDay() === 6;

test('the window is seven days, the span floor a day, the stale rule half a day', () => {
  assert.equal(BURN_WINDOW_HOURS, 168);
  assert.equal(MIN_SPAN_HOURS, 24);
  assert.equal(STALE_HOURS, 12);
  assert.equal(nextResetAt(now).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(nextResetAt(new Date('2026-12-31T23:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(CFBD_MONTHLY_LIMIT, 75_000);
});

test('A SATURDAY SPIKE DOES NOT ALERT while the 7-day average is sustainable', () => {
  // ~3,000 on the Saturday, ~70 every other day: ~490/day averaged, against
  // ~3,000/day sustainable with 40,000 left and 13.5 days to the reset.
  const rs = week(43_500, (at) => (saturday(at) ? 3000 : 70));
  const p = projectCfbdQuota(rs, { now });
  assert.equal(p.status, 'ok', p.reason);
  assert.ok(p.burnPerDay > 400 && p.burnPerDay < 600, String(p.burnPerDay));
  // The spike is in the data: the last 36 h alone spent ~3,000, a pace that
  // read over one day would project ~40,000 by the reset and alarm.
  const recent = rs.filter((r) => new Date(r.at).getTime() >= now.getTime() - 36 * 3600_000);
  assert.ok(recent[0].remaining - recent.at(-1).remaining > 2900, 'the Saturday is there');
  assert.ok((recent[0].remaining - recent.at(-1).remaining) * 13.5 > p.remaining, 'and a one-day window would have alerted on it');
});

test('3 Oct\'s pace held for a week alerts: ~5,700 a day runs out before the reset', () => {
  const p = projectCfbdQuota(week(74_000, () => 5700), { now });
  assert.equal(p.status, 'alert', p.reason);
  assert.ok(p.burnPerDay > 5600 && p.burnPerDay < 5800, String(p.burnPerDay));
  assert.ok(p.exhaustsAt < '2026-11-01', p.exhaustsAt);
});

test('readings across the monthly reset count only after it; under a day after it is no verdict', () => {
  const rs = [
    { at: '2026-09-28T00:00:00Z', remaining: 67000 }, { at: '2026-09-30T23:00:00Z', remaining: 65763 },
    { at: '2026-10-01T00:10:00Z', remaining: 74994 }, { at: '2026-10-02T12:00:00Z', remaining: 74500 },
    { at: '2026-10-03T11:50:00Z', remaining: 73900 },
  ];
  const p = projectCfbdQuota(rs, { now: new Date('2026-10-03T12:00:00Z') });
  assert.equal(p.readings, 3, 'September is dropped');
  assert.ok(p.burnPerDay > 400 && p.burnPerDay < 480, `post-reset rate only: ${p.burnPerDay}`);
  assert.equal(p.status, 'ok');
  const early = projectCfbdQuota(rs.slice(0, 3).concat([{ at: '2026-10-01T10:00:00Z', remaining: 74800 }]),
    { now: new Date('2026-10-01T10:30:00Z') });
  assert.equal(early.status, 'unknown');
  assert.match(early.reason, /need 24/);
});

test('out-of-order readings from concurrent runs do not read as a reset', () => {
  const p = projectCfbdQuota([
    { at: hoursAgo(72), remaining: 70000 }, { at: hoursAgo(48), remaining: 69000 },
    { at: hoursAgo(47.9), remaining: 69004 }, { at: hoursAgo(0), remaining: 67000 },
  ], { now });
  assert.equal(p.readings, 4);
  assert.equal(p.burnPerDay, 1000);
});

test('thin, stale or empty ledgers say unknown - never alert', () => {
  assert.equal(projectCfbdQuota([], { now }).status, 'unknown');
  assert.equal(projectCfbdQuota([{ at: hoursAgo(10), remaining: 9000 }, { at: hoursAgo(0), remaining: 0 }], { now }).status,
    'unknown', 'ten hours is not a weekly rate');
  const stale = projectCfbdQuota([{ at: hoursAgo(100), remaining: 9000 }, { at: hoursAgo(13), remaining: 100 }], { now });
  assert.equal(stale.status, 'unknown');
  assert.match(stale.reason, /h old/);
  assert.equal(projectCfbdQuota([{ at: hoursAgo(24 * 8), remaining: 5 }], { now }).status, 'unknown', 'older than the window');
});

test('checkCfbdQuota returns what to send and a once-a-day flag key, sends nothing', async () => {
  const sql = () => { throw new Error('must not read when readings are given'); };
  const r = await checkCfbdQuota(sql, { now, readings: [{ at: hoursAgo(72), remaining: 50000 }, { at: hoursAgo(0), remaining: 35000 }] });
  assert.equal(r.alert, true);
  assert.equal(r.flagKey, 'cfbd-quota:2026-10-18');
  assert.match(r.subject, /^\[ops\] CFBD quota runs out 2026-10-2\d, before the 2026-11-01 reset$/);
  assert.match(r.body, /CFBD remaining: 35000 of 75000/);
  assert.match(r.body, /burn \(last 7 days of readings, averaged\): 5000\/day/);
  const quiet = await checkCfbdQuota(sql, { now, readings: [] });
  assert.equal(quiet.alert, false);
});

test('the read samples one reading per hour, so a week of plays-live rows stays small', () => {
  const src = readFileSync(new URL('./cfbdQuota.js', import.meta.url), 'utf8');
  assert.match(src, /SELECT DISTINCT ON \(date_trunc\('hour', started_at\)\)/);
  assert.match(src, /ORDER BY date_trunc\('hour', started_at\), started_at DESC/);
});
