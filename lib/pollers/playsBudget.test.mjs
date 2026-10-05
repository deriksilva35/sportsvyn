// lib/pollers/playsBudget.test.mjs - plays-live stops cleanly before 60 s (sun-12).
// Fake clock: work() advances it, nothing sleeps. No database, no network.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.CFBD_API_KEY = process.env.CFBD_API_KEY || 'test-key';
const { PLAYS_BUDGET, drainWithBudget, dueByState } = await import('./playsCadence.js');
const { cfbdFetch, budgetedTimeout, CFBD_TIMEOUT_MS } = await import('../cfbd/client.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('the budget: no new game after 45 s, every call ends by 55 s, 5 s left to close the row', () => {
  assert.deepEqual({ ...PLAYS_BUDGET }, { startCutoffMs: 45_000, hardStopMs: 55_000 });
  // The worst case the old code allowed: a 25 s call started at 44.9 s.
  assert.ok(PLAYS_BUDGET.startCutoffMs + CFBD_TIMEOUT_MS > 60_000, 'why the per-call bound is needed');
  assert.equal(budgetedTimeout(CFBD_TIMEOUT_MS, 55_000, 44_900), 10_100, 'a call at 44.9 s gets ~10 s, not 25');
  assert.equal(budgetedTimeout(CFBD_TIMEOUT_MS, 55_000, 10_000), 25_000, 'early calls keep the full 25 s');
  assert.equal(budgetedTimeout(CFBD_TIMEOUT_MS, null, 0), 25_000, 'no deadline, no change');
});

test('a slow Saturday: 11 due, 3 at a time, 6 s each from 20 s in - starts stop at 45 s, the rest are skipped', async () => {
  const c = fakeClock(); const startedAt = c.now();
  c.advance(20_000);                                   // scope + lock + ledger insert took 20 s
  const due = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, slug: `g${i + 1}` }));
  const seen = [];
  const r = await drainWithBudget(due, {
    pool: 3, startedAt, clock: c.now,
    work: async (g, { deadlineAt }) => { seen.push({ id: g.id, at: c.now() - startedAt, deadlineAt }); await null; c.advance(6_000); },
  });
  assert.ok(seen.every((s) => s.at < PLAYS_BUDGET.startCutoffMs), 'nothing started at or past 45 s');
  assert.ok(seen.every((s) => s.deadlineAt === startedAt + PLAYS_BUDGET.hardStopMs), 'every call gets the hard stop');
  assert.equal(r.started.length + r.skipped.length, 11, 'every due game is either started or counted');
  assert.ok(r.skipped.length > 0, 'some were skipped for budget');
  assert.deepEqual(r.started.map((g) => g.id), due.slice(0, r.started.length).map((g) => g.id), 'in priority order');
});

test('flag off (pool 1) honours the same cutoff', async () => {
  const c = fakeClock(); const startedAt = c.now();
  const r = await drainWithBudget([{ id: 1 }, { id: 2 }, { id: 3 }], {
    pool: 1, startedAt, clock: c.now, work: async () => { c.advance(30_000); },
  });
  assert.deepEqual(r.started.map((g) => g.id), [1, 2], 'started at 0 s and 30 s; 60 s is past 45');
  assert.deepEqual(r.skipped.map((g) => g.id), [3]);
});

test('skipped games are served first next tick: oldest-due first', () => {
  const NOW = new Date('2026-10-03T20:00:00Z');
  const ago = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
  const games = [
    { id: 1, league: 'cfb', on_board: true, plays_poll: { status: 'In Progress', at: ago(95) } },   // 5 s overdue
    { id: 2, league: 'cfb', on_board: true, plays_poll: { status: 'In Progress', at: ago(250) } },  // skipped last tick: 160 s overdue
    { id: 3, league: 'cfb', on_board: false, plays_poll: null },                                    // never polled
    { id: 4, league: 'cfb', on_board: false, plays_poll: { status: 'In Progress', at: ago(400) } }, // 100 s overdue
  ];
  assert.deepEqual(dueByState(games, new Map(), NOW).map((g) => g.id), [3, 2, 4, 1]);
});

test('the CFBD door refuses a call with no budget left, and shrinks the timeout to what is left', async () => {
  let calls = 0; let signal;
  globalThis.fetch = async (u, init) => { calls += 1; signal = init.signal; return new Response('[]', { status: 200 }); };
  await assert.rejects(cfbdFetch('/live/plays?gameId=1', { deadlineAt: Date.now() - 1 }), /CFBD budget exhausted/);
  assert.equal(calls, 0, 'nothing sent');
  await cfbdFetch('/live/plays?gameId=1', { deadlineAt: Date.now() + 5_000 });
  assert.equal(calls, 1); assert.ok(signal instanceof AbortSignal);
});

test('a 429 retry that would cross the deadline is not taken', async () => {
  let calls = 0; const waits = [];
  globalThis.fetch = async () => { calls += 1; return new Response('busy', { status: 429 }); };
  const res = await cfbdFetch('/live/plays?gameId=1', {
    retry429: 2, deadlineAt: Date.now() + 1_500, wait: async (ms) => { waits.push(ms); },
  });
  assert.equal(res.status, 429); assert.equal(calls, 1); assert.deepEqual(waits, []);
});

test('the route: budget from the handler\'s first line, both paths drained under it, the count on the row', () => {
  const R = readFileSync(new URL('../../app/api/cron/plays-live/route.js', import.meta.url), 'utf8');
  const code = R.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const get = code.slice(code.indexOf('export async function GET'));
  assert.ok(get.indexOf('const handlerStart = Date.now();') < get.indexOf('await liveBoardGames()'), 'the clock starts before any query');
  assert.match(code, /drainWithBudget\(due, \{\s*pool: all \? POOL : 1,\s*startedAt: handlerStart,/);
  assert.match(code, /importPlaysFor\(g\.id, undefined, \{ deadlineAt: g\.deadlineAt \}\)/, 'every provider call carries the hard stop');
  assert.match(code, /skippedForBudget, skipped_slugs:/);
  assert.match(code, /closeAbandonedRuns\(sql, SOURCE\)/, 'a killed run\'s row is closed by the next');
  assert.doesNotMatch(code, /DEADLINE_MS/, 'the old pool-relative deadline is gone');
});
