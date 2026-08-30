// lib/standings/view.test.mjs — the pure half of the standings surfaces.
//
// WHAT THESE TESTS ARE FOR: two claims that a reader will believe without
// checking. A win percentage says how a team has done; a spread label says who
// is favoured and by how much. Both are trivially invertible by a sign error,
// and neither renders as obviously wrong when it is.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { winPct, compareRecords, groupRecords, UNGROUPED, ordinal, recordChip, spreadLabel, spreadParts, formatRecord } from './view.js';
import { CFB_COLUMNS, nflColumns } from './columns.js';

test('winPct: ties count a half, and an unplayed season is null not zero', () => {
  assert.equal(winPct({ wins: 3, losses: 1, ties: 0 }), 0.75);
  assert.equal(winPct({ wins: 3, losses: 1, ties: 2 }), 4 / 6);
  // NULL, not 0. A 0-0 team has not lost every game.
  assert.equal(winPct({ wins: 0, losses: 0, ties: 0 }), null);
  assert.equal(winPct({}), null);
});

test('compareRecords: pct, then wins, then losses, then name; unplayed sinks', () => {
  const a = { wins: 2, losses: 0, name: 'A' };
  const b = { wins: 4, losses: 0, name: 'B' };   // same pct, more wins
  const c = { wins: 0, losses: 0, name: 'C' };   // unplayed
  const d = { wins: 1, losses: 1, name: 'D' };
  assert.deepEqual([a, b, c, d].sort(compareRecords).map((r) => r.name), ['B', 'A', 'D', 'C']);
});

test('groupRecords: two-key grouping, UNGROUPED sinks, rows sorted within', () => {
  const rows = [
    { id: 1, name: 'X', conference: 'NFC', division: 'West', wins: 1, losses: 1 },
    { id: 2, name: 'Y', conference: 'AFC', division: 'East', wins: 3, losses: 0 },
    { id: 3, name: 'Z', conference: null, division: null, wins: 0, losses: 3 },
    { id: 4, name: 'W', conference: 'AFC', division: 'East', wins: 4, losses: 0 },
  ];
  const g = groupRecords(rows, ['conference', 'division']);
  assert.deepEqual(g.map((s) => s.label), ['AFC · East', 'NFC · West', `${UNGROUPED} · ${UNGROUPED}`]);
  assert.deepEqual(g[0].rows.map((r) => r.name), ['W', 'Y']);
  // A team whose conference we do not hold is VISIBLE, not dropped.
  assert.equal(g[2].rows.length, 1);
});

test('ordinal: the EPL grammar, including the teens', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 20, 21].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '20th', '21st']);
  assert.equal(ordinal(0), null);
  assert.equal(ordinal(null), null);
});

test('recordChip: a chip may only claim knowledge', () => {
  assert.equal(recordChip('cfb', { wins: 2, losses: 1, ties: 0 }), '2-1');
  assert.equal(recordChip('nfl', { wins: 2, losses: 1, ties: 1 }), '2-1-1');
  // 0-0 is true and says nothing; absence is silence, never a dash.
  assert.equal(recordChip('cfb', { wins: 0, losses: 0, ties: 0 }), null);
  assert.equal(recordChip('cfb', null), null);
  // EPL speaks position, not record, off the SAME argument shape.
  assert.equal(recordChip('epl', { rank: 3 }), '3rd');
});

test('spreadLabel: the favourite is derived from the sign, never guessed', () => {
  // Negative home number = HOME favoured.
  assert.equal(spreadLabel({ spreadHome: -6.5, homeAbbr: 'TCU', awayAbbr: 'UNC' }), 'TCU −6.5');
  // Positive = AWAY favoured, and the label still shows a MINUS on the fav.
  assert.equal(spreadLabel({ spreadHome: 3, homeAbbr: 'TCU', awayAbbr: 'UNC' }), 'UNC −3');
  // A pick'em is not a spread anybody needs to read.
  assert.equal(spreadLabel({ spreadHome: 0, homeAbbr: 'A', awayAbbr: 'B' }), null);
  assert.equal(spreadLabel({ spreadHome: null, homeAbbr: 'A', awayAbbr: 'B' }), null);
  // No abbreviation, no sentence — a bare number would be ambiguous.
  assert.equal(spreadLabel({ spreadHome: -3, homeAbbr: null, awayAbbr: 'B' }), null);
});

test('spreadLabel uses U+2212, not a hyphen', () => {
  const s = spreadLabel({ spreadHome: -7, homeAbbr: 'GB', awayAbbr: 'CHI' });
  assert.ok(s.includes('−'));
  assert.ok(!s.includes('-'));
});

