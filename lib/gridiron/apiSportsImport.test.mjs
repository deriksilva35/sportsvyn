// lib/gridiron/apiSportsImport.test.mjs - provider game -> matches row.
//
// toMatchRow is where every provider quirk either gets handled or becomes a bad
// database row, so it is tested against the captured payloads rather than
// against objects written from memory of them. The fixture rows are verbatim
// /games output for 2024 and 2026.
//
// It is async only because toUtc is; it touches no database and no network, so
// the full mapping of a real game is checkable in a millisecond.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMatchRow, gameSlug, DEFAULT_PHASES } from './apiSportsImport.js';
import { makeRunSummary } from './ingest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures/apisports-nfl-games.json'), 'utf8'));
const row = (why) => {
  const hit = FIXTURE.rows.find((r) => r.why.includes(why));
  assert.ok(hit, `fixture is missing the "${why}" row`);
  return hit.game;
};

// The 32 real NFL provider ids, keyed as the importer keys them (strings, off
// external_ids). Values are stand-in match ids; only the mapping matters here.
const TEAMS = new Map(Array.from({ length: 34 }, (_, i) => [String(i + 1), 1000 + i]));
const CTX = { leagueSlug: 'nfl', leagueId: 7, teams: TEAMS };

// ---------------------------------------------------------------------------
// Real rows map completely
// ---------------------------------------------------------------------------

test('the Thursday Aug 13 preseason opener maps to a complete row', async () => {
  const rs = makeRunSummary();
  const r = await toMatchRow(row('Thursday Aug 13'), { ...CTX, runSummary: rs });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.row.seasonPhase, 'PRE');
  assert.equal(r.row.week, 1);
  assert.equal(r.row.seasonYear, 2026);
  assert.equal(r.row.status, 'scheduled');
  assert.equal(r.row.kickoffAt, '2026-08-13T23:00:00.000Z');
  assert.equal(r.row.homeScore, null, 'an unplayed game has no score, not zero');
  assert.equal(r.row.awayScore, null);
  assert.ok(r.row.homeTeamId && r.row.awayTeamId);
  assert.equal(rs.unknownStatus, 0);
});

test('the Hall of Fame game maps as PRE week 0 with its real score', async () => {
  // The first real final row this importer will write, and the one that proves
  // the whole chain: prose stage, prose week, epoch kickoff, played score.
  const rs = makeRunSummary();
  const g = row('Hall of Fame');
  const r = await toMatchRow(g, { ...CTX, runSummary: rs });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.row.seasonPhase, 'PRE');
  assert.equal(r.row.week, 0, 'Hall of Fame Weekend precedes preseason Week 1');
  assert.equal(r.row.status, 'final');
  assert.equal(r.row.homeScore, g.scores.home.total);
  assert.equal(r.row.awayScore, g.scores.away.total);
  assert.equal(r.row.metadata.apisports_week_label, 'Hall of Fame Weekend',
    'the prose label is kept - "week 0" is not reconstructable into it');
  assert.ok(r.row.metadata.line_scores, 'a played game carries its quarters');
  assert.equal(rs.unknownStatus, 0);
});

test('THE TRAP: an overtime final maps to final, not to a skipped row', async () => {
  const rs = makeRunSummary();
  const r = await toMatchRow(row('NULL status.short'), { ...CTX, runSummary: rs });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.row.status, 'final');
  assert.equal(rs.unknownStatus, 0);
});

test('every fixture row that should map, does', async () => {
  const rs = makeRunSummary();
  for (const { why, game } of FIXTURE.rows) {
    const r = await toMatchRow(game, { ...CTX, runSummary: rs });
    assert.equal(r.ok, true, `${why} -> ${r.reason}`);
    assert.ok(r.row.kickoffAt.endsWith('Z'));
    assert.ok(['scheduled', 'live', 'final', 'postponed', 'cancelled'].includes(r.row.status));
    assert.ok(['REG', 'PRE', 'POST'].includes(r.row.seasonPhase));
    assert.ok(Number.isInteger(r.row.week));
  }
  assert.equal(rs.unknownStatus, 0);
});

// ---------------------------------------------------------------------------
// Rows that must NOT be written
// ---------------------------------------------------------------------------

