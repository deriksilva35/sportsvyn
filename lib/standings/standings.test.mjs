// lib/standings/standings.test.mjs — the standings store and its three dialects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRecordRow as cfbRow, SPLIT_MAP } from './cfb.js';
import { toRecordRow as nflRow, parseRecord, seasonTypeFor } from './nfl.js';
import { toTableRow } from './epl.js';
import { formatRecord } from './read.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const MIG = src('migrations/079_standings.sql');
// SQL COMMENTS STRIPPED BEFORE ANY ABSENCE ASSERTION. The migration explains
// at length WHY there is no shared `points` column and no season_type on
// league_tables - and a naive grep flags that prose as the thing it forbids.
// Three of these tests failed on their own documentation before this line
// existed.
const SQL_ONLY = MIG.replace(/--[^\n]*/g, '');

// Verbatim payloads captured 30 Aug 2026.
const CFBD_ROW = {
  year: 2026, teamId: 2, team: 'Auburn', classification: 'fbs', conference: 'SEC',
  division: '', expectedWins: 0,
  total: { games: 1, wins: 1, losses: 0, ties: 0 },
  conferenceGames: { games: 0, wins: 0, losses: 0, ties: 0 },
  homeGames: { games: 1, wins: 1, losses: 0, ties: 0 },
  awayGames: { games: 0, wins: 0, losses: 0, ties: 0 },
  neutralSiteGames: { games: 0, wins: 0, losses: 0, ties: 0 },
  regularSeason: { games: 1, wins: 1, losses: 0, ties: 0 },
  postseason: { games: 0, wins: 0, losses: 0, ties: 0 },
};
const BDL_ROW = {
  team: { id: 4, conference: 'AFC', division: 'EAST', abbreviation: 'NYJ' },
  win_streak: -1, points_for: 39, points_against: 47, playoff_seed: 8,
  point_differential: -8, overall_record: '1-2', conference_record: '1-0',
  division_record: '0-0', wins: 1, losses: 2, ties: 0,
  home_record: '0-2', road_record: '1-0', season: 2026,
};
const APISPORTS_ROW = {
  rank: 1, team: { id: 50, name: 'Manchester City' }, points: 6, goalsDiff: 4,
  group: 'Premier League', form: 'WW', status: 'same',
  description: 'Promotion - Champions League (League phase)',
  all: { played: 2, win: 2, draw: 0, lose: 0, goals: { for: 6, against: 2 } },
  home: { played: 1, win: 1, draw: 0, lose: 0, goals: { for: 2, against: 1 } },
  away: { played: 1, win: 1, draw: 0, lose: 0, goals: { for: 4, against: 1 } },
  update: '2026-08-30T00:00:00+00:00',
};

// --------------------------------------------- the schema, and why it is two

