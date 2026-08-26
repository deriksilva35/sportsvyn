// lib/cfb/seasonStats.test.mjs - the CFB stat pivot and its column vocabulary.
//
// THE POINT OF THIS FILE IS THAT THE PROVIDER'S NAMES ARE NOT OURS, and getting
// one wrong produces an all-null column rather than an error. Every mapped pair
// is asserted against the vocabulary read off the live payload, and the two
// that would have been wrong by assumption get their own tests.
//
// The NFL side and the soccer side are pinned here too: this relay changed a
// shared render path, and the A relay's discipline was that a shared component
// is exactly where the other code's regression comes from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WIDE_COLUMNS, WIDE_COLUMN_NAMES, DECIMAL_COLUMNS, CFB_COLUMN_SETS,
  cfbColumnsFor, cfbColumnSetName, pivotSeasonRows, toNumber,
} from './seasonStats.js';
import { careerFrom, formatStat } from '../gridiron/playerStats.js';
import { COLUMN_SETS as NFL_SETS } from '../gridiron/playerStats.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// The vocabulary as enumerated from /stats/player/season?year=2025&team=Georgia.
// If CFBD adds a statType this stays true; if it RENAMES one, the pivot test
// below stops matching and says so.
const LIVE_VOCAB = {
  defensive: ['PD', 'QB HUR', 'SACKS', 'SOLO', 'TD', 'TFL', 'TOT'],
  fumbles: ['FUM', 'LOST', 'REC'],
  interceptions: ['AVG', 'INT', 'TD', 'YDS'],
  kickReturns: ['AVG', 'LONG', 'NO', 'TD', 'YDS'],
  kicking: ['FGA', 'FGM', 'LONG', 'PCT', 'PTS', 'XPA', 'XPM'],
  passing: ['ATT', 'COMPLETIONS', 'INT', 'PCT', 'TD', 'YDS', 'YPA'],
  puntReturns: ['AVG', 'LONG', 'NO', 'TD', 'YDS'],
  punting: ['In 20', 'LONG', 'NO', 'TB', 'YDS', 'YPP'],
  receiving: ['LONG', 'REC', 'TD', 'YDS', 'YPR'],
  rushing: ['CAR', 'LONG', 'TD', 'YDS', 'YPC'],
};

test('every mapped pair exists in the live vocabulary', () => {
  for (const [col, cat, st] of WIDE_COLUMNS) {
    assert.ok(LIVE_VOCAB[cat], `${col}: category "${cat}" is not one CFBD sends`);
    assert.ok(LIVE_VOCAB[cat].includes(st),
      `${col}: ${cat} has no statType "${st}" - it has ${LIVE_VOCAB[cat].join(', ')}`);
  }
});

test('A DEFENDER\'S INTERCEPTIONS ARE NOT IN THE DEFENSIVE CATEGORY', () => {
  // The trap. `defensive` carries PD/QB HUR/SACKS/SOLO/TD/TFL/TOT and no INT at
  // all; picks live in their own category. Mapping def_int to defensive/INT
  // would have produced a silently all-null column on every defender's page -
  // no error, no crash, just a column of em-dashes nobody could explain.
  assert.ok(!LIVE_VOCAB.defensive.includes('INT'));
  const [, cat, st] = WIDE_COLUMNS.find(([c]) => c === 'def_int');
  assert.equal(cat, 'interceptions');
  assert.equal(st, 'INT');
});

test('the provider\'s spellings are used verbatim, spaces and all', () => {
  const pairOf = (col) => WIDE_COLUMNS.find(([c]) => c === col).slice(1);
  assert.deepEqual(pairOf('pass_cmp'), ['passing', 'COMPLETIONS'], 'not CMP');
  assert.deepEqual(pairOf('rush_car'), ['rushing', 'CAR'], 'not ATT');
  assert.deepEqual(pairOf('punt_in20'), ['punting', 'In 20'], 'the space is real');
});

