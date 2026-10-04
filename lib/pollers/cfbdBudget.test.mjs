// lib/pollers/cfbdBudget.test.mjs - the quota reading costs nothing now (sun-9 d),
// and every ledgered run says how many CFBD calls it made. Stub sql, stub fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.CFBD_API_KEY = process.env.CFBD_API_KEY || 'test-key';
const { recordRun, probeCfbdBudget, BUDGET_PROBE_INTERVAL_MIN } = await import('./runRecorder.js');
const { cfbdGet, _resetCfbdProcessStats } = await import('../cfbd/client.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; _resetCfbdProcessStats(); });

/** A tagged-template stand-in that records statements and answers by pattern. */
function stubSql(answers = {}) {
  const seen = [];
  const fn = async (strings, ...vals) => {
    const text = strings.join('?');
    seen.push({ text, vals });
    if (/INSERT INTO sync_runs/.test(text)) return [{ id: 7 }];
    if (/FROM sync_runs/.test(text)) return answers.recent ?? [];
    return [];
  };
  fn.seen = seen;
  return fn;
}
const calls = (urls) => async (u) => { urls.push(String(u)); return new Response('[]', { status: 200, headers: { 'x-calllimit-remaining': '68000' } }); };

test('a run that called CFBD records its calls and its quota - and probes nothing', async () => {
  const urls = []; globalThis.fetch = calls(urls);
  const sql = stubSql();
  const res = await recordRun(sql, {
    source: 'cfb-games', kind: 'live-poll', log: () => {}, budget: probeCfbdBudget,
    run: async () => { await cfbdGet('/games?year=2026&seasonType=regular&week=5'); return { ingested: 1, timings_ms: { cfbdRegular: 5 } }; },
  });
  assert.equal(res.ok, true);
  assert.equal(urls.length, 1, 'no /conferences call');
  assert.equal(res.summary.cfbdCalls, 1);
  assert.deepEqual(res.summary.cfbdByEndpoint, { '/games': 1 });
  assert.equal(res.summary.budget.cfbd_calllimit_remaining, 68000);
  assert.equal(res.summary.budget.from, 'run');
  assert.equal(typeof res.summary.timings_ms.budgetProbe, 'number');
  assert.equal(res.summary.timings_ms.cfbdRegular, 5, 'the run\'s own timings survive');
  const written = JSON.parse(sql.seen.find((s) => /UPDATE sync_runs SET finished_at = now\(\), ok = true/.test(s.text)).vals[0]);
  assert.equal(written.cfbdCalls, 1, 'the call count is on the ledger row');
});

test('no CFBD call this run: a fresh process reading, then a fresh DB reading, then (hourly) one probe', async () => {
  const urls = []; globalThis.fetch = calls(urls);
  // Nothing anywhere: one probe.
  const probed = await probeCfbdBudget({ sql: stubSql({ recent: [] }) });
  assert.equal(urls.length, 1); assert.match(urls[0], /\/conferences$/);
  assert.equal(probed.from, 'probe');
  // Now the process holds a reading under an hour old: no call.
  const again = await probeCfbdBudget({ sql: stubSql() });
  assert.equal(urls.length, 1); assert.equal(again.from, 'process');
  // An hour on, process reading stale, but a row within the hour has one: no call.
  const later = new Date(Date.now() + (BUDGET_PROBE_INTERVAL_MIN + 1) * 60_000);
  const skipped = await probeCfbdBudget({ sql: stubSql({ recent: [{ started_at: later }] }), now: later });
  assert.equal(urls.length, 1); assert.equal(skipped.skipped, 'reading within the hour');
});

test('a run with no CFBD calls carries no cfbdCalls key', async () => {
  const res = await recordRun(stubSql(), { source: 'x', kind: 'y', log: () => {}, run: async () => ({ a: 1 }) });
  assert.deepEqual(res.summary, { a: 1 });
});

test('no route still spends a call per tick on the dedicated probe', () => {
  const src = readFileSync(new URL('./runRecorder.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function probeCfbdBudget'));
  // The probe is the LAST resort, after the run, process and ledger readings.
  assert.ok(fn.indexOf('ledger?.quota') < fn.indexOf("'/conferences'"));
  assert.ok(fn.indexOf('cfbdProcessStats()') < fn.indexOf("'/conferences'"));
  assert.ok(fn.indexOf('FROM sync_runs') < fn.indexOf("'/conferences'"));
});
