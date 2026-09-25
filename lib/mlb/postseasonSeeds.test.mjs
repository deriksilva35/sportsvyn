// lib/mlb/postseasonSeeds.test.mjs - the postseason round from our own
// bracket: the seeds, and who is playing whom (stagesBySeeds). Backtested on
// the whole 2025 postseason: fixtures/postseason2025.json is the DEV rows with
// the rounds the finished-bracket walk gave them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stageFromSeeds, stagesBySeeds, stagesByBacktrack } from './postseason.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/postseason2025.json', import.meta.url), 'utf8'));
// 2025's seeds, as BDL's /mlb/v1/standings?season=2025 gives playoff_seed
// (read 25 Sep 2026). DEV holds no team_records, which is why they are here.
const SEEDS_2025 = new Map(Object.entries({
  TOR: 1, SEA: 2, CLE: 3, NYY: 4, BOS: 5, DET: 6,        // American
  MIL: 1, PHI: 2, LAD: 3, CHC: 4, SD: 5, CIN: 6,         // National
}));

function groupsOf(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = [r.away_abbr, r.home_abbr].sort().join('-');
    if (!by.has(key)) by.set(key, { key, teams: [{ id: r.away_abbr, league: r.away_league }, { id: r.home_abbr, league: r.home_league }], rows: [], firstDate: r.kickoff_at });
    by.get(key).rows.push(r);
  }
  return [...by.values()];
}

test('BACKTEST 2025: every one of the 47 postseason games lands in its real round', () => {
  assert.equal(FIX.length, 47);
  const groups = groupsOf(FIX);
  const { stages, unplaced } = stagesBySeeds(groups, SEEDS_2025);
  assert.deepEqual(unplaced, []);
  const wrong = [];
  for (const g of groups) for (const r of g.rows) if (stages.get(g.key) !== r.stage) wrong.push(`${r.slug}: ${r.stage} vs ${stages.get(g.key)}`);
  assert.deepEqual(wrong, []);
  const count = (st) => FIX.filter((r) => stages.get([r.away_abbr, r.home_abbr].sort().join('-')) === st).length;
  assert.deepEqual([count('wild_card'), count('division'), count('championship'), count('world_series')], [11, 18, 11, 7]);
});

test('and it agrees with the finished-bracket walk, series for series', () => {
  const groups = groupsOf(FIX);
  const walk = stagesByBacktrack(groups);
  const { stages } = stagesBySeeds(groups, SEEDS_2025);
  for (const g of groups) assert.equal(stages.get(g.key), walk.get(g.key), g.key);
});

test('WHILE IT IS BEING PLAYED: the Wild Card alone, then with the Division Series, are staged - the walk refuses both', () => {
  const byStage = (st) => FIX.filter((r) => r.stage === st);
  const wcOnly = groupsOf(byStage('wild_card'));
  assert.equal(stagesByBacktrack(wcOnly), null, 'the walk needs a finished bracket');
  const a = stagesBySeeds(wcOnly, SEEDS_2025);
  assert.equal(a.stages.size, 4); assert.ok([...a.stages.values()].every((s) => s === 'wild_card'));
  const upToDs = groupsOf([...byStage('wild_card'), ...byStage('division')]);
  const b = stagesBySeeds(upToDs, SEEDS_2025);
  assert.deepEqual([...b.stages.values()].sort(), [...Array(4).fill('division'), ...Array(4).fill('wild_card')]);
});

test('every pairing the format allows, and nothing else', () => {
  for (const [a, b] of [[3, 6], [4, 5], [6, 3]]) assert.equal(stageFromSeeds(a, b), 'wild_card', `${a}v${b}`);
  for (const [a, b] of [[1, 4], [1, 5], [2, 3], [2, 6]]) assert.equal(stageFromSeeds(a, b), 'division', `${a}v${b}`);
  for (const a of [1, 4, 5]) for (const b of [2, 3, 6]) assert.equal(stageFromSeeds(a, b), 'championship', `${a}v${b}`);
  assert.equal(stageFromSeeds(1, 1, { crossLeague: true }), 'world_series');
  assert.equal(stageFromSeeds(3, 6, { crossLeague: true }), 'world_series', 'the leagues meeting outranks the seeds');
  assert.equal(stageFromSeeds(1, 7), null, 'an unseeded club is not placed');
  assert.equal(stageFromSeeds(null, 2), null);
  assert.equal(stageFromSeeds(2, 2), null);
});

test('REFUSES what does not fit: an unseeded club, and a round with more series than the format', () => {
  const g = (key, a, b, league = 'American') => ({ key, teams: [{ id: a, league }, { id: b, league }] });
  const seeds = new Map([['A3', 3], ['A6', 6], ['A4', 4], ['A5', 5], ['X', 9]]);
  const r1 = stagesBySeeds([g('A3-X', 'A3', 'X')], seeds);
  assert.equal(r1.stages.size, 0); assert.equal(r1.unplaced[0].key, 'A3-X');
  // A club in two Wild Card series is a bracket we do not understand.
  const r2 = stagesBySeeds([g('A3-A6', 'A3', 'A6'), g('A3-A6b', 'A6', 'A3')], seeds);
  assert.equal(r2.stages.size, 0); assert.equal(r2.unplaced.length, 2);
});

test('the postseason import offers --bdl and stages from the seeds', () => {
  const src = readFileSync(new URL('../../scripts/mlb-postseason-import.mjs', import.meta.url), 'utf8');
  assert.match(src, /const BYSEEDS = !BACKTRACK && !BYSTATSAPI;/, 'the seeds are the default');
  assert.match(src, /BYSEEDS \? await stagesFromSeeds\(rows, season\)/);
  assert.match(src, /stagesBySeeds\(groups, seedOf\)/);
});
