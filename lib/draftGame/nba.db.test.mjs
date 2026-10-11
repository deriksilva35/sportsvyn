// lib/draftGame/nba.db.test.mjs - per-game Draft for NBA on DEV (mon-1 S3):
// one board per NBA game (two on one night, no day-key collision), the NBA
// last-3 rule from nba_player_game_stats, and an NBA settle (DNP scores 0).
//
// OWN FIXTURES, own prefixes: 'dgnbatest-' league/teams/matches, 'dgnba-' users.
// The BDL roster fetch is not exercised here (the pool is injected); shapeNbaPool
// is covered pure in nbaPool.test.mjs.
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
const { createGameBoard, dueGames } = await import('./create.js');
const { recentNbaActive } = await import('./nbaPool.js');
const { startRoom, readRoom } = await import('./room.js');
const { settleGameBoard } = await import('./settle.js');

const LG = 'dgnbatest-nba';
const H = 3_600_000;
const TIP = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 20 * H);
let leagueId; let tA; let tB; let user; const M = {}; const C = {};
const pool = Array.from({ length: 24 }, (_, i) => ({ id: 7_100_000 + i, name: `Dgnba ${i}`, pos: ['G', 'F', 'C'][i % 3], team: i % 2 ? 'DNA' : 'DNB', team_id: 0, proj: 40 - i, games: 10 }));

async function teardown() {
  const ids = (await sql`SELECT id FROM leagues WHERE slug = ${LG}`).map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM contests WHERE match_id IN (SELECT id FROM matches WHERE league_id = ANY(${ids}))`;
    await sql`DELETE FROM matches WHERE league_id = ANY(${ids})`;
    await sql`DELETE FROM teams WHERE league_id = ANY(${ids})`;
    await sql`DELETE FROM leagues WHERE id = ANY(${ids})`;
  }
  await sql`DELETE FROM users WHERE email LIKE 'dgnba-%@example.invalid'`;
}

const match = async (key, ko, status = 'scheduled', season = 2099) => {
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, ${'dgnbatest-' + key}, ${ko.toISOString()}, ${status}, ${tA}, ${tB}, ${season}, 'REG', NULL, '{}'::jsonb, '{}'::jsonb)
    RETURNING id, slug, kickoff_at, status, season_year, week, home_team_id, away_team_id`;
  return { ...m, home: 'DNA', away: 'DNB' };
};

before(async () => {
  await teardown();
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Draft Game NBA Test', 'nba', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const mk = async (slug, abbr) => (await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${abbr}, ${abbr}, ${abbr}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  tA = await mk('dgnbatest-a', 'DNA'); tB = await mk('dgnbatest-b', 'DNB');
  M.early = await match('early', TIP);
  M.late = await match('late', new Date(TIP.getTime() + 3 * H));
  user = (await sql`INSERT INTO users (name, email) VALUES ('DGN', ${`dgnba-1-${process.pid}@example.invalid`}) RETURNING id`)[0].id;
});

after(async () => {
  await teardown();
  assert.equal((await sql`SELECT count(*)::int AS n FROM leagues WHERE slug = ${LG}`)[0].n, 0);
});

test('NBA: due inside 24 h, never before the season opens; two games one night = two boards, week 0', async () => {
  const now = new Date(TIP.getTime() - 4 * H);
  const due = (await dueGames({ now, leagueSlug: LG, openHours: 24 })).map((r) => r.id);
  assert.ok(due.includes(M.early.id) && due.includes(M.late.id));
  const notYet = await dueGames({ now, leagueSlug: LG, openHours: 24, from: new Date(TIP.getTime() + 10 * H).toISOString() });
  assert.equal(notYet.length, 0, 'before the first allowed day, nothing is due');
  for (const k of ['early', 'late']) {
    const r = await createGameBoard(M[k], { now, sport: 'nba', buildPool: async () => pool });
    assert.equal(r.created, true, k);
    C[k] = r.id;
  }
  const rows = await sql`SELECT sport, week, puzzle_date, meta->>'sport' AS ms FROM contests WHERE id = ANY(${[C.early, C.late]})`;
  assert.ok(rows.every((r) => r.sport === 'nba' && r.week === 0 && r.puzzle_date == null && r.ms === 'nba'));
});