// --- structural guards ------------------------------------------------------

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the standings surfaces do not invent a tiebreak', () => {
  // The order is a readable default and the page must say so. If the note goes,
  // the page starts asserting a league ordering it does not compute.
  const shell = readFileSync(new URL('../../components/standings/StandingsPage.js', import.meta.url), 'utf8');
  assert.match(shell, /not a tiebreak/i);
});

test('no league conditional inside the standings shell', () => {
  // The two codes differ by PROPS. A branch here is the beginning of a third.
  const code = strip(readFileSync(new URL('../../components/standings/StandingsPage.js', import.meta.url), 'utf8'));
  assert.equal(/leagueSlug\s*===/.test(code), false);
});

test('record chips read the reader, never team_records directly', () => {
  // getTeamRecord/getLeagueRecords enforce season_type = regular. A surface
  // that writes its own query is a preseason record waiting to ship.
  for (const f of ['../../app/cfb/game/[slug]/page.js', '../../app/nfl/game/[slug]/page.js',
                   '../../app/scores/page.js', '../../components/gridiron/Scoreboard.js']) {
    const code = strip(readFileSync(new URL(f, import.meta.url), 'utf8'));
    assert.equal(code.includes('team_records'), false, `${f} queries team_records directly`);
  }
});

test('spreadParts: the number is separable and never part of the truncating half', () => {
  const p = spreadParts({ spreadHome: -6.5, homeAbbr: 'North Dakota State', awayAbbr: 'Jacksonville State' });
  assert.deepEqual(p, { fav: 'North Dakota State', mag: '−6.5' });
  // A name with a space inside it stays whole - the split is on the LAST space.
  const q = spreadParts({ spreadHome: 4, homeAbbr: 'Virginia', awayAbbr: 'NC State' });
  assert.deepEqual(q, { fav: 'NC State', mag: '−4' });
  // Same absence rule as the one-string form.
  assert.equal(spreadParts({ spreadHome: 0, homeAbbr: 'A', awayAbbr: 'B' }), null);
});

test('spreadParts recomposes to spreadLabel exactly', () => {
  for (const v of [-6.5, 3, -31, 4.5]) {
    const args = { spreadHome: v, homeAbbr: 'Florida State', awayAbbr: 'New Mexico State' };
    const p = spreadParts(args);
    assert.equal(`${p.fav} ${p.mag}`, spreadLabel(args));
  }
});

// --- the column sets, now that they are reachable without a React tree ------

const ROW = { wins: 9, losses: 3, ties: 0, conf_wins: 6, conf_losses: 2, conf_ties: 0,
  home_wins: 5, home_losses: 1, home_ties: 0, away_wins: 3, away_losses: 2, away_ties: 0,
  neutral_wins: 1, neutral_losses: 0, neutral_ties: 0, div_wins: 4, div_losses: 2, div_ties: 0,
  points_for: 340, points_against: 210, streak: 3, playoff_seed: 2, name: 'X' };

test('CFB columns: the splits a college reader expects, neutral site included', () => {
  assert.deepEqual(CFB_COLUMNS.map((c) => c.label), ['W-L', 'PCT', 'CONF', 'HOME', 'AWAY', 'NEUT']);
  assert.deepEqual(CFB_COLUMNS.map((c) => c.cell(ROW)), ['9-3', '.750', '6-2', '5-1', '3-2', '1-0']);
});

test('NFL columns: the SEED column appears only once somebody has played', () => {
  const unplayed = [{ wins: 0, losses: 0, ties: 0 }];
  assert.equal(nflColumns(unplayed).some((c) => c.key === 'seed'), false,
    'a playoff seed on a 0-0 league is a number nobody should read');
  assert.equal(nflColumns([ROW]).some((c) => c.key === 'seed'), true);
  assert.deepEqual(nflColumns([]).map((c) => c.label), ['W-L-T', 'PCT', 'DIV', 'CONF', 'PF', 'PA', 'STRK']);
});

test('the streak cell reads the SIGN, and 0 is not a streak', () => {
  const strk = nflColumns([ROW]).find((c) => c.key === 'strk');
  assert.equal(strk.cell({ streak: 3 }), 'W3');
  assert.equal(strk.cell({ streak: -2 }), 'L2');
  assert.equal(strk.cell({ streak: 0 }), '\u2013');
  assert.equal(strk.cell({ streak: null }), '\u2013');
});

test('an absent split is a DASH in a table and NOTHING in a chip', () => {
  // The two surfaces differ on purpose. A table column has a cell to fill and
  // a dash says "we hold no such row"; a chip has no cell, and a dash beside a
  // team name would read as a record.
  assert.equal(CFB_COLUMNS.find((c) => c.key === 'conf').cell({ conf_wins: null, conf_losses: null }), '\u2013');
  assert.equal(recordChip('cfb', { wins: null, losses: null }), null);
  assert.equal(formatRecord(null, null), null);
});
