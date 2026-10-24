// services/live-poller/cfbFallback.test.mjs - CFB live scores survive a CFBD outage (sat-1).
//
// 24 Oct 2026: CFBD /scoreboard answered 401 from 00:01Z and every live CFB game sat
// at 0-0. BDL is now primary (Derik's plan covers CFB), reshaped into CFBD rows by our
// own bridge; CFBD is the fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cfbdRowsFromBdl, cfbScoreboardWithFallback, bdlAsCfbdScoreboard, fromCfbd } from './poll.mjs';

const BDL = [
  { id: 457743, status: 'in', status_state: 'in_progress', period: 3, time: '8:50', home_score: 0, away_score: 6 },
  { id: 457745, status: 'post', status_state: 'final', period: 4, time: '0:00', home_score: 35, away_score: 13 },
  { id: 999999, status: 'in', status_state: 'in_progress', period: 1, time: '12:00', home_score: 7, away_score: 0 },
];
const BRIDGE = new Map([['457743', '401800001'], ['457745', '401800002']]);

test('BDL rows become CFBD /scoreboard rows keyed by our CFBD id; an unbridged game is dropped', () => {
  const rows = cfbdRowsFromBdl(BDL, BRIDGE);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: '401800001', status: 'in_progress', period: 3, clock: '8:50', homeTeam: { points: 0 }, awayTeam: { points: 6 } });
  assert.equal(rows[1].status, 'completed', "BDL 'final' is CFBD 'completed'");
});

test('the reshaped row normalises through fromCfbd exactly like a CFBD row', () => {
  const unmapped = [];
  const n = fromCfbd(cfbdRowsFromBdl(BDL, BRIDGE)[0], unmapped);
  assert.deepEqual(n, { providerId: '401800001', status: 'live', homeScore: 0, awayScore: 6, liveState: { period: 3, clock: '8:50' } });
  assert.equal(fromCfbd(cfbdRowsFromBdl(BDL, BRIDGE)[1], unmapped).status, 'final');
  assert.deepEqual(unmapped, []);
});

test('BDL is primary: its day rows (today and yesterday UTC) are reshaped, and the bridge sees them', async () => {
  const days = [];
  let seen = null;
  const day = (d) => async () => { days.push(d); return { rows: d === '2026-10-24' ? BDL : [], calls: 1 }; };
  const f = bdlAsCfbdScoreboard({ day, bridge: async (rows) => { seen = rows.length; return BRIDGE; } });
  const r = await f(new Date('2026-10-24T18:30:00Z'));
  assert.equal(r.source, 'bdl');
  assert.equal(r.rows.length, 2);
  assert.equal(r.calls, 2);
  assert.equal(seen, 3, 'the bridge gets every fetched row, to resolve unbridged games');
  assert.deepEqual(days.sort(), ['2026-10-23', '2026-10-24']);
});

test('the primary answering is used as is; the primary failing falls back (CFBD), one extra call', async () => {
  let fallbackCalls = 0;
  const fallback = async () => { fallbackCalls += 1; return { rows: [{ id: 'cfbd' }], calls: 1 }; };
  const ok = cfbScoreboardWithFallback({ primary: async () => ({ rows: [{ id: 1 }], calls: 2, source: 'bdl' }), fallback });
  assert.deepEqual(await ok(new Date()), { rows: [{ id: 1 }], calls: 2, source: 'bdl' });
  assert.equal(fallbackCalls, 0);
  const logs = [];
  const down = cfbScoreboardWithFallback({ primary: async () => { throw new Error('BDL 503 on /ncaaf/v1/games'); }, fallback, log: (l) => logs.push(l) });
  const r = await down(new Date());
  assert.deepEqual(r, { rows: [{ id: 'cfbd' }], calls: 2 });
  assert.match(logs[0], /primary failed \(BDL 503.*fallback rows=1/);
});

test('both down: the PRIMARY error is the one thrown', async () => {
  const f = cfbScoreboardWithFallback({
    primary: async () => { throw new Error('BDL 500'); },
    fallback: async () => { throw new Error('CFBD 401'); },
  });
  await assert.rejects(f(new Date()), /BDL 500/);
});
