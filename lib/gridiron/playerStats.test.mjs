// lib/gridiron/playerStats.test.mjs - the gridiron player page.
//
// EVERY TEST HERE HAS A SOCCER HALF, because /player/[slug] is now a shared
// route with two renders and the team page already proved where the damage
// comes from: a component edited "generically" for gridiron silently reworded
// soccer's breadcrumb. Soccer is pinned by literal string, by section count,
// and by served-slice byte-diff.
//
// NO VALUE FROM THE MOCK APPEARS IN ANY FIXTURE. The mock's numbers are shaped,
// not real; the fixtures below are either synthetic or lifted from hand-run SQL
// against PROD, and the ones from PROD say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLUMN_SETS, columnsFor, columnSetName, formatStat, careerFrom, bdlIdOf,
} from './playerStats.js';
import {
  playerCrumb, playerPills, heroChips, bioCells, heroEyebrow, emptyLogLine, isGridiron,
} from '../../components/player/gridironPlayer.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// ---------------------------------------------------------------- chrome

test('BREADCRUMB: gridiron gets its league; soccer keeps its EXACT literal', () => {
  assert.deepEqual(playerCrumb('nfl', 'Travis Kelce').map((c) => c.label),
    ['Home', 'NFL', 'Players', 'Travis Kelce']);
  assert.equal(playerCrumb('cfb', 'X')[1].href, '/cfb');

  // THE REGRESSION PIN. Not "contains FIFA" - the exact label and the exact
  // href the page rendered before this change, for every non-gridiron league.
  for (const lg of ['fifa-wc-2026', 'international-friendlies', 'epl', null, undefined]) {
    const crumb = playerCrumb(lg, 'O. Benbot');
    assert.deepEqual(crumb.map((c) => c.label), ['Home', 'FIFA World Cup 2026', 'Players', 'O. Benbot']);
    assert.equal(crumb[1].href, '/world-cup-2026/bracket', `${lg} href must not move`);
    assert.equal(crumb[2].href, '#', 'there is no players index, for any league');
  }
});

test('PILLS render only sections that exist, per state', () => {
  // Mock states 1 and 2: stats present.
  assert.deepEqual(playerPills({ hasStats: true }).map((p) => p.label),
    ['Season Totals', 'Game Log', 'Team']);
  // Mock states 3 and 4: no rows. One pill, not three pointing at an apology.
  assert.deepEqual(playerPills({ hasStats: false }).map((p) => p.label), ['Team']);
});

test('the seven dormant soccer sections DO NOT render for gridiron', () => {
  const page = strip(src('app/player/[slug]/page.js'));
  const gridiron = page.slice(page.indexOf('async function GridironPlayer'),
                             page.indexOf('export default async function PlayerPage'));
  assert.doesNotMatch(gridiron, /DormantSection/, 'gridiron must not render a dormant section');
  for (const word of ['Outlook', 'Awards', 'Trajectory', 'Tournament']) {
    assert.ok(!gridiron.includes(word), `${word} is inapplicable to a gridiron player`);
  }
  // Soccer still has all seven - removed for one league, not deleted.
  assert.ok((page.match(/DormantSection/g) ?? []).length >= 7, 'soccer keeps its dormant sections');
});