test('THE PRO BOWL IS DROPPED, loudly and counted', async () => {
  // Staged "Post Season" by the provider. Written naively it puts an all-star
  // exhibition into team records.
  const rs = makeRunSummary();
  const pro = structuredClone(row('post season'));
  pro.game.week = 'Pro Bowl';
  const r = await toMatchRow(pro, { ...CTX, runSummary: rs });
  assert.equal(r.ok, false);
  assert.match(r.reason, /STAR/);
  assert.equal(rs.skippedByPhase.STAR, 1, 'skips are counted, never silent');
});

test('TBD PLAYOFF PARTICIPANTS are not a mapping failure', async () => {
  // The provider ships the 2026 bracket with { id: 0, name: null } on both
  // sides until the field is seeded - 7 such games in the live payload. Counted
  // as unresolved teams they would fire the poller alert on every healthy
  // sweep, and an alert that cries wolf is an alert nobody reads.
  const rs = makeRunSummary();
  const g = structuredClone(row('post season'));
  g.teams.home = { id: 0, name: null, logo: null };
  g.teams.away = { id: 0, name: null, logo: null };
  const r = await toMatchRow(g, { ...CTX, runSummary: rs });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unseeded_matchup');
  assert.equal(rs.unseededMatchups, 1);
  assert.equal(rs.unresolvedTeams ?? 0, 0, 'and NOT counted as a stale team map');
});

test('an unresolved team SKIPS the game and never creates a stub', async () => {
  // A stub NFL team is always a bug - all 32 are mapped. sync.js creates stubs
  // for missing FCS opponents; that case does not exist here.
  const rs = makeRunSummary();
  const g = structuredClone(row('Thursday Aug 13'));
  g.teams.home.id = 9999;
  const r = await toMatchRow(g, { ...CTX, runSummary: rs });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unresolved_team/);
  assert.equal(rs.unresolvedTeams, 1);
});

test('a row that cannot be fully mapped is skipped, never written partially', async () => {
  const rs = makeRunSummary();
  const cases = [
    ['no_provider_id', (g) => { g.game.id = null; }],
    ['unmapped_stage', (g) => { g.game.stage = 'Friendly'; }],
    ['unmapped_week', (g) => { g.game.week = 'Some Round'; g.game.stage = 'Post Season'; }],
    ['unmapped_status', (g) => { g.game.status = { short: 'ZZZ', long: 'Nonsense' }; }],
    ['no_kickoff', (g) => { g.game.date.timestamp = null; }],
    ['no_season_year', (g) => { g.league.season = 'not a year'; }],
  ];
  for (const [expected, mutate] of cases) {
    const g = structuredClone(row('Thursday Aug 13'));
    mutate(g);
    const r = await toMatchRow(g, { ...CTX, runSummary: rs });
    assert.equal(r.ok, false, `${expected} should not map`);
    assert.match(r.reason, new RegExp(expected));
  }
  // kickoff_at is NOT NULL and a placeholder kickoff is worse than an absent game.
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('the slug is deterministic, so a re-import is the same row', async () => {
  const a = await toMatchRow(row('Thursday Aug 13'), { ...CTX, runSummary: makeRunSummary() });
  const b = await toMatchRow(row('Thursday Aug 13'), { ...CTX, runSummary: makeRunSummary() });
  assert.equal(a.row.slug, b.row.slug);
  assert.match(a.row.slug, /^nfl-2026-pre-w1-/);
});

test('the slug distinguishes phase and week, so PRE W1 never collides with REG W1', () => {
  const base = { leagueSlug: 'nfl', seasonYear: 2026, away: 'Detroit Lions', home: 'Cincinnati Bengals' };
  const pre = gameSlug({ ...base, phase: 'PRE', week: 1 });
  const reg = gameSlug({ ...base, phase: 'REG', week: 1 });
  assert.notEqual(pre, reg, 'the same pairing can happen in both phases');
  assert.equal(pre, 'nfl-2026-pre-w1-detroit-lions-at-cincinnati-bengals');
});

test('the default phase allowlist is PRE ONLY, and that is a decision', () => {
  // BDL owns REG and POST for the NFL. Two providers writing the same fixture
  // under different external_ids keys produces two rows with no error - the
  // partial unique index is per-provider. Widening this is a design change.
  assert.deepEqual(DEFAULT_PHASES, ['PRE']);
});

test('the importer keeps counters that explain a quiet run', () => {
  // "0 games ingested" has to be readable as an intentional skip rather than a
  // broken sync - the same contract makeRunSummary was written for.
  const rs = makeRunSummary();
  assert.equal(rs.ingested, 0);
  assert.deepEqual(rs.skippedByPhase, {});
  assert.equal(rs.unknownStatus, 0);
});