test('TWO TABLES, and `points` never means two things', () => {
  assert.match(MIG, /CREATE TABLE IF NOT EXISTS team_records/);
  assert.match(MIG, /CREATE TABLE IF NOT EXISTS league_tables/);
  const records = SQL_ONLY.slice(SQL_ONLY.indexOf('CREATE TABLE IF NOT EXISTS team_records'),
    SQL_ONLY.indexOf('CREATE TABLE IF NOT EXISTS league_tables'));
  // The CREATE body only - the trailing COMMENT ON COLUMN statements name
  // points_for on purpose, to point a reader at the other table.
  const tablesBody = SQL_ONLY.slice(SQL_ONLY.indexOf('CREATE TABLE IF NOT EXISTS league_tables'),
    SQL_ONLY.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS league_tables_uniq'));
  const recordsBody = records.slice(0, records.indexOf('CREATE UNIQUE INDEX'));
  // The collision the census proved: EPL points = table points, NFL points =
  // points scored. team_records must NOT carry a bare `points` column.
  assert.doesNotMatch(recordsBody, /^\s+points\s+integer/m,
    'team_records must use points_for / points_against, never a bare points');
  assert.match(recordsBody, /points_for\s+integer/);
  assert.match(recordsBody, /points_against\s+integer/);
  assert.match(tablesBody, /points\s+integer NOT NULL/);
  assert.doesNotMatch(tablesBody, /points_for/);
});

test('season_type is REQUIRED and constrained', () => {
  assert.match(MIG, /season_type\s+text\s+NOT NULL\s*\n?\s*CHECK \(season_type IN \('preseason', 'regular', 'postseason'\)\)/);
  // And it is part of the key, so preseason cannot overwrite regular.
  assert.match(MIG, /team_records_uniq[\s\S]*?ON team_records \(league_id, team_id, season, season_type\)/);
});

test('LEAGUE-AGNOSTIC: no schema field names a sport or a league', () => {
  const decls = SQL_ONLY.split('\n').filter((l) => /^\s{2}\w+\s+(integer|text|timestamptz|serial)/.test(l));
  for (const d of decls) {
    assert.doesNotMatch(d, /\b(nfl|cfb|epl|mlb|nba|nhl|football|soccer)\b/i,
      `a column may not name a league: ${d.trim()}`);
  }
  assert.match(MIG, /league_id\s+integer NOT NULL REFERENCES leagues\(id\)/);
});

test('league_tables has NO season_type - a table is the table', () => {
  const tables = SQL_ONLY.slice(SQL_ONLY.indexOf('CREATE TABLE IF NOT EXISTS league_tables'));
  assert.doesNotMatch(tables.slice(0, tables.indexOf('CREATE UNIQUE')), /season_type/);
  assert.match(MIG, /league_tables_uniq[\s\S]*?ON league_tables \(league_id, team_id, season\)/);
});

// ------------------------------------------------------------- CFB dialect

test('CFBD splits map to their column trios, and total drives wins/losses', () => {
  const r = cfbRow(CFBD_ROW, { teamId: 7, leagueId: 3 });
  assert.equal(r.wins, 1); assert.equal(r.losses, 0); assert.equal(r.ties, 0);
  assert.equal(r.home_wins, 1); assert.equal(r.away_wins, 0);
  assert.equal(r.neutral_wins, 0);
  assert.equal(r.classification, 'fbs');
  assert.equal(r.conference, 'SEC');
  assert.equal(r.division, null, 'an empty-string division stores as NULL');
  assert.equal(r.season_type, 'regular');
  assert.equal(r.data_provider, 'cfbd');
});

test('A MISSING SPLIT BLOCK IS NULL, NOT ZERO', () => {
  // Zero means "played none and won none"; null means "not reported". A CFBD
  // row without neutralSiteGames must not claim an 0-0 neutral record.
  const { neutralSiteGames, ...without } = CFBD_ROW;
  const r = cfbRow(without, { teamId: 7, leagueId: 3 });
  assert.equal(r.neutral_wins, null);
  assert.equal(r.neutral_losses, null);
});

test('a row with no total block is unusable and returns null', () => {
  const { total, ...without } = CFBD_ROW;
  assert.equal(cfbRow(without, { teamId: 7, leagueId: 3 }), null);
});

test('an unmapped provider block is COUNTED, never dropped in silence', () => {
  const unmapped = [];
  cfbRow({ ...CFBD_ROW, springGames: { wins: 1 } }, { teamId: 7, leagueId: 3, unmapped });
  assert.ok(unmapped.includes('springGames'));
  assert.equal(Object.keys(SPLIT_MAP).length, 5);
});

// ------------------------------------------------------------- NFL dialect

test('THE CALENDAR DECIDES season_type, not the endpoint', () => {
  const regStart = '2026-09-10T00:20:00Z';
  assert.equal(seasonTypeFor('2026-08-30T12:00:00Z', regStart), 'preseason');
  assert.equal(seasonTypeFor('2026-09-10T01:00:00Z', regStart), 'regular');
  assert.equal(seasonTypeFor('2026-09-09T23:00:00Z', regStart), 'preseason');
});

test('NO SCHEDULE, NO LABEL - it refuses rather than guessing "regular"', () => {
  assert.equal(seasonTypeFor('2026-08-30T12:00:00Z', null), null);
  const NFL = src('lib/standings/nfl.js');
  assert.match(NFL, /if \(seasonType == null\) \{ summary\.reason = 'no-regular-schedule-held'; return summary; \}/);
});

test('the preseason trap is documented where the gate lives', () => {
  const NFL = src('lib/standings/nfl.js');
  assert.match(NFL, /documented as regular-season|docs say .*regular|"regular season team standings"/i);
  assert.match(NFL, /49 games league-wide|preseason/i);
});

test('record strings parse, including the tie form', () => {
  assert.deepEqual(parseRecord('1-2'), [1, 2, 0]);
  assert.deepEqual(parseRecord('10-6-1'), [10, 6, 1]);
  assert.deepEqual(parseRecord(''), [null, null, null]);
  assert.deepEqual(parseRecord(null), [null, null, null]);
  assert.deepEqual(parseRecord('garbage'), [null, null, null]);
});

test('BDL row maps, and the streak keeps its SIGN', () => {
  const r = nflRow(BDL_ROW, { teamId: 9, leagueId: 2, season: 2026, seasonType: 'preseason' });
  assert.equal(r.wins, 1); assert.equal(r.losses, 2); assert.equal(r.ties, 0);
  assert.equal(r.conf_wins, 1); assert.equal(r.conf_losses, 0);
  assert.equal(r.home_wins, 0); assert.equal(r.home_losses, 2);
  assert.equal(r.away_wins, 1);
  assert.equal(r.streak, -1, 'a losing streak stays negative');
  assert.equal(r.points_for, 39);
  assert.equal(r.playoff_seed, 8);
  assert.equal(r.conference, 'AFC'); assert.equal(r.division, 'EAST');
  assert.equal(r.season_type, 'preseason');
  assert.equal(r.neutral_wins, null, 'NFL sends no neutral split - null, not 0');
});

// ------------------------------------------------------------- EPL dialect

test('API-Sports row maps to the table shape', () => {
  const r = toTableRow(APISPORTS_ROW, { teamId: 11, leagueId: 5, season: 2026 });
  assert.equal(r.rank, 1); assert.equal(r.played, 2);
  assert.equal(r.win, 2); assert.equal(r.draw, 0); assert.equal(r.lose, 0);
  assert.equal(r.goals_for, 6); assert.equal(r.goals_against, 2);
  assert.equal(r.goal_diff, 4);
  assert.equal(r.points, 6);
  assert.equal(r.form, 'WW');
  assert.equal(r.movement_status, 'same');
  assert.match(r.qualification_description, /Champions League/);
  assert.equal(r.group_name, 'Premier League');
});

test('THE `update` FIELD IS DISCARDED - it is not a freshness signal', () => {
  const r = toTableRow(APISPORTS_ROW, { teamId: 11, leagueId: 5, season: 2026 });
  assert.equal(r.update, undefined);
  assert.ok(!Object.keys(r).some((k) => /update/i.test(k) && k !== 'data_provider_synced_at'));
  const EPL = src('lib/standings/epl.js');
  // Measured: stamped midnight while carrying 15:00Z results the same day.
  assert.match(EPL, /midnight/i);
  assert.match(EPL, /not a freshness signal/i);
});

test('goal_diff is the PROVIDER\'s, not recomputed', () => {
  // A points/goals deduction would make for-minus-against disagree with the
  // published table; the provider's number is what the table is sorted by.
  const r = toTableRow({ ...APISPORTS_ROW, goalsDiff: 99 }, { teamId: 1, leagueId: 1, season: 2026 });
  assert.equal(r.goal_diff, 99);
});

// ------------------------------------------------------------- the reader

test('PRESEASON IS NEVER "THE RECORD" - the reader enforces it', () => {
  const READ = src('lib/standings/read.js');
  assert.match(READ, /tr\.season_type = 'regular'/);
  const get = READ.slice(READ.indexOf('export async function getTeamRecord'),
    READ.indexOf('export async function getLeagueRecords'));
  assert.match(get, /season_type = 'regular'/,
    'the single-team reader must filter to regular season');
  const all = READ.slice(READ.indexOf('export async function getLeagueRecords'),
    READ.indexOf('export async function getLeagueTable'));
  assert.match(all, /season_type = 'regular'/);
});

test('formatRecord shows a tie column only when there is a tie', () => {
  assert.equal(formatRecord(9, 3, 0), '9-3');
  assert.equal(formatRecord(9, 3, 1), '9-3-1');
  assert.equal(formatRecord(null, 3, 0), null);
});

test('the reader is pure of JSX', () => {
  const READ = src('lib/standings/read.js');
  assert.doesNotMatch(READ, /<\/?[A-Za-z]+[\s/>]/, 'no markup in a reader');
});

// ------------------------------------------------------------- the crons

test('the two standings crons are hourly and share no tick', () => {
  const V = JSON.parse(src('vercel.json'));
  const cfb = V.crons.find((c) => c.path === '/api/cron/standings-cfb');
  const nfl = V.crons.find((c) => c.path === '/api/cron/standings-nfl');
  assert.equal(cfb.schedule, '20 * * * *');
  assert.equal(nfl.schedule, '21 * * * *');
  const minute = (s) => s.split(' ')[0];
  assert.notEqual(minute(cfb.schedule), minute(nfl.schedule));
  // and clear of cfb-rankings
  const ranks = V.crons.find((c) => c.path === '/api/cron/cfb-rankings');
  assert.notEqual(minute(cfb.schedule), minute(ranks.schedule));
  assert.notEqual(minute(nfl.schedule), minute(ranks.schedule));
});

test('both crons ledger through recordRun like every other sync', () => {
  for (const f of ['app/api/cron/standings-cfb/route.js', 'app/api/cron/standings-nfl/route.js']) {
    const R = src(f);
    assert.match(R, /recordRun\(sql, \{/);
    assert.match(R, /withAdvisoryLock\(SOURCE/);
    assert.match(R, /cronAuthorized\(request\)/);
    assert.match(R, /maybeAlert\(sql, \{/);
  }
});
