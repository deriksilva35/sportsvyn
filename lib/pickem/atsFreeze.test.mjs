// lib/pickem/atsFreeze.test.mjs - AGAINST THE SPREAD (S3), DB-BACKED: the line is
// frozen into a real board by the real create path, survives a move of the line
// source, and the settle grades a push and a no-line game as void.
//
// FIXTURE: sentinel teams + matches under the REAL 'nfl' league (ensurePickemBoard
// only builds a Pick'em board for a real league slug, and the ATS freeze is
// NFL/CFB only), in NFL season 2003 / week 1 - a season DEV holds no schedule for,
// so no real board and no other test's plan can see these rows. Everything is
// found again by the 'atsfz-' prefix and removed in after(); the teardown asserts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { ensurePickemBoard, boardPlan } = await import('./create.js');
const { gradePickemBoard } = await import('./settle.js');
const { getSpreadHome } = await import('../gridiron/oddsReader.js');
const { atsRecord, atsScore } = await import('./ats.js');
const { shapeResults } = await import('../leagues/results.js');
const { pickemLeagueScore } = await import('../leagues/pickFormat.js');

const P = 'atsfz';
const SEASON = 2003; const WEEK = 1;
const KO = ['2003-09-04T23:30:00Z', '2003-09-07T17:00:00Z', '2003-09-07T20:00:00Z', '2003-09-08T00:15:00Z'];
const SETTLE_AT = new Date('2003-09-09T12:00:00Z');
const m = {}; const t = {};
let nflId; let contestId;