test('games played is ABSENT because the payload has none', () => {
  for (const types of Object.values(LIVE_VOCAB)) {
    for (const t of types) assert.ok(!/^(GP|G|GAMES)$/i.test(t), `${t} looks like games played`);
  }
  assert.ok(!WIDE_COLUMN_NAMES.some((c) => /games/i.test(c)),
    'no games column may exist while the provider sends none');
  assert.doesNotMatch(src('migrations/077_cfb_player_stats.sql'), /^\s+games\b/m);
});

test('derived ratios are NOT stored - they are functions of stored columns', () => {
  const mapped = new Set(WIDE_COLUMNS.map(([, c, s]) => `${c}|${s}`));
  for (const pair of ['passing|PCT', 'passing|YPA', 'rushing|YPC', 'receiving|YPR',
                      'kicking|PCT', 'punting|YPP', 'interceptions|AVG',
                      'kickReturns|AVG', 'puntReturns|AVG']) {
    assert.ok(!mapped.has(pair), `${pair} is derived and must not be a column`);
  }
});

// ---------------------------------------------------------------- the pivot

test('PIVOT: a real defender\'s long rows become his wide row', () => {
  // Shammond Cooper (LB, Akron) 2025, verbatim from the live payload during the
  // dry run - not from the mock, whose numbers are shaped.
  const long = [
    { playerId: 1, season: 2025, player: 'Shammond Cooper', position: 'LB', team: 'Akron', category: 'defensive', statType: 'PD', stat: '1' },
    { playerId: 1, season: 2025, category: 'defensive', statType: 'QB HUR', stat: '1' },
    { playerId: 1, season: 2025, category: 'defensive', statType: 'SACKS', stat: '0.5' },
    { playerId: 1, season: 2025, category: 'defensive', statType: 'SOLO', stat: '27' },
    { playerId: 1, season: 2025, category: 'defensive', statType: 'TD', stat: '0' },
    { playerId: 1, season: 2025, category: 'defensive', statType: 'TFL', stat: '4.5' },
    { playerId: 1, season: 2025, category: 'defensive', statType: 'TOT', stat: '66' },
  ];
  const { rows, unmapped } = pivotSeasonRows(long);
  assert.equal(rows.length, 1);
  assert.equal(unmapped.size, 0);
  assert.deepEqual(rows[0].stats, {
    pass_def: 1, qb_hur: 1, sacks: 0.5, tackles_solo: 27, def_td: 0, tfl: 4.5, tackles_tot: 66,
  });
  assert.equal(rows[0].providerPlayerId, '1');
  assert.equal(rows[0].season, 2025);
});

test('one player, two seasons, two rows', () => {
  const { rows } = pivotSeasonRows([
    { playerId: 7, season: 2025, category: 'receiving', statType: 'REC', stat: '2' },
    { playerId: 7, season: 2024, category: 'receiving', statType: 'REC', stat: '11' },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.season, r.stats.rec]).sort(), [[2024, 11], [2025, 2]]);
});

test('an unknown pair is COUNTED, never silently dropped', () => {
  const { rows, unmapped } = pivotSeasonRows([
    { playerId: 1, season: 2025, category: 'defensive', statType: 'TOT', stat: '10' },
    { playerId: 1, season: 2025, category: 'defensive', statType: 'NEWSTAT', stat: '3' },
  ]);
  assert.deepEqual(rows[0].stats, { tackles_tot: 10 });
  assert.equal(unmapped.get('defensive|NEWSTAT'), 1);
});

test('numbers survive commas; junk becomes null, never NaN', () => {
  assert.equal(toNumber('1,014'), 1014);
  assert.equal(toNumber('12.5'), 12.5);
  assert.equal(toNumber('0'), 0, 'a real zero is not absence');
  for (const junk of [null, undefined, '', '-', '--', 'n/a']) assert.equal(toNumber(junk), null, String(junk));
});

// ---------------------------------------------------------------- render

