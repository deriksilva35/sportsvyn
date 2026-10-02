// lib/soccer/ucl.test.mjs - THE CHAMPIONS LEAGUE (ucl, fri-3): the registry,
// the round rules over the recorded 2026-27 season, the league-phase bands,
// and the import + table sync driven from recorded payloads into a SENTINEL
// league on DEV (zz-ucl-<pid>), run twice to prove it idempotent, torn down
// and the teardown asserted.
//
// The payloads are API-Sports responses recorded on 2 Oct 2026
// (testdata/ucl/): /leagues?id=2, /fixtures?league=2&season=2026,
// /standings?league=2&season=2026, /teams?league=2&season=2026, and
// /fixtures/rounds?league=2&season=2025 for the knockout round names.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from '../db.js';
import {
  SOCCER_LEAGUES, SOCCER_SLUGS, soccerLeague, isSoccerSlug, roundOf, uclBand, UCL_STAGE_NAME, matchHref, standingsHref,
} from './leagues.js';
import { syncSoccerLeague, fixtureRound } from './epl.js';
import { syncSoccerStandings, getSoccerStandings, toStandingRow } from './standings.js';
import { roundLabelFor } from './roundLabel.js';
import { sportOf, SOCCER } from '../live/vocabulary.js';
import { orderFor } from '../gridiron/teamOrder.js';
import { SPORTS, SPORTS_WHEN_PRESENT, sportChipShown } from '../scores/v4.js';
import { LEAGUE_LABEL } from '../gridiron/scoresV2Shape.js';
import { contentAllowedForLeague } from './contentGate.js';
import { isRetiredLeague } from '../retired.js';

const rec = (f) => JSON.parse(readFileSync(new URL(`./testdata/ucl/${f}`, import.meta.url), 'utf8'));
const LEAGUES = rec('leagues-id2.json');
const FIXTURES = rec('fixtures-2026.json').response;
const STANDINGS = rec('standings-2026.json');
const TEAMS = rec('teams-2026.json').response;
const ROUNDS_2025 = rec('rounds-2025.json').response;

// ---------------------------------------------------------------------------
// THE PLAN COVERS IT (the read-only check, recorded)
// ---------------------------------------------------------------------------

test('THE PLAN: league 2 is the Champions League, season 2026 is current, and every flag we read is on', () => {
  const l = LEAGUES.response[0];
  assert.equal(l.league.id, 2);
  assert.equal(l.league.name, 'UEFA Champions League');
  const s = l.seasons.find((x) => x.year === 2026);
  assert.ok(s, 'season 2026 exists');
  assert.equal(s.current, true);
  assert.equal(s.coverage.fixtures.events, true);
  assert.equal(s.coverage.fixtures.lineups, true);
  assert.equal(s.coverage.fixtures.statistics_fixtures, true);
  assert.equal(s.coverage.standings, true);
  assert.equal(s.coverage.players, true);
  assert.ok(FIXTURES.length > 144, `fixtures exist (${FIXTURES.length})`);
});

// ---------------------------------------------------------------------------
// THE REGISTRY
// ---------------------------------------------------------------------------

test('the registry: epl (39) and ucl (2), both 2026, one entry each', () => {
  assert.deepEqual(SOCCER_SLUGS, ['epl', 'ucl']);
  assert.equal(soccerLeague('ucl').apiId, 2);
  assert.equal(soccerLeague('epl').apiId, 39);
  for (const l of SOCCER_LEAGUES) assert.equal(l.season, 2026, `${l.slug} keyed by its opening year`);
  assert.equal(soccerLeague('nfl'), null);
  assert.equal(isSoccerSlug('ucl'), true); assert.equal(isSoccerSlug('mlb'), false);
  assert.equal(matchHref('ucl', 'a-vs-b-2026-09-08'), '/ucl/match/a-vs-b-2026-09-08');
  assert.equal(standingsHref('ucl'), '/ucl/standings');
});