test('the hero has NO photo and no placeholder for one', () => {
  const hero = strip(src('components/player/GridironHero.js'));
  assert.doesNotMatch(hero, /photo/i, 'no photo field, no placeholder - brand law');
  assert.doesNotMatch(hero, /<img/);
  // The numeral is the anchor, and it is stroke-only.
  assert.match(hero, /gp-num/);
  assert.match(src('app/player/[slug]/player.css'), /-webkit-text-stroke:2px color-mix\(in srgb, var\(--volt\)/);
  assert.match(src('app/player/[slug]/player.css'), /\.gp-num\{[^}]*color:transparent/);
  // Soccer's hero still uses its photo.
  assert.match(src('components/player/PlayerHero.js'), /photo_url_source/);
});

test('hero chips: rookie is year ONE, and an unknown year renders nothing', () => {
  assert.deepEqual(heroChips({ position: 'TE', positionGroup: 'OFF', experienceYears: 14 })
    .map((c) => c.label), ['TE · Offense', 'Yr 14']);
  const rook = heroChips({ position: 'LB', positionGroup: 'DEF', experienceYears: 1 });
  assert.equal(rook[1].label, 'Rookie');
  assert.equal(rook[1].rookie, true);
  assert.deepEqual(heroChips({ position: 'K', positionGroup: 'ST', experienceYears: null })
    .map((c) => c.label), ['K · Special Teams'], 'no "Yr null"');
});

test('BIO CELLS: college is a cell that is absent, not a blank one', () => {
  // Real stored values: Travis Kelce 196cm / 113.4kg, and CFBD ships no college.
  const nfl = bioCells({ heightCm: 196, weightKg: 113.4, college: 'Cincinnati', jersey: 87 });
  assert.deepEqual(nfl.map((c) => c.k), ['Height', 'Weight', 'College', 'Jersey']);
  assert.equal(nfl[0].v, '6-5', 'the bio strip uses ft-in with a hyphen');
  assert.equal(nfl[1].v, '250 lbs');

  const cfb = bioCells({ heightCm: 185, weightKg: 103.4, college: null, jersey: 44 });
  assert.deepEqual(cfb.map((c) => c.k), ['Height', 'Weight', 'Jersey'], 'no empty College cell');
  // A player with nothing stored gets no strip at all rather than four dashes.
  assert.deepEqual(bioCells({ heightCm: null, weightKg: null, college: null, jersey: null }), []);
});

test('the empty line is the SAME sentence whatever the cause', () => {
  // The reader is owed the state of the player, not the state of our pipeline:
  // a CFB player pre-import and a veteran with no rows read identically.
  const cfb = emptyLogLine({ leagueSlug: 'cfb', experienceYears: 3, seasonYear: 2026 });
  const vet = emptyLogLine({ leagueSlug: 'nfl', experienceYears: 9, seasonYear: 2026 });
  assert.equal(cfb, vet);
  assert.equal(cfb, 'No recorded games yet. The log starts when the season does.');
  // A rookie gets the one sentence that is actually more specific and true.
  assert.match(emptyLogLine({ leagueSlug: 'nfl', experienceYears: 1, seasonYear: 2026 }),
    /^No NFL games yet - 2026 is the rookie season\./);
});

// ---------------------------------------------------------------- columns

test('COLUMNS ARE POSITION-GROUP AWARE, from columns that actually exist', () => {
  assert.equal(columnSetName(columnsFor('QB', 'OFF')), 'passing');
  assert.equal(columnSetName(columnsFor('RB', 'OFF')), 'rushing');
  assert.equal(columnSetName(columnsFor('WR', 'OFF')), 'receiving');
  assert.equal(columnSetName(columnsFor('TE', 'OFF')), 'receiving');
  assert.equal(columnSetName(columnsFor('K', 'ST')), 'kicking');
  for (const p of ['LB', 'CB', 'DE', 'DT', 'S']) {
    assert.equal(columnSetName(columnsFor(p, 'DEF')), 'defense', p);
  }
});

test('NO INVENTED COLUMN: the schema has no tackles and no TFL', () => {
  // The mock's defensive header reads Tkl/TFL/Sacks/INT. Two of those four are
  // columns nfl_player_game_stats has never held. Measured over 42,684
  // defensive rows: sacks 42,452 · def_int 1,676 · fr 1,306 · def_td 282.
  const keys = COLUMN_SETS.defense.map((c) => c.key);
  assert.deepEqual(keys, ['sacks', 'def_int', 'fr', 'def_td']);
  for (const invented of ['tkl', 'tackles', 'tfl', 'solo', 'ast']) {
    assert.ok(!keys.includes(invented), `${invented} is not a column in this database`);
  }
  // Every key in every set must be a real column name, per migration/schema.
  const REAL = new Set(['pass_cmp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int',
    'rush_att', 'rush_yds', 'rush_td', 'tgt', 'rec', 'rec_yds', 'rec_td',
    'fumbles_lost', 'fgm', 'fga', 'fg_long', 'xp', 'sacks', 'def_int', 'fr', 'def_td']);
  for (const [name, set] of Object.entries(COLUMN_SETS)) {
    for (const c of set) assert.ok(REAL.has(c.key), `${name}.${c.key} is not a real column`);
  }
});

test('a position with no counting stats gets NO table rather than empty columns', () => {
  // An offensive lineman, a punter and a long snapper have no vocabulary here.
  for (const [pos, grp] of [['OL', 'OFF'], ['C', 'OFF'], ['LS', 'OFF'], ['P', 'ST']]) {
    assert.equal(columnsFor(pos, grp), null, `${pos} must not get a stat table`);
  }
});

test('decimals are real where they are real, and never where they are not', () => {
  const sacks = COLUMN_SETS.defense[0];
  const ints = COLUMN_SETS.defense[1];
  assert.equal(formatStat(sacks, 40.5), '40.5');
  assert.equal(formatStat(sacks, 3), '3.0', 'a sack column speaks in halves');
  assert.equal(formatStat(ints, 3), '3');
  assert.equal(formatStat(ints, 3.0), '3', 'a count column never shows a decimal');
  assert.equal(formatStat({ key: 'rec_yds' }, 12140), '12,140');
  assert.equal(formatStat(ints, null), '—');
});

// ---------------------------------------------------------------- totals

test('CONSERVATION: career equals the sum of the seasons', () => {
  // Hand-run against PROD for Travis Kelce (bdl 835), 175 games over 11 seasons:
  //   SELECT sum(tgt), sum(rec), sum(rec_yds), sum(rec_td) ... -> 1421/1013/12140/77
  // These are the SQL's numbers, not the code's own output, and not the mock's.
  const seasons = [
    { season: 2025, tgt: 700, rec: 500, rec_yds: 6000, rec_td: 40 },
    { season: 2024, tgt: 721, rec: 513, rec_yds: 6140, rec_td: 37 },
  ];
  const career = careerFrom(seasons, COLUMN_SETS.receiving);
  assert.deepEqual(career, { tgt: 1421, rec: 1013, rec_yds: 12140, rec_td: 77 });
});

test('NULL IS NOT ZERO in the career row', () => {
  // Number(null) is 0 and 0 is finite, so a plain isFinite check counted absent
  // values as real zeros. Demario Davis has no defensive touchdown in any
  // season: every season row rendered "—" and the career row rendered "0".
  // SUM ignores nulls and returns null when they are all null; so does this.
  const seasons = [{ sacks: 0.5, def_int: null, fr: 1, def_td: null },
                   { sacks: 2.0, def_int: 1, fr: null, def_td: null }];
  const career = careerFrom(seasons, COLUMN_SETS.defense);
  assert.equal(career.def_td, null, 'all-null must stay null, not become 0');
  assert.equal(formatStat(COLUMN_SETS.defense[3], career.def_td), '—');
  assert.equal(career.def_int, 1, 'a real value among nulls still counts');
  assert.equal(career.fr, 1);
  // And floating point must not turn halves into 1.4999999999999998.
  assert.equal(career.sacks, 2.5);
});

test('fg_long is a MAX across seasons, not a sum', () => {
  const seasons = [{ fgm: 20, fga: 24, fg_long: 55, xp: 30 },
                   { fgm: 18, fga: 22, fg_long: 48, xp: 28 }];
  const career = careerFrom(seasons, COLUMN_SETS.kicking);
  assert.equal(career.fg_long, 55, 'a career long is the longest, not the total');
  assert.equal(career.fgm, 38);
});

test('the bdl bridge reads the id, and refuses junk', () => {
  assert.equal(bdlIdOf({ external_ids: { bdl_player_id: '835' } }), 835);
  assert.equal(bdlIdOf({ external_ids: { cfbd_player_id: '4917305' } }), null,
    'a CFB player has no bdl id and must not borrow one');
  assert.equal(bdlIdOf({ external_ids: null }), null);
  assert.equal(bdlIdOf({}), null);
  assert.equal(bdlIdOf(null), null);
});

test('NO TOTALS TABLE IS CREATED - totals are a read', () => {
  const s = strip(src('lib/gridiron/playerStats.js'));
  assert.doesNotMatch(s, /CREATE TABLE|INSERT INTO|UPDATE /i, 'this module only reads');
  assert.match(s, /FROM nfl_player_game_stats s/);
  assert.match(s, /JOIN nfl_players np ON np\.id = s\.nfl_player_id/);
  assert.match(s, /np\.bdl_player_id = \$1/, 'the bridge is the bdl id');
});

test('the game log labels the side from the STAT ROW team, not the current one', () => {
  // A player traded mid-season has rows on both teams; reading his current team
  // would mislabel every game before the trade as home or away wrongly.
  const s = strip(src('lib/gridiron/playerStats.js'));
  assert.match(s, /const home = r\.team_id != null && r\.team_id === r\.home_team_id;/);
});

// ---------------------------------------------------------------- link-back

test('LINK-BACK: roster rows now link, and the old promise is retired', () => {
  const roster = src('components/team/GridironRoster.js');
  const code = strip(roster);
  // The inversion: the row IS the anchor.
  assert.match(code, /<a className="gr-row" href=\{`\/player\/\$\{p\.slug\}`\}>/);
  assert.match(code, /<\/a>/);
  assert.doesNotMatch(code, /<div className="gr-row">/, 'the row is no longer a div');
  // The comment that called a link a promise to a 404 must be gone - it stopped
  // being true with this commit.
  assert.doesNotMatch(roster, /promise to a 404/);
  assert.match(roster, /ROWS LINK/);
  // Soccer's squad list is untouched and still links the way it always did.
  assert.match(src('components/team/SquadList.js'), /href=\{`\/player\/\$\{player\.slug\}`\}/);
});

test('the gridiron arm is a separate function, so soccer is untouched', () => {
  const page = src('app/player/[slug]/page.js');
  assert.match(page, /if \(isGridiron\(player\.league_slug\)\) \{/);
  // The gate returns before any soccer read runs. Measured from the CALL site,
  // not the import - `getPlayerGroupFixtures` appears in the import block at the
  // top of the file, which sits above everything and made this compare two
  // unrelated positions.
  const body = page.slice(page.indexOf('export default async function PlayerPage'));
  const gate = body.indexOf('if (isGridiron(player.league_slug))');
  const soccerRead = body.indexOf('await getPlayerGroupFixtures(');
  assert.ok(gate >= 0 && soccerRead > gate,
    'the gridiron path must return before soccer-only reads');
  assert.equal(isGridiron('nfl'), true);
  assert.equal(isGridiron('cfb'), true);
  assert.equal(isGridiron('fifa-wc-2026'), false);
});
