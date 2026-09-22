// lib/mlb/league.test.mjs - the league row, the thirty clubs, the colours.
//
// THE ABBREVIATION SET IS MEASURED, NOT ASSUMED. It was read off
// /mlb/v1/teams on 22 Sep 2026 and is pinned here as a literal, because the
// colour table joins on it and a wrong key matches no team and renders the club
// as a bare abbreviation disc - which looks like a missing logo, not like a
// bug. Writing this test is how CHW was found: the table said CWS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mlbColorRows, MLB_COLORS } from './teamColors.js';
import { shapeMlbTeams, mlbLeagueRow, MLB_LEAGUE_SLUG } from './sync.js';
import { sportOf, BASEBALL } from '../live/vocabulary.js';
import { readFileSync } from 'node:fs';

/** Verbatim from /mlb/v1/teams, 22 Sep 2026. */
const FEED_ABBRS = [
  'ARI', 'ATL', 'BAL', 'BOS', 'CHC', 'CHW', 'CIN', 'CLE', 'COL', 'DET',
  'HOU', 'KC', 'LAA', 'LAD', 'MIA', 'MIL', 'MIN', 'NYM', 'NYY', 'OAK',
  'PHI', 'PIT', 'SD', 'SEA', 'SF', 'STL', 'TB', 'TEX', 'TOR', 'WSH',
];
const FEED_ROW = {
  id: 3, slug: 'baltimore-orioles', abbreviation: 'BAL',
  display_name: 'Baltimore Orioles', short_display_name: 'Orioles',
  name: 'Orioles', location: 'Baltimore', league: 'American', division: 'East',
};

test('THE COLOUR TABLE COVERS EVERY CLUB THE FEED HAS, and invents none', () => {
  const table = Object.keys(MLB_COLORS).sort();
  assert.equal(table.length, 30);
  assert.deepEqual(table, [...FEED_ABBRS].sort(),
    'a club in the feed with no colour renders as a bare disc; a colour for a club that does not exist is a typo');
  // CHW, NOT CWS - the one the first draft got wrong.
  assert.ok('CHW' in MLB_COLORS);
  assert.equal('CWS' in MLB_COLORS, false);
});

test('EVERY PAIR IS A VALID, DISTINGUISHABLE PAIR', () => {
  const rows = mlbColorRows();
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((r) => r.abbreviation)).size, 30);
  for (const r of rows) {
    assert.match(r.primary, /^#[0-9A-F]{6}$/, r.abbreviation);
    assert.match(r.secondary, /^#[0-9A-F]{6}$/, r.abbreviation);
    // A club whose two marks are the same colour renders as a flat disc and
    // the secondary does nothing - thirty hand-typed pairs is exactly where
    // that slip lives.
    assert.notEqual(r.primary, r.secondary, r.abbreviation);
  }
  // Sorted, so a diff of this table is readable.
  assert.deepEqual(rows.map((r) => r.abbreviation), [...FEED_ABBRS].sort());
});

test('THE LEAGUE ROW IS baseball, and the two halves agree by construction', () => {
  const l = mlbLeagueRow();
  assert.equal(l.slug, MLB_LEAGUE_SLUG);
  assert.equal(l.slug, 'mlb');
  assert.equal(l.sport, 'baseball');
  // sportOf('mlb') is what every live surface will switch on. If the league
  // row said one thing and the vocabulary another, the card and the database
  // would disagree about what sport this is - so the row TAKES its sport from
  // the vocabulary rather than repeating it.
  assert.equal(l.sport, sportOf('mlb'));
  assert.equal(l.sport, BASEBALL);
  assert.equal(l.seasonType, 'season-and-postseason', 'the shape the NFL row already uses');
  assert.deepEqual(l.externalIds, { bdl_sport: 'mlb' });
  assert.equal(l.shortName, 'MLB');
});

test('THE TEAM SHAPE TAKES THE FEED\'S OWN SLUG and maps league/division', () => {
  const { teams, rejected } = shapeMlbTeams([FEED_ROW]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(teams[0], {
    slug: 'baltimore-orioles',
    abbreviation: 'BAL',
    name: 'Baltimore Orioles',
    shortName: 'Orioles',
    conference: 'American',
    division: 'East',
    externalIds: { bdl_team_id: '3' },
  });
  // The slug is the FEED'S - it already matches this database's convention
  // ("pittsburgh-steelers"), so deriving our own would reach the same string
  // by a longer route and drift the first time a club is renamed.
  assert.equal(teams[0].slug, FEED_ROW.slug);
});

test('A ROW MISSING A JOIN KEY IS REPORTED, NEVER WRITTEN', () => {
  // slug and abbreviation are both join keys downstream - the poller matches
  // on external_ids, the colour table on abbreviation - and a null in either
  // is a team that silently never matches anything again.
  const { teams, rejected } = shapeMlbTeams([
    FEED_ROW,
    { ...FEED_ROW, slug: '', id: 4 },
    { ...FEED_ROW, abbreviation: null, id: 5 },
    { ...FEED_ROW, id: null },
  ]);
  assert.equal(teams.length, 1);
  assert.equal(rejected.length, 3, 'each refusal is named rather than skipped in silence');
  assert.deepEqual(shapeMlbTeams([]), { teams: [], rejected: [] });
  assert.deepEqual(shapeMlbTeams(), { teams: [], rejected: [] });
});

test('THE UPSERTS NAME THE CONFLICT TARGETS THAT ACTUALLY EXIST', () => {
  // teams is unique on (league_id, slug), NOT on slug - slugs repeat across
  // leagues, 'senegal' three times over. ON CONFLICT (slug) names no unique
  // index and throws on the first row, which is a failure at write time on a
  // path that only runs once a season. leagues IS unique on slug alone.
  const src = readFileSync(new URL('./sync.js', import.meta.url), 'utf8')
    .replace(/--.*$/gm, '');
  assert.match(src, /INSERT INTO teams[\s\S]*?ON CONFLICT \(league_id, slug\)/);
  assert.equal(/INSERT INTO teams[\s\S]*?ON CONFLICT \(slug\)/.test(src), false,
    'teams has no unique index on slug alone');
  assert.match(src, /INSERT INTO leagues[\s\S]*?ON CONFLICT \(slug\)/);
  // AND BOTH MERGE external_ids RATHER THAN REPLACING. A second provider
  // added later must survive a re-run of this one - the shallow-merge trap,
  // at exactly the depth these objects have.
  assert.match(src, /external_ids = teams\.external_ids \|\| EXCLUDED\.external_ids/);
  assert.match(src, /external_ids = leagues\.external_ids \|\| EXCLUDED\.external_ids/);
});
