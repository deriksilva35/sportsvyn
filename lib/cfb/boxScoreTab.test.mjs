// lib/cfb/boxScoreTab.test.mjs — the CFB box score reader, its tab, its cadence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfbTablesFor, CFB_GROUPS, BOX_COLUMNS } from './boxScore.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// A verbatim slice of what cfbBoxScore's query returns for 20651.
const ROWS = [
  { full_name: 'Jaden Craig', team_name: 'TCU', pass_cmp: 20, pass_att: 32, pass_yds: 175,
    pass_td: 0, pass_int: 0, rush_car: 4, rush_yds: -22, rush_td: 0, rush_long: 0 },
  { full_name: 'Jeremy Payne', team_name: 'TCU', rush_car: 25, rush_yds: 142, rush_td: 0, rush_long: 48 },
  { full_name: 'Ansel Din-Mbuh', team_name: 'TCU', tackles_tot: 4, tackles_solo: 3, tfl: 2.5, sacks: 2 },
  { full_name: 'Billy Edwards Jr.', team_name: 'North Carolina', pass_cmp: 16, pass_att: 28, pass_yds: 232 },
];

test('the passing line is C/ATT - the college column, not two NFL columns', () => {
  const t = cfbTablesFor(ROWS, 'TCU').find((x) => x.group === 'passing');
  assert.deepEqual(t.headings, ['C/ATT', 'YDS', 'TD', 'INT']);
  // The row carries identity alongside the cells now; the CELLS are the claim
  // this test makes, so it asserts those and the name rather than the shape.
  assert.equal(t.rows[0].name, 'Jaden Craig');
  assert.deepEqual(t.rows[0].cells, ['20/32', '175', '0', '0']);
});

test('a carry is CAR, and the table is ordered LEADER FIRST', () => {
  // THIS RULE CHANGED, deliberately. It used to say "keeps provider order",
  // which was the query's ORDER BY p.full_name - a box score sorted by the
  // alphabet. A reader opens the rushing table to see who ran for the most
  // yards, so every group now sorts by its own primary stat descending, live
  // and final alike, and the live overlay inherits it for free.
  const t = cfbTablesFor(ROWS, 'TCU').find((x) => x.group === 'rushing');
  assert.deepEqual(t.headings, ['CAR', 'YDS', 'TD', 'LONG']);
  assert.deepEqual(t.rows.map((r) => r.name), ['Jeremy Payne', 'Jaden Craig']);
  assert.equal(t.rows[0].cells.join(), '25,142,0,48');
  // -22 rushing yards sorts BELOW 142, not beside it as a string.
  assert.equal(t.rows[1].cells[1], '-22');
});

test('TFL and SACKS are structural on the CFB defensive line', () => {
  const t = cfbTablesFor(ROWS, 'TCU').find((x) => x.group === 'defensive');
  assert.ok(t.headings.includes('TFL'));
  assert.ok(t.headings.includes('SACKS'));
  const row = t.rows.find((r) => r.name === 'Ansel Din-Mbuh');
  assert.deepEqual(row.cells.slice(0, 4), ['4', '3', '2.5', '2']);
});

test('A GROUP WITH NO NUMBERS DOES NOT RENDER', () => {
  // Every player is one wide row, so "did he punt" is "is any punting column
  // non-null" - not "is there a punting row". Without this every game would
  // show ten tables, eight of them dashes.
  const groups = cfbTablesFor(ROWS, 'TCU').map((t) => t.group);
  assert.deepEqual(groups, ['passing', 'rushing', 'defensive']);
  assert.ok(!groups.includes('punting'));
  assert.ok(!groups.includes('kicking'));
});

test('a pair with neither half is ABSENT, never "–/–"', () => {
  const t = cfbTablesFor([{ full_name: 'X', team_name: 'T', fg_long: 41 }], 'T')
    .find((x) => x.group === 'kicking');
  assert.equal(t.rows[0].cells[0], '–', 'FG with no makes and no attempts');
});

test('teams are separated - one team never sees the other\'s rows', () => {
  assert.equal(cfbTablesFor(ROWS, 'North Carolina').find((t) => t.group === 'passing').rows.length, 1);
  assert.equal(cfbTablesFor(ROWS, 'TCU').find((t) => t.group === 'passing').rows[0].name, 'Jaden Craig');
});

test('NO FANTASY POINTS - college has no scoring format in this product', () => {
  for (const t of cfbTablesFor(ROWS, 'TCU')) assert.equal(t.showFpts, false);
});