test('THE CODES DIVERGE ON DEFENSE, and both are right', () => {
  // CFBD carries tackles and TFL; the NFL table never has. So the same page
  // renders two different defensive headers, each true to its own source.
  assert.deepEqual(CFB_COLUMN_SETS.defense.map((c) => c.label), ['Tkl', 'TFL', 'Sacks', 'INT']);
  assert.deepEqual(NFL_SETS.defense.map((c) => c.label), ['Sacks', 'INT', 'FR', 'TD']);
});

test('CFB columns are position-group aware, same contract as NFL', () => {
  assert.equal(cfbColumnSetName(cfbColumnsFor('QB', 'OFF')), 'passing');
  assert.equal(cfbColumnSetName(cfbColumnsFor('RB', 'OFF')), 'rushing');
  assert.equal(cfbColumnSetName(cfbColumnsFor('TE', 'OFF')), 'receiving');
  assert.equal(cfbColumnSetName(cfbColumnsFor('K', 'ST')), 'kicking');
  assert.equal(cfbColumnSetName(cfbColumnsFor('DL', 'DEF')), 'defense');
  // And null still means "render no table", not "render an empty one".
  for (const [p, g] of [['OL', 'OFF'], ['P', 'ST'], ['LS', 'OFF']]) {
    assert.equal(cfbColumnsFor(p, g), null, p);
  }
});

test('halves are real in college, and only where they are real', () => {
  assert.deepEqual([...DECIMAL_COLUMNS].sort(), ['sacks', 'tackles_solo', 'tackles_tot', 'tfl']);
  const [tkl, tfl, sacks, ints] = CFB_COLUMN_SETS.defense;
  // A shared stop is half a tackle to each defender.
  assert.equal(formatStat(tfl, 4.5), '4.5');
  assert.equal(formatStat(sacks, 2), '2.0');
  assert.equal(formatStat(tkl, 57), '57.0');
  // A catch is never half a catch.
  assert.equal(formatStat(ints, 3), '3');
  assert.equal(formatStat(CFB_COLUMN_SETS.receiving[0], 14), '14');
});

test('CONSERVATION, and the null fix, on real CFB shapes', () => {
  // Marcus Patterson (DL), hand-run in SQL on DEV after the import:
  //   2025 32/6/2.0  2024 22/5/0.5  2023 3/0/0.0  -> career 57/11/2.5
  // and def_int is null in every season, so career must be null too.
  const seasons = [
    { season: 2025, tackles_tot: 32, tfl: 6, sacks: 2, def_int: null },
    { season: 2024, tackles_tot: 22, tfl: 5, sacks: 0.5, def_int: null },
    { season: 2023, tackles_tot: 3, tfl: 0, sacks: 0, def_int: null },
  ];
  const career = careerFrom(seasons, CFB_COLUMN_SETS.defense);
  assert.equal(career.tackles_tot, 57);
  assert.equal(career.tfl, 11);
  assert.equal(career.sacks, 2.5, 'floating point must not make this 2.4999999');
  assert.equal(career.def_int, null, 'all-null stays null, not 0');
  assert.equal(formatStat(CFB_COLUMN_SETS.defense[3], career.def_int), '—');
});

test('a career LONG is the longest, not the total', () => {
  // Jake Taylor (TE) on DEV: longs 16 / 14 / 14. Summed that is 44, which would
  // be a 44-yard catch he never made.
  const seasons = [{ rec: 2, rec_yds: 20, rec_td: 0, rec_long: 16 },
                   { rec: 11, rec_yds: 74, rec_td: 0, rec_long: 14 },
                   { rec: 1, rec_yds: 14, rec_td: 0, rec_long: 14 }];
  const career = careerFrom(seasons, CFB_COLUMN_SETS.receiving);
  assert.equal(career.rec, 14);
  assert.equal(career.rec_yds, 108);
  assert.equal(career.rec_long, 16, 'max, not 44');
});

