// lib/cfb/gameStats.test.mjs - CFB box scores.
//
// The season endpoint and the game endpoint DO NOT speak the same language,
// and the tests that matter here are the ones that pin that difference: the
// pair-splitting, the explicit seasonType, and the insert/update split that
// exists because a write-attempt counter hid a double import.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAME_COLUMNS, PAIR_COLUMNS, GAME_COLUMN_NAMES, DECIMAL_COLUMNS,
  pivotWeek, splitPair, toNumber,
} from './gameStats.js';
import { CFB_COLUMN_SETS } from './seasonStats.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// Enumerated from /games/players?year=2025&week=1 (191 games).
const GAME_VOCAB = {
  defensive: ['PD', 'QB HUR', 'SACKS', 'SOLO', 'TD', 'TFL', 'TOT'],
  fumbles: ['FUM', 'LOST', 'REC'],
  interceptions: ['INT', 'TD', 'YDS'],
  kickReturns: ['AVG', 'LONG', 'NO', 'TD', 'YDS'],
  kicking: ['FG', 'LONG', 'PCT', 'PTS', 'XP'],
  passing: ['AVG', 'C/ATT', 'INT', 'QBR', 'TD', 'YDS'],
  puntReturns: ['AVG', 'LONG', 'NO', 'TD', 'YDS'],
  punting: ['AVG', 'In 20', 'LONG', 'NO', 'TB', 'YDS'],
  receiving: ['AVG', 'LONG', 'REC', 'TD', 'YDS'],
  rushing: ['AVG', 'CAR', 'LONG', 'TD', 'YDS'],
};

test('every mapped pair exists in the GAME vocabulary, which is not the season one', () => {
  for (const [col, cat, ty] of GAME_COLUMNS) {
    assert.ok(GAME_VOCAB[cat], `${col}: no category "${cat}"`);
    assert.ok(GAME_VOCAB[cat].includes(ty), `${col}: ${cat} has no type "${ty}"`);
  }
  for (const [cat, ty] of PAIR_COLUMNS) {
    assert.ok(GAME_VOCAB[cat].includes(ty), `${cat}/${ty} must exist`);
  }
  // The difference that would have produced a table of nulls.
  assert.ok(!GAME_VOCAB.passing.includes('COMPLETIONS'), 'the game endpoint has no COMPLETIONS');
  assert.ok(GAME_VOCAB.passing.includes('C/ATT'));
  assert.ok(!GAME_VOCAB.kicking.includes('FGM'), 'the game endpoint has no FGM');
  assert.ok(GAME_VOCAB.kicking.includes('FG'));
});

test('PAIRS split into the same columns the season table uses', () => {
  assert.deepEqual(splitPair('23/30'), [23, 30]);
  assert.deepEqual(splitPair('2/3'), [2, 3]);
  assert.deepEqual(splitPair('0/0'), [0, 0], 'a real 0/0 is not absence');
  for (const junk of ['', '-', 'x/y', null, undefined, '23']) {
    assert.deepEqual(splitPair(junk), [null, null], String(junk));
  }
  const cols = PAIR_COLUMNS.flatMap(([, , c]) => c);
  assert.deepEqual(cols, ['pass_cmp', 'pass_att', 'fgm', 'fga', 'xpm', 'xpa']);
});

test('PIVOT: a real box-score line becomes a wide row', () => {
  // Jaxon Potter, Washington State, 2025 wk1 - verbatim from the live payload.
  const payload = [{ id: 401752947, teams: [{ team: 'Washington State', categories: [
    { name: 'passing', types: [
      { name: 'C/ATT', athletes: [{ id: '1', name: 'Jaxon Potter', stat: '23/30' }] },
      { name: 'YDS',   athletes: [{ id: '1', name: 'Jaxon Potter', stat: '208' }] },
      { name: 'TD',    athletes: [{ id: '1', name: 'Jaxon Potter', stat: '1' }] },
      { name: 'INT',   athletes: [{ id: '1', name: 'Jaxon Potter', stat: '0' }] },
      { name: 'QBR',   athletes: [{ id: '1', name: 'Jaxon Potter', stat: '47.2' }] },
      { name: 'AVG',   athletes: [{ id: '1', name: 'Jaxon Potter', stat: '6.9' }] },
    ] },
    { name: 'rushing', types: [
      { name: 'CAR', athletes: [{ id: '1', name: 'Jaxon Potter', stat: '2' }] },
      { name: 'YDS', athletes: [{ id: '1', name: 'Jaxon Potter', stat: '2' }] },
    ] },
  ] }] }];
  const { rows, unmapped } = pivotWeek(payload, { season: 2025, week: 1 });
  assert.equal(rows.length, 1);
  assert.equal(unmapped.size, 0, 'QBR and AVG are known-ignored, not unmapped');
  assert.deepEqual(rows[0].stats, {
    pass_cmp: 23, pass_att: 30, pass_yds: 208, pass_td: 1, pass_int: 0,
    rush_car: 2, rush_yds: 2,
  });
  assert.equal(rows[0].providerGameId, '401752947');
  // Derived types are absent, not zero.
  assert.ok(!('qbr' in rows[0].stats));
});

test('one athlete in two games is two rows', () => {
  const mk = (id, stat) => ({ id, teams: [{ team: 'T', categories: [
    { name: 'rushing', types: [{ name: 'CAR', athletes: [{ id: '9', name: 'X', stat }] }] }] }] });
  const { rows } = pivotWeek([mk(1, '10'), mk(2, '4')], { season: 2025, week: 1 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.stats.rush_car).sort(), [10, 4].sort());
});

