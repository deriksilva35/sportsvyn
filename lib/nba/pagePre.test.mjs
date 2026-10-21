// lib/nba/pagePre.test.mjs - the NBA page's pre-game shaping, pure (thu1-nba-page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickOdds, standingRecord, injuryNote, shapeInjuries, updatedLabel, startersOf, lineupsBlock,
  seasonLeaders, finalFromGame, last5, seriesLine, latestGameId,
} from './pagePre.js';

test('odds: draftkings if it has a spread, else the first row that has one; the total rides along; nothing, null', () => {
  const rows = [
    { vendor: 'betmgm', spread_home_value: '-3.0', total_value: '230.5' },
    { vendor: 'draftkings', spread_home_value: '-2.5', total_value: '233.5' },
  ];
  assert.deepEqual(pickOdds(rows), { spreadHome: -2.5, total: 233.5 });
  assert.deepEqual(pickOdds([{ vendor: 'draftkings', spread_home_value: null, total_value: null }, rows[0]]), { spreadHome: -3, total: 230.5 });
  assert.deepEqual(pickOdds([{ vendor: 'x', spread_home_value: null, total_value: '220' }]), { spreadHome: null, total: 220 });
  assert.equal(pickOdds([]), null);
  assert.equal(pickOdds(null), null);
  assert.equal(pickOdds([{ vendor: 'x', spread_home_value: 'abc', total_value: '0' }]), null, '0 is not a total anybody set');
});

test('standings record only with games played', () => {
  const rows = [{ team: { id: 2 }, wins: 1, losses: 0 }, { team: { id: 9 }, wins: 0, losses: 0 }];
  assert.equal(standingRecord(rows, 2), '1-0');
  assert.equal(standingRecord(rows, '9'), null);
  assert.equal(standingRecord(rows, 5), null);
});

test('the injury note is the short part of the description', () => {
  assert.equal(injuryNote('Injury/Illness - Right Knee Surgery (2026-10-21, DAL@HOU). Prior reporting says he will miss time.'), 'Right Knee Surgery');
  assert.equal(injuryNote('Injury/Illness - Left Ankle Sprain'), 'Left Ankle Sprain');
  const prose = 'Carter has been diagnosed with mononucleosis and is without a timetable for a return, Gary Washburn of The Boston Globe reports. More.';
  const n = injuryNote(prose);
  assert.ok(n.length <= 80 && n.endsWith('…') && n.startsWith('Carter has been diagnosed'), n);
  assert.equal(injuryNote('J. Smith is out with a sore hamstring. More text.'), 'J. Smith is out with a sore hamstring');
  assert.equal(injuryNote(''), null);
  assert.equal(injuryNote(null), null);
});

test('injuries: per side, worst first, unknown statuses dropped, null when nobody', () => {
  const p = (id, first, team, status, description) => ({ player: { id, first_name: first, last_name: 'X', team_id: team }, status, description });
  const sideOf = (id) => ({ 2: 'away', 9: 'home' })[id] ?? null;
  const out = shapeInjuries([
    p(1, 'Aaa', 2, 'Probable', 'Injury/Illness - Back (2026-10-21)'),
    p(2, 'Bbb', 2, 'Out', 'Injury/Illness - Knee (2026-10-21)'),
    p(3, 'Ccc', 9, 'Day-To-Day', 'Hand'),
    p(4, 'Ddd', 9, 'Mystery', 'x'),
    p(5, 'Eee', 77, 'Out', 'x'),
    p(2, 'Bbb', 2, 'Out', 'duplicate'),
  ], sideOf);
  assert.deepEqual(out.away.map((e) => [e.name, e.status, e.note]), [['Bbb X', 'Out', 'Knee'], ['Aaa X', 'Probable', 'Back']]);
  assert.deepEqual(out.home.map((e) => [e.name, e.status]), [['Ccc X', 'Day-to-day']]);
  assert.equal(shapeInjuries([], sideOf), null);
  assert.equal(shapeInjuries(null, sideOf), null);
});

test('"updated <time PT>" is the time we fetched it', () => {
  assert.equal(updatedLabel(new Date('2026-10-21T22:36:30Z')), 'updated 3:36 PM PT');
  assert.equal(updatedLabel(new Date('2026-10-22T01:05:00Z')), 'updated 6:05 PM PT');
  assert.equal(updatedLabel('nope'), null);
});

const L = (team, id, name, pos, starter = true) => ({ starter, position: pos, player: { id, first_name: name, last_name: 'Q', position: pos }, team: { id: team } });
test('lineups: starters guards-first, five at most; Confirmed only when both sides are out, else Projected from last time', () => {
  const now = [L(2, 1, 'C1', 'C'), L(2, 2, 'G1', 'G'), L(2, 3, 'F1', 'F'), L(2, 4, 'Bench', 'G', false), L(9, 5, 'G2', 'G')];
  assert.deepEqual(startersOf(now, 2).map((s) => s.pos), ['G', 'F', 'C']);
  assert.equal(startersOf(now, 2).some((s) => s.name === 'Bench Q'), false);
  const prior = { away: [L(2, 7, 'Old', 'G')], home: [L(9, 8, 'Old2', 'F')] };
  const mixed = lineupsBlock({ thisGame: now, prior, awayBdl: 2, homeBdl: 9 });
  assert.equal(mixed.label, 'Confirmed');
  assert.deepEqual(mixed.home.map((s) => s.name), ['G2 Q']);
  const oneSide = lineupsBlock({ thisGame: [L(2, 1, 'C1', 'C')], prior, awayBdl: 2, homeBdl: 9 });
  assert.equal(oneSide.label, 'Projected', 'half a lineup is not a confirmed one');
  assert.deepEqual(oneSide.away.map((s) => s.name), ['Old Q']);
  assert.equal(lineupsBlock({ thisGame: [], prior: { away: [], home: [] }, awayBdl: 2, homeBdl: 9 }), null);
  assert.equal(lineupsBlock({ thisGame: [], prior: null, awayBdl: 2, homeBdl: 9 }), null);
});