test('the UCL is soccer everywhere a league is sorted: home first, soccer vocabulary, UCL label, chip only when present', () => {
  assert.equal(sportOf('ucl'), SOCCER, 'never the football default');
  assert.deepEqual(orderFor('ucl'), ['home', 'away']);
  assert.equal(LEAGUE_LABEL.ucl, 'UCL');
  assert.ok(SPORTS.some(([k, l]) => k === 'ucl' && l === 'UCL'));
  assert.ok(SPORTS_WHEN_PRESENT.includes('ucl'));
  assert.equal(sportChipShown('ucl', { leagues: ['nfl', 'mlb'] }), false, 'no UCL games, no chip');
  assert.equal(sportChipShown('ucl', { leagues: ['ucl'] }), true);
  assert.equal(sportChipShown('ucl', { leagues: [], selected: 'ucl' }), true, 'a ?sport=ucl link can be undone');
  assert.equal(contentAllowedForLeague('ucl'), false, 'no model spend, no odds');
  assert.equal(isRetiredLeague('ucl'), false);
});

// ---------------------------------------------------------------------------
// ROUNDS
// ---------------------------------------------------------------------------

test('every recorded 2026 round is classified: 8 league-phase matchdays carried, qualifying not, nothing unknown', () => {
  const by = { carried: 0, skip: 0, unknown: [] };
  for (const f of FIXTURES) {
    const r = roundOf('ucl', f.league.round);
    if (r.skip) by.skip += 1;
    else if (r.unknown) by.unknown.push(f.league.round);
    else by.carried += 1;
  }
  assert.deepEqual(by.unknown, []);
  assert.equal(by.carried, 144, '36 clubs x 8 matchdays / 2');
  assert.equal(by.skip, FIXTURES.length - 144);
  assert.deepEqual(roundOf('ucl', 'League Stage - 3'), { week: 3, stage: 'league' });
});

