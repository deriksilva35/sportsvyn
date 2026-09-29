// lib/scores/expand.test.mjs - the expanded card's shaping (scores-v4 step 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheControlFor, lineFor, gridironScoring, gridironLast, mlbScoring, mlbLast, LAST_N } from './expand.js';

const team = (id, ab) => ({ id, abbreviation: ab, name: ab });

test('the cache is the ruling: 30 s live, an hour final', () => {
  assert.match(cacheControlFor('live'), /s-maxage=30\b/);
  assert.match(cacheControlFor('final'), /s-maxage=3600\b/);
  assert.match(cacheControlFor('scheduled'), /s-maxage=300\b/);
  for (const st of ['live', 'final', 'scheduled']) assert.match(cacheControlFor(st), /^public,/);
});

test('lineFor, football: quarters reached while live, away first, the total from the score', () => {
  const g = { leagueSlug: 'nfl', status: 'live', liveState: { period: 2, clock: '4:00' }, home: team(1, 'CHI'), away: team(2, 'PHI'),
    homeScore: 7, awayScore: 3, lineScores: { home: [7, 0], away: [3, 0] } };
  assert.deepEqual(lineFor(g), { columns: ['1', '2'], rows: [
    { side: 'away', abbr: 'PHI', cells: ['3', '0'], total: 3, extra: [] },
    { side: 'home', abbr: 'CHI', cells: ['7', '0'], total: 7, extra: [] },
  ], total: 'T', extra: [] });
  assert.equal(lineFor({ ...g, lineScores: null }), null, 'no line on the row, no table');
});

test('lineFor, baseball: innings played and no further, then R H E', () => {
  const g = { leagueSlug: 'mlb', home: team(1, 'NYY'), away: team(2, 'BOS'), homeScore: 3, awayScore: 2 };
  const raw = { away: { innings: [0, 2, 0], runs: 2, hits: 5, errors: 0 }, home: { innings: [1, 2], runs: 3, hits: 6, errors: 1 } };
  const l = lineFor(g, { mlbLine: raw });
  assert.deepEqual(l.columns, ['1', '2', '3']);
  assert.deepEqual(l.rows[0], { side: 'away', abbr: 'BOS', cells: ['0', '2', '0'], total: 2, extra: [5, 0] });
  assert.deepEqual(l.rows[1].cells, ['1', '2', ''], 'the home half not batted is blank, not 0');
  assert.deepEqual([l.total, ...l.extra], ['R', 'H', 'E']);
  assert.equal(lineFor(g, { mlbLine: null }), null);
});

test('gridiron key moments: from the plays, oldest first, with the score after', () => {
  const game = { home: team(1, 'CHI'), away: team(2, 'PHI'), events: [] };
  const plays = [
    { period: 1, clock: '9:12', scoring: true, playType: 'passing touchdown', offenseTeamId: 1, text: 'Williams 12 pass to Odunze', homeScore: 7, awayScore: 0 },
    { period: 1, clock: '5:00', scoring: false, playType: 'rush', text: 'Hurts 4 yd run' },
    { period: 2, clock: '0:03', scoring: true, playType: 'field-goal-good', offenseTeamId: 2, text: 'Elliott 48 yd FG', homeScore: 7, awayScore: 3 },
  ];
  assert.deepEqual(gridironScoring({ plays, game }), [
    { when: 'Q1 9:12', abbr: 'CHI', kind: 'TD', text: 'Williams 12 pass to Odunze', score: '0-7' },
    { when: 'Q2 0:03', abbr: 'PHI', kind: 'FG', text: 'Elliott 48 yd FG', score: '3-7' },
  ]);
  assert.deepEqual(gridironScoring({ plays: [], game }), [], 'no plays and no events: nothing, not an error');
});

test('gridiron last plays: five, newest first, rows without words skipped', () => {
  const plays = Array.from({ length: 8 }, (_, i) => ({ period: 1, clock: `${10 - i}:00`, text: i === 6 ? null : `play ${i}`, scoring: i === 7 }));
  const last = gridironLast(plays);
  assert.equal(LAST_N, 5);
  assert.deepEqual(last.map((p) => p.text), ['play 7', 'play 5', 'play 4', 'play 3', 'play 2']);
  assert.equal(last[0].scoring, true);
  assert.equal(last[0].when, 'Q1 3:00');
  assert.equal(gridironLast([{ period: 5, clock: '8:00', text: 'OT kick' }])[0].when, 'OT 8:00');
});

test('gridiron last plays: by the game clock, stoppages out (the 29 Sep preview)', () => {
  // The plays table's own order: drive rows first, drive-less rows (timeouts,
  // quarter ends) LAST - which is what the first preview took the tail of.
  const plays = [
    { period: 1, clock: '8:47', text: 'Keenum TD pass', playType: 'passing touchdown', scoring: true },
    { period: 2, clock: '5:02', text: 'Swift 3 yd run', playType: 'rush' },
    { period: 2, clock: '4:28', text: 'Keenum pass to Swift, no gain', playType: 'pass reception' },
    { period: 1, clock: '6:09', text: 'Official Timeout at 06:09.', playType: 'official-timeout' },
    { period: 1, clock: '0:00', text: 'END QUARTER 1', playType: 'End Period' },
    { period: 2, clock: '13:59', text: 'Official Timeout at 13:59.', playType: 'official-timeout' },
    { period: 2, clock: '6:14', text: 'Timeout #1 by PHI', playType: 'Timeout' },
    { period: 1, clock: '2:10', text: 'Hurts sacked', playType: 'sack' },
  ];
  assert.deepEqual(gridironLast(plays).map((p) => p.when), ['Q2 4:28', 'Q2 5:02', 'Q1 2:10', 'Q1 8:47']);
  assert.deepEqual(gridironScoring({ plays, game: { home: team(1, 'CHI'), away: team(2, 'PHI') } }).map((p) => p.when), ['Q1 8:47']);
});

test('baseball: scoring plays as the MLB page prints them; last five at-bats across halves', () => {
  assert.deepEqual(mlbScoring([{ half: 'bottom', inning: 4, text: 'Judge homers', awayScore: 0, homeScore: 2 }]),
    [{ when: 'Bot 4', abbr: null, kind: null, text: 'Judge homers', score: '0-2' }]);
  const halves = [
    { label: 'Top 7th', atBats: [{ result: 'Devers singles' }, { result: null }, { result: 'Casas walks' }] },
    { label: 'Bot 6th', atBats: [{ result: 'Judge homers', scoring: true }, { result: 'Soto flies out' }, { result: 'Volpe grounds out' }] },
  ];
  const l = mlbLast(halves);
  assert.deepEqual(l.map((x) => x.text), ['Devers singles', 'Casas walks', 'Judge homers', 'Soto flies out', 'Volpe grounds out']);
  assert.equal(l[2].scoring, true); assert.equal(l[2].when, 'Bot 6th');
});
