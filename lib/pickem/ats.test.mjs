// lib/pickem/ats.test.mjs - AGAINST THE SPREAD (S3): the cover, the push, the
// no-line game, the line frozen at week open, and the league's score and record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  atsOutcome, atsResults, atsMax, atsScore, atsRecord, spreadFor, freezeSpreads, cleanSpread, atsSport,
} from './ats.js';
import { pickemLeagueScore, recordLine, eligibleFormats, PICK_FORMATS } from '../leagues/pickFormat.js';
import { shapeResults } from '../leagues/results.js';

test('the cover: home -3.5 wins by 7 -> home; wins by 3 -> away covers', () => {
  assert.equal(atsOutcome(-3.5, 27, 20), 'home');
  assert.equal(atsOutcome(-3.5, 23, 20), 'away');
  assert.equal(atsOutcome(3, 17, 20), 'push', 'home +3 loses by exactly 3');
  assert.equal(atsOutcome(3.5, 17, 20), 'home', 'home +3.5 loses by 3 and covers');
});

test('a PUSH is void: exact margin, and a pick-em line that ends level', () => {
  assert.equal(atsOutcome(-7, 27, 20), 'push');
  assert.equal(atsOutcome(0, 24, 24), 'push');
  assert.equal(atsOutcome(0, 24, 21), 'home');
});

test('NO LINE (or no score) is null: void for ATS', () => {
  assert.equal(atsOutcome(null, 27, 20), null);
  assert.equal(atsOutcome(undefined, 27, 20), null);
  assert.equal(atsOutcome('', 27, 20), null);
  assert.equal(atsOutcome(-3, null, 20), null);
  assert.equal(cleanSpread(0), 0, '0 is a real line, not a missing one');
});

const board = [
  { match_id: 1, spread_home: -3.5 },
  { match_id: 2, spread_home: 7 },
  { match_id: 3, spread_home: null },
  { match_id: 4, spread_home: -6 },
  { match_id: 5, spread_home: -2.5 },
];
const fin = (h, a) => ({ status: 'final', home_score: h, away_score: a });
const byId = new Map([[1, fin(30, 20)], [2, fin(10, 17)], [3, fin(30, 3)], [4, fin(26, 20)], [5, { status: 'scheduled' }]]);

test('atsResults: cover, push, no-line, not-final all grade per game; max counts only real covers', () => {
  const r = atsResults(board, byId);
  assert.deepEqual(r, { 1: 'home', 2: 'push', 3: null, 4: 'push', 5: null });
  assert.equal(atsMax(r), 1, 'the push, the no-line game and the unplayed game are not in the max');
});

test('a game void nationally is void for ATS too', () => {
  assert.equal(atsResults(board, byId, { voids: [1] })[1], null);
});

test('score and record: a push is P, not W or L; no-line picks are nothing', () => {
  const r = atsResults(board, byId);
  const lineup = { 1: 'home', 2: 'home', 3: 'away', 4: 'away', 5: 'home' };
  assert.equal(atsScore(lineup, r), 1);
  assert.deepEqual(atsRecord(lineup, r), { w: 1, l: 0, p: 2 });
  assert.deepEqual(atsRecord({ 1: 'away' }, r), { w: 0, l: 1, p: 0 });
  assert.equal(recordLine({ w: 1, l: 0, p: 2 }), '1-0-2');
  assert.equal(recordLine({ w: 11, l: 2 }), '11-2', 'a regular record has no P');
});

test('LINE MOVES AFTER THE FREEZE change nothing: the board snapshot is the only line read', () => {
  const spreads = new Map([[1, -3.5], [2, 7]]);
  const frozen = freezeSpreads([{ match_id: 1 }, { match_id: 2 }, { match_id: 3 }], spreads);
  assert.deepEqual(frozen.map((g) => g.spread_home), [-3.5, 7, null]);
  spreads.set(1, -10);                                   // the market moves after week open
  assert.equal(frozen[0].spread_home, -3.5, 'the snapshot is a copy, not a view of the live map');
  const r = atsResults(frozen, new Map([[1, fin(30, 20)]]));
  assert.equal(r[1], 'home', 'graded on -3.5, not on the moved -10');
  const src = readFileSync(new URL('./ats.js', import.meta.url), 'utf8');
  assert.ok(!/^import /m.test(src), 'grading imports nothing - no live-odds reader');
});

test('the display: -3.5 / +3.5 / PK, and nothing with no line', () => {
  assert.equal(spreadFor(-3.5, 'home'), '−3.5');
  assert.equal(spreadFor(-3.5, 'away'), '+3.5');
  assert.equal(spreadFor(0, 'home'), 'PK');
  assert.equal(spreadFor(null, 'home'), '');
});

test('football only: NFL and CFB are ATS sports, the rest are not', () => {
  for (const s of ['nfl', 'cfb']) assert.equal(atsSport(s), true);
  for (const s of ['nba', 'mlb', 'epl', null]) assert.equal(atsSport(s), false);
  assert.deepEqual(eligibleFormats(['nfl', 'cfb']), [...PICK_FORMATS]);
  assert.deepEqual(eligibleFormats(['nba']), ['regular', 'confidence']);
});

test('pickemLeagueScore(ats): the covers from perfect.ats; a board with none is not a result', () => {
  const lineup = { 1: 'home', 2: 'home', 4: 'away' };
  const ats = atsResults(board, byId);
  assert.equal(pickemLeagueScore('ats', { settled: true, lineup, ats }), 1);
  assert.equal(pickemLeagueScore('ats', { settled: false, lineup, ats }), null);
  assert.equal(pickemLeagueScore('ats', { settled: true, lineup, ats: null }), null, 'settled before S3: no ATS result');
});

test('shapeResults: an ATS league scores the frozen lines and carries W-L-P', () => {
  const ats = atsResults(board, byId);
  const row = { game: 'pickem', sport: 'nfl', season_year: 2026, week: 7, pd: null, locks_at: '2026-10-23T00:15:00Z', settled: true, user_id: 1,
    score: 2, conf: false, pk_lineup: { 1: 'home', 2: 'home', 3: 'away', 4: 'away' }, pk_results: { 1: 'home', 2: 'away', 3: 'home', 4: 'home' }, pk_ats: ats, submitted_at: null };
  const [r] = shapeResults({ contestRows: [row], unit: 'week', league: { pick_format: 'ats' } }).results;
  assert.equal(r.score, 1);
  assert.deepEqual(r.record, { w: 1, l: 0, p: 2 }, 'games 2 and 4 pushed; game 3 has no line and is nothing');
  const [reg] = shapeResults({ contestRows: [row], unit: 'week', league: { pick_format: 'regular' } }).results;
  assert.equal(reg.score, 2, 'the same board under a regular league is untouched');
});

test('wiring: the board freezes at creation, settle stores perfect.ats, the league reads it', () => {
  const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const create = rd('./create.js');
  assert.ok(create.indexOf('freezeSpreads(') < create.indexOf('INSERT INTO contests'), 'frozen before the INSERT');
  assert.match(create, /atsSport\(plan\.sport\)/);
  assert.match(rd('./settle.js'), /ats: \{ results: ats, max: atsMax\(ats\) \}/);
  assert.match(rd('../leagues/results.js'), /perfect->'ats'->'results' END AS pk_ats/);
  assert.match(rd('../games/leaderboard.js'), /perfect->'ats'->'results' AS ats/);
});