test('the knockout names the provider used for 2025-26 all map to a stage, and read as a reader says them', () => {
  const ko = ROUNDS_2025.filter((r) => !/League Stage|Qualifying|^Play-offs$/.test(r));
  assert.deepEqual(ko, ['Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final']);
  const labels = ko.map((r) => roundLabelFor('ucl', roundOf('ucl', r)));
  assert.deepEqual(labels, ['Knockout play-off', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final']);
  for (const r of ROUNDS_2025) assert.equal(roundOf('ucl', r).unknown, undefined, `${r} is ruled on`);
  assert.equal(roundOf('ucl', 'Super Round - 1').unknown, true, 'an unknown round is reported, not guessed');
  assert.deepEqual(Object.keys(UCL_STAGE_NAME), ['playoff', 'r16', 'qf', 'sf', 'final']);
});

test('the EPL keeps its old rule through fixtureRound: every fixture, week or null', () => {
  assert.deepEqual(fixtureRound('epl', 'Regular Season - 6'), { week: 6, stage: null });
  assert.deepEqual(fixtureRound('epl', 'Something else'), { week: null, stage: null });
});

// ---------------------------------------------------------------------------
// THE TABLE'S BANDS
// ---------------------------------------------------------------------------

test('the league-phase bands, by rank: 1-8 round of 16, 9-24 play-off, 25-36 out', () => {
  assert.equal(uclBand(1), 'r16'); assert.equal(uclBand(8), 'r16');
  assert.equal(uclBand(9), 'playoff'); assert.equal(uclBand(24), 'playoff');
  assert.equal(uclBand(25), 'out'); assert.equal(uclBand(36), 'out');
  assert.equal(uclBand(0), null); assert.equal(uclBand(null), null);
});

test('the bands agree with the provider\'s own prose on the recorded table', () => {
  const rows = STANDINGS.response[0].league.standings[0];
  assert.equal(rows.length, 36);
  for (const r of rows) {
    const d = String(r.description ?? '');
    const band = uclBand(r.rank);
    if (band === 'r16') assert.match(d, /1\/8-finals/, `rank ${r.rank}`);
    else if (band === 'playoff') assert.match(d, /1\/16-finals/, `rank ${r.rank}`);
    else assert.equal(r.description, null, `rank ${r.rank}`);
  }
  assert.equal(toStandingRow(rows[0]).team, rows[0].team.name);
});

// ---------------------------------------------------------------------------
// THE IMPORT, ON DEV, INTO A SENTINEL LEAGUE
// ---------------------------------------------------------------------------

const STORE = `zz-ucl-${process.pid}`;
const client = { teams: async () => TEAMS, fixtures: async () => FIXTURES };
const fetchJson = async () => STANDINGS;
let leagueId = null;

before(async () => {
  // A previous killed run of THIS pid cannot exist; a sentinel with this slug would be ours.
  const old = await sql`SELECT id FROM leagues WHERE slug = ${STORE}`;
  assert.equal(old.length, 0, 'no sentinel league before the run');
});

after(async () => {
  const lg = await sql`SELECT id FROM leagues WHERE slug = ${STORE}`;
  for (const { id } of lg) {
    await sql`DELETE FROM matches WHERE league_id = ${id}`;
    await sql`DELETE FROM teams WHERE league_id = ${id}`;
    await sql`DELETE FROM leagues WHERE id = ${id}`;
  }
  const left = await sql`
    SELECT (SELECT count(*)::int FROM leagues WHERE slug = ${STORE}) AS l,
           (SELECT count(*)::int FROM teams WHERE league_id = ${leagueId ?? -1}) AS t,
           (SELECT count(*)::int FROM matches WHERE league_id = ${leagueId ?? -1}) AS m`;
  assert.deepEqual(left[0], { l: 0, t: 0, m: 0 }, 'the sentinel league, its clubs and its fixtures are gone');
});

test('DEV IMPORT: 36 clubs, 144 fixtures (MD1 final, the rest scheduled), qualifying not carried - and a second run changes nothing', async () => {
  const first = await syncSoccerLeague('ucl', { client, sql, storeAs: STORE });
  leagueId = first.leagueId;
  assert.equal(first.teams, 36, 'only the clubs in carried fixtures');
  assert.equal(first.fixtures, 144);
  assert.equal(first.skipped, 0, JSON.stringify(first.skippedReasons));
  assert.equal(first.notCarried, FIXTURES.length - 144);
  assert.equal(first.requests, 2);

  const snap = async () => sql`
    SELECT m.slug, m.status, m.week, m.stage, m.home_score, m.away_score, m.external_ids->>'api_sports' AS fx,
           h.name AS home, a.name AS away, h.color_primary AS c1
      FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.league_id = ${leagueId} ORDER BY m.kickoff_at, m.id`;
  const before1 = await snap();
  assert.equal(before1.length, 144);
  assert.equal(before1.filter((r) => r.week === 1 && r.status === 'final').length, 18, 'MD1 is in');
  assert.equal(before1.filter((r) => r.status === 'scheduled').length, 126);
  assert.ok(before1.every((r) => r.stage === 'league' && r.week >= 1 && r.week <= 8));
  assert.ok(before1.every((r) => r.c1 == null), 'no colours - the card draws a monogram');
  const brugge = before1.find((r) => r.fx === '1635643');
  assert.deepEqual([brugge.home, brugge.away, brugge.home_score, brugge.away_score], ['Club Brugge KV', 'Aston Villa', 2, 3]);
  const teams = await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE external_ids ? 'api_sports')::int AS ext FROM teams WHERE league_id = ${leagueId}`;
  assert.deepEqual(teams[0], { n: 36, ext: 36 }, 'every club carries its provider id');

  const second = await syncSoccerLeague('ucl', { client, sql, storeAs: STORE });
  assert.equal(second.leagueId, leagueId);
  assert.equal(second.fixtures, 144);
  assert.deepEqual(await snap(), before1, 'idempotent: same rows, same values');
  const n = await sql`SELECT count(*)::int AS n FROM teams WHERE league_id = ${leagueId}`;
  assert.equal(n[0].n, 36, 'no club row twice');
});

test('DEV TABLE: the 36-row league phase stored on the league row, read back whole', async () => {
  const r = await syncSoccerStandings('ucl', { fetchJson, storeAs: STORE });
  assert.equal(r.clubs, 36); assert.equal(r.requests, 1);
  const doc = await getSoccerStandings(STORE);
  assert.equal(doc.rows.length, 36);
  assert.deepEqual(doc.rows.map((x) => x.rank), Array.from({ length: 36 }, (_, i) => i + 1));
  await syncSoccerStandings('ucl', { fetchJson, storeAs: STORE });
  assert.equal((await getSoccerStandings(STORE)).rows.length, 36, 'replaced whole, never appended');
});