const mkTeam = async (k) => {
  t[k] = (await sql`
    INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${nflId}, ${`${P}-${k}`}, ${`Atsfz ${k}`}, ${k.toUpperCase()}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
};
const mkGame = async (k, home, away, ko, hs, as) => {
  m[k] = (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, home_score, away_score,
                         season_year, season_phase, week, external_ids, metadata)
    VALUES (${nflId}, ${`${P}-${k}`}, ${ko}, 'final', ${t[home]}, ${t[away]}, ${hs}, ${as}, ${SEASON}, 'REG', ${WEEK}, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
};
// the home team's handicap, as the Odds API prices it: label = the home team's name
const mkSpread = (k, home, value) => sql`
  INSERT INTO odds_markets (market_scope, market_type, match_id, selection_label, selection_value,
                            american_odds, implied_probability, is_current, fetcher_version)
  VALUES ('match', 'spread', ${m[k]}, ${`Atsfz ${home}`}, ${String(value)}, -110, 52.38, true, 'odds-api-v4')`;

async function teardown() {
  await sql`DELETE FROM contests WHERE game_type = 'pickem' AND sport = 'nfl' AND season_year = ${SEASON} AND week = ${WEEK}`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${P}-%`}`;        // cascades the odds rows
  await sql`DELETE FROM teams WHERE slug LIKE ${`${P}-%`}`;
}

before(async () => {
  await teardown();
  nflId = (await sql`SELECT id FROM leagues WHERE slug = 'nfl'`)[0].id;
  for (const k of ['h1', 'a1', 'h2', 'a2', 'h3', 'a3', 'h4', 'a4']) await mkTeam(k);
  // g1 home -3.5, wins 30-20 (+10)      -> home covers
  // g2 home +7, loses 10-17 (-7)        -> PUSH
  // g3 NO LINE at week open, 30-3       -> void for ATS
  // g4 home -2.5, wins 24-23 (+1)       -> away covers; the line then MOVES to -0.5 (home would cover)
  await mkGame('g1', 'h1', 'a1', KO[0], 30, 20);
  await mkGame('g2', 'h2', 'a2', KO[1], 10, 17);
  await mkGame('g3', 'h3', 'a3', KO[2], 30, 3);
  await mkGame('g4', 'h4', 'a4', KO[3], 24, 23);
  await mkSpread('g1', 'h1', -3.5);
  await mkSpread('g2', 'h2', 7);
  await mkSpread('g4', 'h4', -2.5);
});

after(async () => {
  await teardown();
  const left = await sql`
    SELECT (SELECT count(*) FROM matches WHERE slug LIKE ${`${P}-%`})::int AS matches,
           (SELECT count(*) FROM teams WHERE slug LIKE ${`${P}-%`})::int AS teams,
           (SELECT count(*) FROM contests WHERE game_type = 'pickem' AND sport = 'nfl' AND season_year = ${SEASON})::int AS contests`;
  assert.deepEqual(left[0], { matches: 0, teams: 0, contests: 0 }, 'teardown left nothing behind');
});

let frozenBoard;

test('the real create path freezes each game\'s spread into the board', async () => {
  const { plan } = await boardPlan({ leagueSlug: 'nfl', now: new Date('2003-09-01T00:00:00Z') });
  assert.ok(plan, 'the fixture week plans');
  assert.equal(plan.board.length, 4);
  const made = await ensurePickemBoard({ leagueSlug: 'nfl', now: new Date(plan.opensAt.getTime() + 60_000) });
  assert.equal(made.created, true);
  contestId = made.id;
  const c = (await sql`SELECT board, meta FROM contests WHERE id = ${contestId}`)[0];
  frozenBoard = c.board;
  const line = (k) => c.board.find((g) => g.match_id === m[k]).spread_home;
  assert.equal(line('g1'), -3.5);
  assert.equal(line('g2'), 7);
  assert.equal(line('g3'), null, 'no line at week open stores null');
  assert.equal(line('g4'), -2.5);
  assert.ok(c.meta.spread_frozen_at, 'the freeze is stamped');
});

test('moving the line source changes nothing in the board', async () => {
  await sql`UPDATE odds_markets SET selection_value = '-0.5' WHERE match_id = ${m.g4} AND market_type = 'spread'`;
  await mkSpread('g3', 'h3', -9);                                    // a line appears for the no-line game AFTER open
  const live = await getSpreadHome([m.g3, m.g4]);
  assert.equal(live.get(m.g4), -0.5, 'the live reader sees the move');
  assert.equal(live.get(m.g3), -9);
  const again = await ensurePickemBoard({ leagueSlug: 'nfl', now: new Date('2003-09-02T12:00:00Z') });
  assert.equal(again.created, false, 'a second pass does not rebuild the board');
  const c = (await sql`SELECT board FROM contests WHERE id = ${contestId}`)[0];
  assert.deepEqual(c.board, frozenBoard, 'the board is byte-for-byte what was frozen');
  assert.equal(c.board.find((g) => g.match_id === m.g4).spread_home, -2.5, 'still the line seen at open');
  assert.equal(c.board.find((g) => g.match_id === m.g3).spread_home, null, 'a late line does not make the void game count');
});

test('settle grades the frozen lines: cover, push void, no-line void, moved line ignored', async () => {
  const c = (await sql`SELECT id, board, meta, perfect, settled, settles_at, locks_at, season_year, sport FROM contests WHERE id = ${contestId}`)[0];
  const r = await gradePickemBoard(c, { now: SETTLE_AT });
  assert.equal(r.settled, true, JSON.stringify(r));
  const { perfect } = (await sql`SELECT perfect FROM contests WHERE id = ${contestId}`)[0];
  assert.deepEqual(perfect.ats.results, { [m.g1]: 'home', [m.g2]: 'push', [m.g3]: null, [m.g4]: 'away' });
  assert.equal(perfect.ats.max, 2, 'the push and the no-line game are not in the max');
  // the national result is untouched: all four have a straight-up winner
  assert.equal(Object.values(perfect.results).filter((v) => v === 'home' || v === 'away').length, 4);

  // a reader who took home everywhere: 1 cover, 1 miss (g4), 1 push, the no-line game nothing
  const lineup = { [m.g1]: 'home', [m.g2]: 'home', [m.g3]: 'home', [m.g4]: 'home' };
  assert.equal(atsScore(lineup, perfect.ats.results), 1);
  assert.deepEqual(atsRecord(lineup, perfect.ats.results), { w: 1, l: 1, p: 1 });
  assert.equal(pickemLeagueScore('ats', { settled: true, lineup, ats: perfect.ats.results }), 1);
  const row = { game: 'pickem', sport: 'nfl', season_year: SEASON, week: WEEK, pd: null, locks_at: c.locks_at, settled: true, user_id: 1,
    score: 3, conf: false, pk_lineup: lineup, pk_results: perfect.results, pk_ats: perfect.ats.results, submitted_at: null };
  const [res] = shapeResults({ contestRows: [row], unit: 'week', league: { pick_format: 'ats' } }).results;
  assert.equal(res.score, 1);
  assert.deepEqual(res.record, { w: 1, l: 1, p: 1 });
});
