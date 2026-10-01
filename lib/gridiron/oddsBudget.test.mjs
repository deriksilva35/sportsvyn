// lib/gridiron/oddsBudget.test.mjs - The Odds API plan, watched (thu-12, item 4):
// the pure decisions, the run against a fake sql, the copy, and the cron wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THRESHOLDS, fmt, planOf, pctOf, thresholdCrossed, monthKey, monthStart, eventIdFor,
  splitText, budgetParams, budgetVerdict,
} from './oddsBudget.js';
import { readUsage, runOddsBudget, pushOddsBudget, sportSpendThisMonth } from './oddsBudgetRun.js';
import { renderCopy, PUSH_COPY } from '../push/copy.js';
import { ADMIN_USER_IDS } from '../admin/gate.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-21T09:05:00Z');

// A tagged-template sql double: answers by query text, records every call.
function fakeSql({ spend = [], recorded = [] } = {}) {
  const calls = [];
  const sql = (strings, ...vals) => {
    const q = strings.join('?');
    calls.push({ q, vals });
    if (/GROUP BY source/.test(q)) return Promise.resolve(spend);
    if (/ORDER BY started_at DESC/.test(q)) return Promise.resolve(recorded);
    return Promise.resolve([]);
  };
  sql.calls = calls;
  return sql;
}

test('THE PLAN IS THE VENDOR\'S: used + remaining from the headers, never a literal', () => {
  assert.deepEqual(planOf({ requests_used: '54', requests_remaining: '99946', requests_last: '0' }),
    { used: 54, remaining: 99946, plan: 100000 });
  assert.deepEqual(planOf({ requests_used: '0', requests_remaining: '500' }), { used: 0, remaining: 500, plan: 500 },
    'a 500-credit key reads as a 500-credit plan, not as the 100K one');
  assert.equal(planOf({ requests_used: null, requests_remaining: '5' }), null);
  assert.equal(planOf({ requests_used: '5', requests_remaining: '' }), null);
  assert.equal(planOf(null), null);
});

test('numbers carry thousands separators; pct is rounded for display', () => {
  assert.equal(fmt(36123), '36,123');
  assert.equal(fmt(100000), '100,000');
  assert.equal(fmt(54), '54');
  assert.equal(pctOf(36123, 50000), 72);
  assert.equal(pctOf(49600, 100000), 50);
  assert.equal(pctOf(0, 0), 0);
});

test('THRESHOLDS 50/70/90: the HIGHEST crossed only, on the exact ratio', () => {
  assert.deepEqual([...THRESHOLDS], [50, 70, 90]);
  assert.equal(thresholdCrossed(49999, 100000), null);
  assert.equal(thresholdCrossed(49600, 100000), null, '49.6% displays as 50% but has not crossed 50');
  assert.equal(thresholdCrossed(50000, 100000), 50);
  assert.equal(thresholdCrossed(69999, 100000), 50);
  assert.equal(thresholdCrossed(70000, 100000), 70);
  assert.equal(thresholdCrossed(92000, 100000), 90, 'a first run at 92% pushes 90 alone, not all three');
  assert.equal(thresholdCrossed(100000, 100000), 90);
  assert.equal(thresholdCrossed(5, 0), null);
});

test('ONE PUSH PER THRESHOLD PER UTC MONTH: the event id is month + threshold', () => {
  assert.equal(eventIdFor(70, NOW), 'ops-odds-budget:2026-10:70');
  assert.equal(eventIdFor(70, new Date('2026-10-31T23:59:59Z')), eventIdFor(70, NOW), 'same month, same id - sent once');
  assert.notEqual(eventIdFor(70, new Date('2026-11-01T00:00:00Z')), eventIdFor(70, NOW), 'the window reset, a new id');
  assert.notEqual(eventIdFor(90, NOW), eventIdFor(70, NOW), 'a higher crossing is a new push');
  assert.equal(monthKey(new Date('2026-10-01T00:30:00Z')), '2026-10');
  assert.equal(monthStart(NOW).toISOString(), '2026-10-01T00:00:00.000Z');
});