test('an unknown type is COUNTED; a known-derived one is not', () => {
  const p = [{ id: 1, teams: [{ team: 'T', categories: [{ name: 'passing', types: [
    { name: 'NEWSTAT', athletes: [{ id: '1', stat: '5' }] },
    { name: 'QBR', athletes: [{ id: '1', stat: '9' }] },
  ] }] }] }];
  const { unmapped } = pivotWeek(p, { season: 2025, week: 1 });
  assert.equal(unmapped.get('passing|NEWSTAT'), 1);
  assert.ok(!unmapped.has('passing|QBR'), 'QBR is deliberately ignored, not unmapped');
});

test('seasonType IS ALWAYS EXPLICIT - omitting it does not mean regular', () => {
  // Asserted against the live API, not assumed:
  //   week=1                      191 games
  //   seasonType=regular&week=1   141
  //   seasonType=postseason&week=1 50
  //   intersection 0, union == 191
  // The backfill leaned on the inclusive form and imported the postseason
  // twice. Harmless (the upsert corrected it) but it is what made a
  // write-attempt counter disagree with the row count.
  const imp = src('lib/cfb/gameStatsImport.js');
  assert.match(imp, /const seasonType = seasonPhase === 'POST' \? 'postseason' : 'regular';/);
  assert.match(imp, /\/games\/players\?year=\$\{season\}&seasonType=\$\{seasonType\}&week=\$\{week\}/);
  // No call may be built without it. COMMENTS STRIPPED FIRST: the module's own
  // header quotes the parameterless URL in order to explain why it is wrong,
  // and a raw scan reads that explanation as the offence.
  const code = imp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = [...code.matchAll(/\/games\/players\?[^`]*/g)].map((m) => m[0]);
  assert.ok(calls.length > 0);
  for (const c of calls) assert.match(c, /seasonType=/, `a call without seasonType: ${c}`);
});

test('the ledger separates INSERTS from UPDATES', () => {
  const imp = src('lib/cfb/gameStatsImport.js');
  // (xmax = 0) is Postgres telling us the row was inserted, not updated.
  assert.match(imp, /RETURNING \(xmax = 0\) AS inserted/);
  assert.match(imp, /attempted, inserted, updated, dryRun,/);
  // `written` as a single number is exactly how the artifact hid.
  assert.doesNotMatch(imp, /written:/, 'a single "written" count must not come back');
});

test('season totals are NOT derived from the game table', () => {
  // One source of truth per number: 077 owns season figures.
  const page = src('app/player/[slug]/page.js');
  assert.match(page, /cfbSeasonTotals\(player\.id, columns\)/);
  assert.match(page, /cfbGameLog\(player\.id, columns/);
  const read = src('lib/cfb/gameStats.js');
  const logFn = read.slice(read.indexOf('export async function cfbGameLog'));
  assert.doesNotMatch(logFn, /sum\(/i, 'the log reads rows, it does not aggregate them');
});

test('column keys exist in migration 078', () => {
  const ddl = src('migrations/078_cfb_player_game_stats.sql').replace(/--[^\n]*/g, '');
  const declared = new Set([...ddl.matchAll(/^\s+([a-z_0-9]+)\s+(?:INTEGER|NUMERIC|TEXT)/gm)].map((m) => m[1]));
  for (const c of GAME_COLUMN_NAMES) assert.ok(declared.has(c), `${c} mapped but not declared`);
  // The render's CFB sets must be readable from this table too.
  for (const [name, set] of Object.entries(CFB_COLUMN_SETS)) {
    for (const c of set) assert.ok(declared.has(c.key), `${name}.${c.key} missing from 078`);
  }
  assert.match(ddl, /PRIMARY KEY \(player_id, match_id\)/);
  for (const d of DECIMAL_COLUMNS) {
    assert.match(ddl, new RegExp(`^\\s+${d}\\s+NUMERIC`, 'm'), `${d} must be NUMERIC`);
  }
});

test('the SETTLING pass is weekly, gated on final games, and bounded', () => {
  const cron = src('app/api/cron/cfb-player-stats/route.js');
  assert.match(cron, /export const SOURCE = 'cfb-player-stats';/);
  assert.match(cron, /HAVING count\(\*\) FILTER \(WHERE m\.status = 'final'\) > 0/,
    'a week with no final game is not importable');
  assert.match(cron, /LIMIT \$\{limit\}/);
  assert.match(cron, /export const MAX_WEEKS = 3;/, 'catch-up must be bounded');
  assert.match(cron, /maybeAlert\(sql, \{/);
  // Registered, and staggered off cfb-rankings rather than sharing its tick.
  const v = JSON.parse(src('vercel.json'));
  const mine = v.crons.find((c) => c.path === '/api/cron/cfb-player-stats');
  assert.ok(mine, 'the cron must be registered');
  // THE CRON WENT HOURLY, 29 Aug, and the weekly claim moved INTO the route.
  // Firing weekly meant a Saturday box score waited until Monday; the endpoint
  // costs one call per week and the catch-up query names only weeks holding a
  // final we have no rows for, so an off-day tick costs nothing. The SETTLING
  // pass - the unconditional three-week re-read this test is about - is still
  // exactly weekly, now enforced in code rather than by the schedule.
  assert.equal(mine.schedule, '0 * * * *');
  assert.match(cron, /now\.getUTCDay\(\) === 1 && now\.getUTCHours\(\) === 14/,
    'the settling pass is Monday 14:00 UTC and no other hour');
  assert.match(cron, /weeksMissingStats/, 'every other fire is the cheap catch-up');
  const ranks = v.crons.find((c) => c.path === '/api/cron/cfb-rankings');
  assert.notEqual(mine.schedule, ranks.schedule, 'two CFB jobs must not share a tick');
});
