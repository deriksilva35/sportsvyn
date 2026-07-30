// Fantasy Board aggregations. Loads .env.local (module imports db); adpMovers is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p){let t;try{t=readFileSync(p,"utf8");}catch{return;}for(const line of t.split("\n")){const s=line.trim();if(!s||s.startsWith("#"))continue;const eq=s.indexOf("=");if(eq<0)continue;const k=s.slice(0,eq).trim();let v=s.slice(eq+1).trim();if(v.startsWith(String.fromCharCode(34))&&v.endsWith(String.fromCharCode(34)))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}})(path.resolve(__dirname, '..', '..', '.env.local'));

const { adpMovers, MOVERS_POOL } = await import('./fantasyBoard.js');

test('adpMovers: rising/falling by |delta|, skips new + unchanged', () => {
  const current = [
    { ffc_player_id: '1', name: 'A', position: 'RB', adp: 10 }, // prior 15 -> +5 rising
    { ffc_player_id: '2', name: 'B', position: 'WR', adp: 20 }, // prior 18 -> -2 falling
    { ffc_player_id: '3', name: 'C', position: 'TE', adp: 30 }, // no prior -> skip
    { ffc_player_id: '4', name: 'D', position: 'QB', adp: 40 }, // prior 40 -> 0 skip
  ];
  const prior = [
    { ffc_player_id: '1', adp: 15 }, { ffc_player_id: '2', adp: 18 }, { ffc_player_id: '4', adp: 40 },
  ];
  const m = adpMovers(current, prior);
  assert.equal(m.length, 2);
  assert.equal(m[0].name, 'A'); assert.equal(m[0].delta, 5);  // biggest |delta| first
  assert.equal(m[1].name, 'B'); assert.equal(m[1].delta, -2);
});

test('MOVERS_POOL names one pool pair (movers cannot span formats)', () => {
  // sim_player_pool holds a row per player PER (scoring_format, teams_count). The
  // movers read MUST pin both axes; if this constant ever grows into a list, the
  // getAdpMovers query has to change with it.
  assert.deepEqual(MOVERS_POOL, { scoringFormat: 'ppr', teamsCount: 12 });
});

test('adpMovers: a player present once per format would double-count (regression)', () => {
  // The bug this guards: getAdpMovers used to load ALL pairs for a snapshot_date,
  // so one player arrived 4x in `current` and `prior` collapsed to whichever pair
  // sorted last — diffing a QB's 2QB ADP against his standard ADP. Real numbers
  // from Sam Darnold (ffc id 2884) on 2026-07-30. If rows are ever unscoped again,
  // the output is nonsense of exactly this shape: one name, repeated, ~-110.
  const unscopedCurrent = [
    { ffc_player_id: '2884', name: 'Sam Darnold', position: 'QB', adp: 50.9 },  // 2qb/12
    { ffc_player_id: '2884', name: 'Sam Darnold', position: 'QB', adp: 153.6 }, // half-ppr/10
    { ffc_player_id: '2884', name: 'Sam Darnold', position: 'QB', adp: 149.3 }, // ppr/12
    { ffc_player_id: '2884', name: 'Sam Darnold', position: 'QB', adp: 160.6 }, // standard/8
  ];
  const unscopedPrior = [{ ffc_player_id: '2884', adp: 163.7 }];
  const bad = adpMovers(unscopedCurrent, unscopedPrior);
  assert.equal(bad.length, 4, 'unscoped input yields one entry per format — the tell');
  assert.ok(bad.some((m) => Math.abs(m.delta) > 100), 'and an impossible delta');

  // Scoped to the one pool pair, the same player yields ONE honest mover.
  const good = adpMovers(
    [{ ffc_player_id: '2884', name: 'Sam Darnold', position: 'QB', adp: 149.3 }],
    unscopedPrior,
  );
  assert.equal(good.length, 1);
  assert.equal(good[0].delta, 14.4); // 163.7 - 149.3, rising
});