// ---------------------------------------------------------------- schema

test('every rendered column key is a real column in migration 077', () => {
  const ddl = src('migrations/077_cfb_player_stats.sql').replace(/--[^\n]*/g, '');
  // [a-z_0-9], not [a-z_]: punt_in20 has a digit in it, and a name-class that
  // stops at the digit matched "punt_in" and reported the column undeclared
  // when the migration was correct all along.
  const declared = new Set([...ddl.matchAll(/^\s+([a-z_0-9]+)\s+(?:INTEGER|NUMERIC|TEXT)/gm)].map((m) => m[1]));
  for (const [name, set] of Object.entries(CFB_COLUMN_SETS)) {
    for (const c of set) assert.ok(declared.has(c.key), `${name}.${c.key} is not in 077`);
  }
  // And the wide mapping and the DDL agree, both ways.
  for (const c of WIDE_COLUMN_NAMES) assert.ok(declared.has(c), `${c} mapped but not declared`);
});

test('the decimal columns are NUMERIC and the counts are INTEGER', () => {
  const ddl = src('migrations/077_cfb_player_stats.sql').replace(/--[^\n]*/g, '');
  for (const m of ddl.matchAll(/^\s+([a-z_0-9]+)\s+(INTEGER|NUMERIC\(6,1\))/gm)) {
    const [, col, type] = m;
    if (!WIDE_COLUMN_NAMES.includes(col)) continue;
    const wantNumeric = DECIMAL_COLUMNS.has(col);
    assert.equal(type.startsWith('NUMERIC'), wantNumeric,
      `${col} should be ${wantNumeric ? 'NUMERIC' : 'INTEGER'}`);
  }
});

test('the import is idempotent and keyed on (player_id, season)', () => {
  assert.match(src('migrations/077_cfb_player_stats.sql'), /PRIMARY KEY \(player_id, season\)/);
  const imp = src('lib/cfb/seasonStatsImport.js');
  assert.match(imp, /ON CONFLICT \(player_id, season\) DO UPDATE SET/);
  // ONE league-wide call, filtered in code - the roster-shape cost law.
  assert.match(imp, /\/stats\/player\/season\?year=\$\{season\}/);
  assert.doesNotMatch(imp, /season\?year=\$\{season\}&team=/, 'no per-team fetching');
  // Unmatched players are counted, never silently dropped.
  assert.match(imp, /unmatched\+\+/);
});

test('NFL and soccer render paths are untouched by the CFB fork', () => {
  const page = src('app/player/[slug]/page.js');
  // The fork is one boolean, and the NFL arm still calls its own readers.
  assert.match(page, /const isCfb = player\.league_slug === 'cfb';/);
  assert.match(page, /seasonTotals\(bdlId, columns\)/);
  assert.match(page, /cfbSeasonTotals\(player\.id, columns\)/);
  // Soccer never reaches any of it.
  const body = page.slice(page.indexOf('export default async function PlayerPage'));
  assert.ok(body.indexOf('if (isGridiron(player.league_slug))') <
            body.indexOf('await getPlayerGroupFixtures('));
});

test('CFB reads its OWN game log, never derived from season totals', () => {
  // This test used to pin that CFB had no game log at all - true for exactly as
  // long as those rows were not imported. C2 imported them, so the pin moves:
  // CFB now reads cfb_player_game_stats, and the thing that must stay true is
  // that a season number never comes from summing games. 077 owns season
  // figures; one source of truth per number.
  const page = src('app/player/[slug]/page.js');
  assert.match(page, /cfbGameLog\(player\.id, columns/);
  assert.match(page, /cfbSeasonTotals\(player\.id, columns\)/);
  assert.doesNotMatch(page, /canHaveStats && !isCfb \? gameLog\(/, 'the CFB log is no longer suppressed');
  // The pill still follows the section rather than the league.
  assert.match(src('components/player/gridironPlayer.js'), /if \(hasLog\) pills\.push/);
});