test('THE SPLIT IS SHARES OF CREDITS USED: descending, rounded, adding to exactly 100', () => {
  // 17-30 Sep 2026, measured: NFL 6,306 / CFB 4,761 / EPL 4,226.
  const sep = { nfl: 6306, cfb: 4761, epl: 4226 };
  assert.equal(splitText(sep), 'NFL 41% · CFB 31% · EPL 28%');
  const shares = (s) => [...s.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
  assert.equal(shares(splitText(sep)).reduce((a, b) => a + b, 0), 100);
  // Three equal sports: 33.3 each - largest remainder still adds to 100.
  assert.equal(splitText({ nfl: 1, cfb: 1, epl: 1 }), 'CFB 34% · EPL 33% · NFL 33%');
  // Order is by credits, not by the object's key order.
  assert.equal(splitText({ nba: 7, epl: 30, cfb: 22, nfl: 41 }), 'NFL 41% · EPL 30% · CFB 22% · NBA 7%');
  assert.equal(splitText({ nfl: 10, cfb: 0 }), 'NFL 100%', 'a sport with no spend is left out');
  assert.equal(splitText({}), 'no sport spend yet');
});

test('THE BODY, rendered through the real copy: the agreed shape', () => {
  const params = budgetParams({ used: 36123, plan: 50000 }, { nfl: 41, cfb: 22, epl: 30, nba: 7 });
  assert.deepEqual(params, { pct: '72', used: '36,123', plan: '50,000', split: 'NFL 41% · EPL 30% · CFB 22% · NBA 7%' });
  const c = renderCopy('ops-odds-budget:2026-10:70', params);
  assert.equal(c.title, 'Odds API');
  assert.equal(c.body, 'Odds API 72% of plan (36,123 / 50,000) · NFL 41% · EPL 30% · CFB 22% · NBA 7%');
  assert.ok(c.body.length <= 110, 'four sports still fit the lock-screen cut');
  assert.ok(PUSH_COPY['ops-odds-budget'].url.startsWith('/admin'));
  assert.throws(() => renderCopy('ops-odds-budget:2026-10:70', { pct: '72' }), /missing param/);
});

test('the verdict: no threshold, no event id', () => {
  const v = budgetVerdict({ usage: { used: 54, remaining: 99946, plan: 100000 }, bySport: { nfl: 24, cfb: 24 }, now: NOW });
  assert.equal(v.pct, 0); assert.equal(v.threshold, null); assert.equal(v.eventId, null);
  const w = budgetVerdict({ usage: { used: 72000, remaining: 28000, plan: 100000 }, bySport: { nfl: 3 }, now: NOW });
  assert.equal(w.threshold, 70); assert.equal(w.eventId, 'ops-odds-budget:2026-10:70');
});

test('USAGE: the free vendor call first; this month\'s recorded budget if it fails; a throw if neither', async () => {
  const sql = fakeSql({ recorded: [{ budget: { requests_used: '1200', requests_remaining: '98800' }, started_at: '2026-10-21T08:45:00Z' }] });
  const vendor = await readUsage({ sql, fetchUsage: async () => ({ requests_used: '1300', requests_remaining: '98700' }), now: NOW });
  assert.deepEqual(vendor, { used: 1300, remaining: 98700, plan: 100000, from: 'vendor' });
  assert.equal(sql.calls.length, 0, 'a good vendor read never touches the database');

  const fb = await readUsage({ sql, fetchUsage: async () => { throw new Error('TheOddsAPI 503 on usage'); }, now: NOW });
  assert.equal(fb.from, 'sync_runs'); assert.equal(fb.used, 1200); assert.equal(fb.plan, 100000);
  assert.match(fb.vendorError, /503/);
  const q = sql.calls[0];
  assert.match(q.q, /started_at >= \?::timestamptz/, 'the fallback is bounded to this month');
  assert.equal(q.vals[0], '2026-10-01T00:00:00.000Z');

  const bad = await readUsage({ sql, fetchUsage: async () => ({ requests_used: null }), now: NOW });
  assert.equal(bad.from, 'sync_runs', 'unreadable headers fall back too');

  await assert.rejects(readUsage({ sql: fakeSql(), fetchUsage: async () => { throw new Error('down'); }, now: NOW }),
    /no usage reading/);
});

test('SPEND BY SPORT: odds/futures cost requests_last, props creditsLast, grouped by source prefix', async () => {
  const sql = fakeSql({ spend: [
    { source: 'nfl-odds', credits: 2082 }, { source: 'nfl-props', credits: 4210 }, { source: 'nfl-futures', credits: 14 },
    { source: 'cfb-odds', credits: 2082 }, { source: 'epl-props', credits: 2144 }, { source: 'odds-budget', credits: 0 },
  ] });
  assert.deepEqual(await sportSpendThisMonth(sql, NOW), { nfl: 6306, cfb: 2082, epl: 2144 });
  const q = sql.calls[0].q;
  assert.match(q, /WHEN source LIKE '%-props'\s+THEN coalesce\(\(summary->>'creditsLast'\)::int, 0\)/);
  assert.match(q, /ELSE coalesce\(\(summary->'budget'->>'requests_last'\)::int, 0\)/);
  assert.match(q, /source ~ '\^\[a-z0-9\]\+-\(odds\|props\|futures\)\$'/, 'odds-budget itself and the -zeromatch alert keys never count');
  assert.match(q, /kind <> 'alert'/);
});

test('THE RUN pushes the highest crossed threshold to the admin account, once, with the rendered params', async () => {
  const sent = [];
  const notify = async (id, recipients) => { sent.push({ id, recipients }); return { sent: 1 }; };
  const sql = fakeSql({ spend: [{ source: 'nfl-odds', credits: 30000 }, { source: 'cfb-props', credits: 20000 }, { source: 'epl-odds', credits: 22123 }] });
  const r = await runOddsBudget({ sql, notify, now: NOW, fetchUsage: async () => ({ requests_used: '72123', requests_remaining: '27877' }) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 'ops-odds-budget:2026-10:70');
  assert.deepEqual(sent[0].recipients, ADMIN_USER_IDS.map((userId) => ({
    userId, params: { pct: '72', used: '72,123', plan: '100,000', split: 'NFL 41% · EPL 31% · CFB 28%' },
  })));
  assert.equal(r.threshold, 70); assert.equal(r.from, 'vendor'); assert.deepEqual(r.push, { sent: 1 });

  sent.length = 0;
  const quiet = await runOddsBudget({ sql, notify, now: NOW, fetchUsage: async () => ({ requests_used: '54', requests_remaining: '99946' }) });
  assert.equal(sent.length, 0, 'under 50% nothing is sent'); assert.equal(quiet.push, null);
});

test('A PUSH THAT CANNOT BE SENT NEVER THROWS INTO THE RUN', async () => {
  const r = await pushOddsBudget({ eventId: 'ops-odds-budget:2026-10:90', params: {}, notify: async () => { throw new Error('apns down'); } });
  assert.deepEqual(r, { error: 'apns down' });
});

test('THE CRON: daily at 5 9 * * *, gated, locked, recorded and alerted on its own source', () => {
  const vercel = JSON.parse(src('vercel.json'));
  const c = vercel.crons.filter((x) => x.path === '/api/cron/odds-budget');
  assert.equal(c.length, 1); assert.equal(c[0].schedule, '5 9 * * *');
  assert.equal(vercel.crons.filter((x) => x.schedule === '5 9 * * *').length, 1, 'its minute is its own');
  const r = src('app/api/cron/odds-budget/route.js');
  assert.match(r, /if \(!cronAuthorized\(request\)\) return new Response\('Unauthorized', \{ status: 401 \}\)/);
  assert.match(r, /const SOURCE = 'odds-budget'/);
  assert.match(r, /withAdvisoryLock\(SOURCE,/);
  assert.match(r, /recordRun\(sql, \{\s+source: SOURCE,\s+kind: 'daily',\s+run: \(\) => runOddsBudget\(\{ sql, fetchUsage \}\)/);
  assert.match(r, /maybeAlert\(sql, \{\s+source: SOURCE,/);
  assert.match(r, /import \{ fetchUsage \} from '@\/lib\/theOddsApi'/, 'the key handling is the existing client\'s');
});

test('the usage read is the FREE sports list, through the existing client', () => {
  const t = src('lib/theOddsApi.js');
  const start = t.indexOf('export async function fetchUsage');
  const fn = t.slice(start, t.indexOf('\n}', start));
  assert.match(fn, /oddsApiGet\('\/sports', 'usage', \{ raw: true \}\)/);
  assert.doesNotMatch(fn, /\/odds\?/, 'never a priced /odds call');
});
