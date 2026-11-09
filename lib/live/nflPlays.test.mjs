// lib/live/nflPlays.test.mjs - NFL plays every 30 s from the live poller (drive-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNflPlays, TICK_SLACK_MS } from './nflPlays.js';
import { PLAYS_CADENCE, dueByState, playsIntervalFor } from '../pollers/playsCadence.js';

const NOW = new Date('2026-11-08T21:00:00Z');
const ago = (s) => new Date(NOW.getTime() - s * 1000);
const game = (id) => ({ id, slug: `g${id}`, league: 'nfl', on_board: false, plays_poll: null });
const deferred = () => { let res; const p = new Promise((r) => { res = r; }); return { p, res }; };

test('the NFL interval is 30 s for the poller and 180 s for the cron backstop; CFB is unchanged', () => {
  assert.equal(playsIntervalFor(game(1)), 30);
  assert.equal(playsIntervalFor(game(1), { ...PLAYS_CADENCE, nflSec: PLAYS_CADENCE.nflBackstopSec }), 180);
  assert.equal(playsIntervalFor({ league: 'cfb', on_board: true }), 90);
  assert.equal(playsIntervalFor({ league: 'cfb', on_board: false }), 300);
});

test('one poller tick later (29 s) is still due; a healthy poller keeps the cron backstop silent', () => {
  const last = new Map([[1, ago(29)]]);
  assert.equal(dueByState([game(1)], last, new Date(NOW.getTime() + TICK_SLACK_MS)).length, 1, 'slack: a tick a few seconds short of 30 s still polls');
  assert.equal(dueByState([game(1)], new Map([[1, ago(20)]]), new Date(NOW.getTime() + TICK_SLACK_MS)).length, 0, '20 s ago + 5 s slack: not yet');
  const cron = { ...PLAYS_CADENCE, nflSec: PLAYS_CADENCE.nflBackstopSec };
  assert.equal(dueByState([game(1)], new Map([[1, ago(60)]]), NOW, cron).length, 0, 'poller wrote 60 s ago: the cron stands back');
  assert.equal(dueByState([game(1)], new Map([[1, ago(200)]]), NOW, cron).length, 1, 'poller down for 200 s: the cron reads it');
});

test('tick starts due games, never two imports for one game, and respects the pool', async () => {
  const gates = new Map();
  const calls = [];
  const written = new Map();
  const t = createNflPlays({
    importFn: (id) => { calls.push(id); gates.set(id, deferred()); return gates.get(id).p.then(() => { written.set(id, NOW); return { pages: 2 }; }); },
    listFn: async () => [game(1), game(2), game(3), game(4)],
    lastFn: async () => written,
    pool: 3,
  });
  const a = await t.tick(NOW);
  assert.deepEqual(calls, [1, 2, 3], 'pool of three'); assert.equal(a.started, 3);
  const b = await t.tick(NOW);
  assert.equal(b.started, 0, 'all three still in flight; the fourth waits for room');
  gates.get(1).res(); await new Promise((r) => setImmediate(r));
  const c = await t.tick(NOW);
  assert.equal(c.started, 1);
  assert.deepEqual(calls, [1, 2, 3, 4], 'a freed slot goes to the next due game, not back to the one just written');
  for (const g of gates.values()) g.res(); await t.idle();
  const d = t.drain();
  assert.equal(d.failed, 0); assert.ok(d.imported >= 3); assert.ok(d.calls >= 6);
});

test('a failing import is caught, counted and logged - the tick never throws', async () => {
  const logs = [];
  const t = createNflPlays({
    importFn: async () => { throw new Error('BDL 500 on /nfl/v1/plays'); },
    listFn: async () => [game(1)], lastFn: async () => new Map(), log: (m) => logs.push(m),
  });
  const r = await t.tick(NOW); await t.idle();
  assert.equal(r.started, 1);
  assert.deepEqual([t.drain().failed], [1]);
  assert.match(logs[0], /plays import failed match=1: BDL 500/);
  // and a failing LIST (the database) does not throw either
  const t2 = createNflPlays({ importFn: async () => ({}), listFn: async () => { throw new Error('db down'); }, lastFn: async () => new Map(), log: () => {} });
  assert.equal((await t2.tick(NOW)).error, true);
  assert.equal(t2.drain().failed, 1);
});

test('wiring: the poller starts it un-awaited, the cron keeps a backstop only, memory stays small', () => {
  const idx = readFileSync(new URL('../../services/live-poller/index.mjs', import.meta.url), 'utf8');
  assert.match(idx, /importFn: \(id\) => importPlaysFor\(id\)/);
  assert.match(idx, /await nflPlays\.tick\(now\);/, 'tick returns at once; the imports run on their own');
  assert.doesNotMatch(idx, /await importPlaysFor/, 'never inline in the score loop');
  assert.match(idx, /nflPlaysAt: nflPlays\.lastOkAt/, 'freshness rides the heartbeat');
  const lib = readFileSync(new URL('./nflPlays.js', import.meta.url), 'utf8');
  assert.match(lib, /pool = POOL/); assert.match(lib, /export const POOL = 3;/);
  const route = readFileSync(new URL('../../app/api/cron/plays-live/route.js', import.meta.url), 'utf8');
  assert.match(route, /nflSec: PLAYS_CADENCE\.nflBackstopSec/);
});