test('NBA last-3: a club filters on who played (not DNP) in its last 3 boxed games; a club with none this season is not filtered', async () => {
  const days = (d) => new Date(TIP.getTime() - d * 24 * H);
  const g = [];
  for (const [i, d] of [10, 8, 6, 4].entries()) g.push(await match(`box${i}`, days(d), 'final'));
  const box = (m, pid, dnp = false) => sql`
    INSERT INTO nba_player_game_stats (match_id, team_id, bdl_player_id, player_name, seconds, dnp, pts)
    VALUES (${m.id}, ${tA}, ${String(pid)}, ${'Dgnba ' + pid}, ${dnp ? 0 : 1200}, ${dnp}, ${dnp ? 0 : 10})`;
  await box(g[0], 1); await box(g[1], 1, true); await box(g[2], 1, true); await box(g[3], 1, true); // played only the oldest, DNP since
  await box(g[3], 2);                                                                               // played the latest
  await box(g[1], 3);                                                                               // the 3rd-newest still counts
  const active = await recentNbaActive([Number(tA), Number(tB)], TIP.toISOString(), 2099);
  const a = active.get(Number(tA));
  assert.equal(a.has('1'), false, 'DNP in all of the last three: out');
  assert.equal(a.has('2'), true);
  assert.equal(a.has('3'), true);
  // DNB was the other side of those boxed games, so it is filtered too - and none of
  // its players appear in them, so its set is empty.
  assert.equal(active.get(Number(tB)).size, 0);
  // A season with no boxed game at all (opening night) filters nobody.
  assert.equal((await recentNbaActive([Number(tA), Number(tB)], TIP.toISOString(), 2098)).size, 0);
});

test('NBA settle: the room scores from the NBA box, DNP is 0, best 3 count', async () => {
  await startRoom(user, C.early, { now: new Date(TIP.getTime() - H), seat: 1 });
  const v = (await readRoom(user, C.early, { now: TIP })).view;
  assert.equal(v.done, true);
  const mine = v.seats.find((s) => s.you).picks.map((p) => p.id);
  for (const [i, p] of pool.entries()) {
    const dnp = p.id === mine[0];
    await sql`INSERT INTO nba_player_game_stats (match_id, team_id, bdl_player_id, player_name, seconds, dnp, pts, reb, ast)
      VALUES (${M.early.id}, ${tA}, ${String(p.id)}, ${p.name}, ${dnp ? 0 : 1500}, ${dnp}, ${dnp ? 0 : 5 + (i % 7)}, 2, 1)`;
  }
  await sql`UPDATE matches SET status = 'final', home_score = 110, away_score = 104 WHERE id = ${M.early.id}`;
  assert.equal((await settleGameBoard(C.early, { now: new Date(TIP.getTime() + 2 * H) })).reason, 'grace', 'NBA grace is 3 h');
  const r = await settleGameBoard(C.early, { now: new Date(TIP.getTime() + 3.1 * H) });
  assert.equal(r.settled, true);
  const [e] = await sql`SELECT score, meta->'result' AS result FROM contest_entries WHERE contest_id = ${C.early} AND user_id = ${user}`;
  const me = e.result.seats.find((s) => s.you);
  const dnp = me.players.find((p) => p.id === mine[0]);
  assert.equal(dnp.played, false); assert.equal(dnp.pts, 0); assert.equal(dnp.line, null);
  const best3 = me.players.map((p) => p.pts).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  assert.equal(Number(e.score), Math.round(best3 * 10) / 10);
  assert.equal(e.result.score_line, 'FINAL 104-110');
});