test('season leaders: top three per team per game, gp >= 1, categories nobody has are dropped', () => {
  const a = (id, last, gp, pts, reb, ast, fg3m) => ({ player: { id, first_name: 'P', last_name: last }, stats: { gp, pts, reb, ast, fg3m } });
  const rows = [a(1, 'One', 3, 27.43, 8, 2, 3.1), a(2, 'Two', 3, 22, 10.2, 5, 0), a(3, 'Three', 2, 18, 1, 9.5, 1), a(4, 'Four', 3, 12, 0, 1, 0),
    a(5, 'NoGames', 0, 40, 10, 10, 5), a(6, 'Other', 1, 30, 2, 2, 2), a(7, 'Stranger', 3, 50, 5, 5, 5)];
  const side = new Map([[1, 'away'], [2, 'away'], [3, 'away'], [4, 'away'], [5, 'away'], [6, 'home']]);
  const out = seasonLeaders(rows, (id) => side.get(id) ?? null);
  assert.deepEqual(out.map((r) => r.cat), ['PTS', 'REB', 'AST', '3PM']);
  assert.deepEqual(out[0].away, [{ name: 'One', line: '27.4' }, { name: 'Two', line: '22.0' }, { name: 'Three', line: '18.0' }], 'three deep; gp 0 and strangers excluded');
  assert.deepEqual(out[0].home, [{ name: 'Other', line: '30.0' }]);
  assert.deepEqual(out[3].away.map((p) => p.name), ['One', 'Three'], 'a zero is not a leader');
  assert.equal(seasonLeaders([], () => 'away'), null);
  assert.equal(seasonLeaders([a(5, 'NoGames', 0, 40, 10, 10, 5)], () => 'away'), null);
});

const F = (key, at, home, away, hs, as) => ({ key, bdlGameId: key, at, homeBdl: String(home), awayBdl: String(away), homeAbbr: `T${home}`, awayAbbr: `T${away}`, homeScore: hs, awayScore: as });
const FINALS = [
  F('g1', '2026-10-20T19:00:00Z', 9, 2, 121, 113),
  F('g2', '2026-10-18T19:00:00Z', 2, 9, 110, 100),
  F('g3', '2026-10-15T19:00:00Z', 9, 2, 99, 101),
  F('g4', '2026-10-14T19:00:00Z', 2, 5, 90, 95),
  F('g5', '2026-10-12T19:00:00Z', 7, 9, 100, 80),
  F('g6', '2026-10-10T19:00:00Z', 9, 6, 100, 80),
  F('g7', '2026-10-08T19:00:00Z', 9, 6, 100, 80),
];
test('last 5: newest first, own score first, W/L, at most five; none played, null', () => {
  const l = last5(FINALS, 9);
  assert.equal(l.length, 5);
  assert.deepEqual(l[0], { win: true, score: '121-113', opp: 'vs T2' });
  assert.deepEqual(l[1], { win: false, score: '100-110', opp: '@ T2' });
  assert.deepEqual(l[3], { win: false, score: '80-100', opp: '@ T7' });
  assert.deepEqual(last5(FINALS, 2).slice(0, 2), [{ win: false, score: '113-121', opp: '@ T9' }, { win: true, score: '110-100', opp: 'vs T9' }]);
  assert.equal(last5(FINALS, 42), null);
  assert.equal(last5([], 9), null);
});

test('series line: who leads, tied, or nothing if they have not met', () => {
  const ctx = { awayBdl: 2, homeBdl: 9, awayAbbr: 'BOS', homeAbbr: 'DET' };
  // BOS lost g1, won g2 (110-100 at home) and g3 (101 away at DET)
  assert.equal(seriesLine(FINALS, ctx), 'BOS leads series 2-1');
  assert.equal(seriesLine(FINALS.filter((f) => f.key !== 'g3'), ctx), 'Series tied 1-1');
  assert.equal(seriesLine(FINALS.filter((f) => f.key === 'g1'), ctx), 'DET leads series 1-0');
  assert.equal(seriesLine(FINALS, { ...ctx, awayBdl: 5 }), null, 'T5 played T2 only');
  assert.equal(seriesLine([], ctx), null);
});

test('latest completed game id, and a feed game row only counts when final', () => {
  assert.equal(latestGameId(FINALS, 9), 'g1');
  assert.equal(latestGameId([], 9), null);
  const row = { id: 5, status: 'Final', status_state: 'final', datetime: '2026-10-20T19:00:00.000Z', home_team_score: 121, visitor_team_score: 113, home_team: { id: 9, abbreviation: 'DET' }, visitor_team: { id: 2, abbreviation: 'BOS' } };
  assert.deepEqual(finalFromGame(row), { key: '5', bdlGameId: '5', at: '2026-10-20T19:00:00.000Z', homeBdl: '9', awayBdl: '2', homeAbbr: 'DET', awayAbbr: 'BOS', homeScore: 121, awayScore: 113 });
  assert.equal(finalFromGame({ ...row, status_state: 'scheduled', status: '2026-10-23T23:00:00Z' }), null);
  assert.equal(finalFromGame({ ...row, postponed: true }), null);
});