test('the SELECT list is derived from the display spec, not hand-listed', () => {
  // A column that can be shown but was never fetched renders as a dash forever.
  for (const g of CFB_GROUPS) {
    for (const [k] of g.cols) {
      for (const col of (Array.isArray(k) ? k : [k])) {
        assert.ok(BOX_COLUMNS.includes(col), `${col} is displayed and must be fetched`);
      }
    }
  }
});

// ------------------------------------------------------------- the consumer

test('the page READS our table - no provider call at render time', () => {
  const PAGE = src('app/cfb/game/[slug]/page.js');
  const BOX = src('lib/cfb/boxScore.js');
  assert.match(PAGE, /import \{ cfbBoxScoreFor, boxScoreLabel \} from '@\/lib\/cfb\/boxScore'/);
  assert.doesNotMatch(BOX, /fetch\(|collegefootballdata/, 'the reader never leaves our database');
  assert.doesNotMatch(PAGE, /importCfbWeek/, 'the page does not import, it reads');
});

test('TAB ONLY WHEN DATA - the NFL rule, unchanged', () => {
  const PAGE = src('app/cfb/game/[slug]/page.js');
  // THE RULE, NOT THE EXPRESSION. D8 added a DRIVES panel beside it, so the
  // array is built differently; PLAYER LINES is still the tab that appears
  // only when a box score exists, which is what this test is for.
  assert.match(PAGE, /boxTeams\.length \? \{ key: 'players', label: 'PLAYER LINES' \} : null/);
  assert.match(PAGE, /\{panels\.length > 1 \? \(/, 'no rail when there is only one panel to show');
});

test('THE STALE COMMENT IS GONE', () => {
  const PAGE = src('app/cfb/game/[slug]/page.js');
  assert.doesNotMatch(PAGE, /would be a promise the data cannot keep/,
    'the note argued against a tab whose data now exists');
  assert.match(PAGE, /IT NOW RENDERS A BOX SCORE/);
  assert.match(PAGE, /cfb_player_game_stats \(migration 078\)/);
});

test('the NFL page is untouched - shared grammar, separate data paths', () => {
  const NFL = src('app/nfl/game/[slug]/page.js');
  assert.match(NFL, /linesByGroup/, 'NFL still reads gridiron_player_lines');
  assert.doesNotMatch(NFL, /cfbBoxScore|cfb_player_game_stats/,
    'the CFB reader must not leak into the NFL page');
});

// -------------------------------------------------------------- the cadence

test('MONDAY SETTLES, and only for one hour', () => {
  // The route imports through the '@/' alias, which node --test cannot resolve,
  // so the predicate is transcribed from source and both are pinned.
  const ROUTE = src('app/api/cron/cfb-player-stats/route.js');
  assert.match(ROUTE, /now\.getUTCDay\(\) === 1 && now\.getUTCHours\(\) === 14/);
  const isSettlingPass = (now) => now.getUTCDay() === 1 && now.getUTCHours() === 14;
  assert.equal(isSettlingPass(new Date('2026-08-31T14:05:00Z')), true, 'Monday 14:00 UTC');
  assert.equal(isSettlingPass(new Date('2026-08-31T15:05:00Z')), false, 'not every Monday hour');
  assert.equal(isSettlingPass(new Date('2026-08-29T22:00:00Z')), false, 'Saturday is catch-up');
  assert.equal(isSettlingPass(new Date('2026-09-01T14:00:00Z')), false, 'Tuesday is not Monday');
});

test('an off-day fire costs ZERO provider calls', () => {
  const ROUTE = src('app/api/cron/cfb-player-stats/route.js');
  // The catch-up query names only weeks holding a final we have no rows for.
  assert.match(ROUTE, /NOT EXISTS \(SELECT 1 FROM cfb_player_game_stats s WHERE s\.match_id = m\.id\)/);
  assert.match(ROUTE, /reason: settling \? 'no-final-games' : 'nothing-missing'/);
  assert.match(ROUTE, /const weeks = settling \? await weeksToImport\(season\) : await weeksMissingStats\(season\)/);
});

test('the week handed to the importer is DERIVED from matches, never a contest key', () => {
  const ROUTE = src('app/api/cron/cfb-player-stats/route.js');
  assert.match(ROUTE, /importCfbWeek\(season, w\.week/);
  // w.week comes from matches.week, which syncCfbGames wrote from CFBD's g.week.
  assert.match(ROUTE, /SELECT m\.season_phase, m\.week/);
  assert.doesNotMatch(ROUTE, /contests|iso_week/, 'no contest key can reach the importer');
});

test('the cron fires hourly and Monday is still covered', () => {
  const V = JSON.parse(src('vercel.json'));
  const c = V.crons.find((x) => x.path.includes('cfb-player-stats'));
  assert.equal(c.schedule, '0 * * * *');
});
