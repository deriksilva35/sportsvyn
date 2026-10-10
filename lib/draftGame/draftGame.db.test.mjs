// lib/draftGame/draftGame.db.test.mjs - per-game Draft on DEV (thu-3 S1):
// one board per game (migration 136's unique index), the room's clock and its
// lock at kickoff, and the pool size of real games.
//
// FIXTURES ARE ITS OWN: a 'dgtest-' league with two teams and three matches,
// two example.invalid users, every time relative to now. Real NFL rows are only
// READ (the pool-size test). before() clears a killed run's leftovers by the
// same prefix; after() deletes everything it made and asserts it is gone.
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
const { dueNflGames, createGameBoard, refreshLocks, ensureGameBoards, boardsEnabled, GAME_TYPE } = await import('./create.js');
const { buildNflPool, recentlyActive, POOL_MIN } = await import('./pool.js');
const { startRoom, readRoom, makePick, listOpenBoards } = await import('./room.js');
const { TOTAL_PICKS, ROUNDS } = await import('./rules.js');

const LG = 'dgtest-nfl';
const H = 3_600_000;
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000);
let leagueId; let tA; let tB; let users = []; const M = {};

const fakePool = (n) => async () => Array.from({ length: n }, (_, i) => ({
  id: 900000 + i, name: `Fixture ${i}`, pos: ['QB', 'RB', 'WR', 'TE'][i % 4], team: i % 2 ? 'DGA' : 'DGB', team_id: 0, proj: 40 - i, games: 4,
}));

async function teardown() {
  const lg = await sql`SELECT id FROM leagues WHERE slug = ${LG}`;
  const ids = lg.map((r) => r.id);
  if (ids.length) {
    await sql`DELETE FROM contests WHERE match_id IN (SELECT id FROM matches WHERE league_id = ANY(${ids}))`;
    await sql`DELETE FROM matches WHERE league_id = ANY(${ids})`;
    await sql`DELETE FROM nfl_players WHERE team_id IN (SELECT id FROM teams WHERE league_id = ANY(${ids}))`;
    await sql`DELETE FROM teams WHERE league_id = ANY(${ids})`;
    await sql`DELETE FROM leagues WHERE id = ANY(${ids})`;
  }
  await sql`DELETE FROM users WHERE email LIKE 'dgtest-%@example.invalid'`;
}

before(async () => {
  await teardown();
  leagueId = (await sql`
    INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Draft Game Test', 'nfl', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const mk = async (slug, abbr) => (await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${abbr}, ${abbr}, ${abbr}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  tA = await mk('dgtest-a', 'DGA');
  tB = await mk('dgtest-b', 'DGB');
  const mm = async (key, hours) => {
    const ko = new Date(NOW.getTime() + hours * H).toISOString();
    M[key] = (await sql`
      INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                           season_year, season_phase, week, external_ids, metadata)
      VALUES (${leagueId}, ${'dgtest-' + key}, ${ko}, 'scheduled', ${tA}, ${tB}, 2099, 'REG', 99, '{}'::jsonb, '{}'::jsonb)
      RETURNING id, slug, kickoff_at, status, season_year, week, home_team_id, away_team_id`)[0];
    M[key].home = 'DGA'; M[key].away = 'DGB';
  };
  await mm('one', 24); await mm('two', 48); await mm('far', 100);
  for (const n of [1, 2]) {
    users.push((await sql`INSERT INTO users (name, email) VALUES (${'DG ' + n}, ${`dgtest-${n}-${process.pid}@example.invalid`}) RETURNING id`)[0].id);
  }
});

after(async () => {
  await teardown();
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM leagues WHERE slug = ${LG}`;
  assert.equal(n, 0, 'teardown left the fixture league');
});

test('the switch: boards only while DRAFT_GAME_BOARDS is on; off or unset makes nothing', async () => {
  assert.equal(boardsEnabled({ DRAFT_GAME_BOARDS: 'on' }), true);
  assert.equal(boardsEnabled({ DRAFT_GAME_BOARDS: ' ON ' }), true);
  for (const v of ['off', '', 'true', undefined]) assert.equal(boardsEnabled({ DRAFT_GAME_BOARDS: v }), false, String(v));
  const r = await ensureGameBoards({ now: NOW, env: { DRAFT_GAME_BOARDS: 'off' } });
  assert.equal(r.disabled, true);
  assert.equal(r.created, 0);
});

test('due games: open within 72 h of kickoff, not the far one', async () => {
  const due = (await dueNflGames({ now: NOW, leagueSlug: LG })).map((r) => r.id);
  assert.ok(due.includes(M.one.id) && due.includes(M.two.id));
  assert.ok(!due.includes(M.far.id));
});

test('one board per game: a second create races to the first, a raw duplicate is refused', async () => {
  const a = await createGameBoard(M.one, { now: NOW, buildPool: fakePool(24) });
  assert.equal(a.created, true);
  const b = await createGameBoard(M.one, { now: NOW, buildPool: fakePool(24) });
  assert.equal(b.created, false);
  assert.equal(b.id, a.id);
  await assert.rejects(sql`
    INSERT INTO contests (game_type, sport, season_year, week, match_id, board, opens_at, locks_at)
    VALUES (${GAME_TYPE}, 'nfl', 2099, 99, ${M.one.id}, '[]'::jsonb, now(), now())`, /idx_contests_match|duplicate key/);
  // Two games in one week are two boards: match-keyed rows are outside idx_contests_week.
  const c = await createGameBoard(M.two, { now: NOW, buildPool: fakePool(24) });
  assert.equal(c.created, true);
  const due = (await dueNflGames({ now: NOW, leagueSlug: LG })).map((r) => r.id);
  assert.ok(!due.includes(M.one.id) && !due.includes(M.two.id), 'a game with a board is no longer due');
  const [row] = await sql`SELECT locks_at, opens_at, meta FROM contests WHERE id = ${a.id}`;
  assert.equal(new Date(row.locks_at).getTime(), new Date(M.one.kickoff_at).getTime(), 'locks at kickoff');
  assert.equal(row.meta.seats, 4); assert.equal(row.meta.rounds, 4); assert.equal(row.meta.count, 3);
});

test('a pool under POOL_MIN gets no board', async () => {
  const r = await createGameBoard(M.far, { now: NOW, buildPool: fakePool(POOL_MIN - 1) });
  assert.equal(r.created, false);
  assert.equal(r.reason, 'pool_too_small');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM contests WHERE match_id = ${M.far.id}`;
  assert.equal(n, 0);
});

test('the room: seat 3, the bots ahead pick, your pick, the clock, then the lock at kickoff', async () => {
  const [{ id: cid }] = await sql`SELECT id FROM contests WHERE game_type = ${GAME_TYPE} AND match_id = ${M.one.id}`;
  const u = users[0];
  const s = await startRoom(u, cid, { now: NOW, seat: 3 });
  assert.equal(s.ok, true);
  let v = (await readRoom(u, cid, { now: NOW })).view;
  assert.equal(v.seat, 3);
  assert.equal(v.next, 3, 'seats 1 and 2 (bots) have picked');
  assert.equal(v.yourTurn, true);
  assert.equal(v.header, 'Round 1 of 4 · your pick');
  // The list counts the room as it stands: 31 s on, the clock has picked once -
  // and the list only READS (the stored room is untouched, so pick 3 is still open below).
  const listed = (await listOpenBoards(u, { now: new Date(NOW.getTime() + 31_000) })).find((b) => b.contestId === cid);
  assert.equal(listed.started, true);
  assert.equal(listed.picks, 1);
  // A second start resumes, never a second room.
  assert.equal((await startRoom(u, cid, { now: NOW, seat: 1 })).resumed, true);

  const mine = v.available[0].id;
  assert.equal((await makePick(u, cid, mine, { now: NOW })).ok, true);
  v = (await readRoom(u, cid, { now: NOW })).view;
  assert.equal(v.next, 6, 'pick 3 was yours, the bots took 4 and 5, pick 6 is yours again');
  assert.equal((await makePick(u, cid, mine, { now: NOW })).reason, 'taken');

  // Walk away for 31 s: the server auto-picks the top projection.
  const later = new Date(NOW.getTime() + 31_000);
  v = (await readRoom(u, cid, { now: later })).view;
  assert.equal(v.seats[2].picks.length, 2);
  assert.equal(v.seats[2].picks[1].by, 'auto');
  assert.equal(v.next, 11);

  // Kickoff: nobody new may start, and the open room is finished for its owner.
  const ko = new Date(M.one.kickoff_at);
  assert.equal((await startRoom(users[1], cid, { now: ko })).reason, 'locked');
  v = (await readRoom(u, cid, { now: ko })).view;
  assert.equal(v.done, true);
  assert.equal(v.locked, true);
  assert.equal(v.seats.reduce((a, x) => a + x.picks.length, 0), TOTAL_PICKS);
  const [e] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${cid} AND user_id = ${u}`;
  assert.equal(e.lineup.players.length, ROUNDS);
  assert.equal((await makePick(u, cid, v.available[0]?.id ?? 1, { now: ko })).reason, 'locked');
});

test('a game that moves takes its lock with it; the list shows open boards only', async () => {
  const moved = new Date(new Date(M.two.kickoff_at).getTime() + 2 * H).toISOString();
  await sql`UPDATE matches SET kickoff_at = ${moved} WHERE id = ${M.two.id}`;
  assert.ok((await refreshLocks({ now: NOW })) >= 1);
  const [c] = await sql`SELECT locks_at FROM contests WHERE match_id = ${M.two.id}`;
  assert.equal(new Date(c.locks_at).toISOString(), moved);
  const list = await listOpenBoards(users[1], { now: NOW });
  const mine = list.filter((b) => b.home === 'DGA');
  assert.equal(mine.length, 2);
  assert.ok(mine.every((b) => b.started === false));
});

// POOL SIZE IS MEASURED ON PROD, NOT HERE (sat-1). The last-3 rule reads each
// team's three most recent BOXED finals, and DEV holds no 2026 boxes for weeks
// 2-4, so DEV pools run 14-28 where PROD's week 6 ran 24-30 (all >= POOL_MIN;
// docs/reports/2026-10-10-draft-game-s2.md). This test holds what DEV can
// prove: who may be in a pool, and that it never overflows.
test('pool shape per game: players only, the two teams only, never over POOL_MAX', async () => {
  const { POOL_MAX } = await import('./pool.js');
  const games = await sql`
    SELECT m.id, m.kickoff_at, m.home_team_id, m.away_team_id
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = 2026 AND m.season_phase = 'REG' AND m.week = 5`;
  assert.ok(games.length > 0, 'DEV has the 2026 week-5 slate');
  let total = 0;
  for (const g of games) {
    const pool = await buildNflPool(g);
    total += pool.length;
    assert.ok(pool.length <= POOL_MAX, `match ${g.id}: pool ${pool.length} > ${POOL_MAX}`);
    assert.ok(pool.every((r) => ['QB', 'RB', 'WR', 'TE'].includes(r.pos)), 'players only - no K, no DST');
    assert.ok(pool.every((r) => [Number(g.home_team_id), Number(g.away_team_id)].includes(r.team_id)), 'both teams, nobody else');
  }
  assert.ok(total / games.length >= 10, `DEV pools average ${total / games.length} - the walk found almost nobody`);
});

test("last 3 team games: the A.J. Brown case - played the oldest of four, nothing since: out", async () => {
  // Team DGA's finals, oldest first, each with a box, then a newer final with NO box.
  const ko = (d) => new Date(NOW.getTime() - d * 24 * H).toISOString();
  const mk = async (slug, when) => (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${when}, 'final', ${tA}, ${tB}, 2099, 'REG', 90, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const g = [await mk('dgtest-g1', ko(35)), await mk('dgtest-g2', ko(28)), await mk('dgtest-g3', ko(21)), await mk('dgtest-g4', ko(14))];
  await mk('dgtest-g5-nobox', ko(7));
  const pl = async (name) => (await sql`INSERT INTO nfl_players (full_name, normalized_name, position, team_id)
    VALUES (${name}, ${name.toLowerCase()}, 'WR', ${tA}) RETURNING id, team_id`)[0];
  const brown = await pl('Dgtest Brown'); const smith = await pl('Dgtest Smith'); const wilson = await pl('Dgtest Wilson');
  const line = (m, p) => sql`INSERT INTO nfl_player_game_stats (match_id, nfl_player_id, team_id, rec, rec_yds) VALUES (${m}, ${p}, ${tA}, 3, 30)`;
  await line(g[0], brown.id);                         // week 1 only, like Brown
  await line(g[3], smith.id); await line(g[2], smith.id); await line(g[0], smith.id); // every boxed game has a row
  await line(g[1], wilson.id);                        // the 3rd-newest boxed game still counts
  const active = await recentlyActive([brown, smith, wilson], [tA, tB], NOW.toISOString());
  assert.equal(active.has(Number(brown.id)), false, 'Brown played only the 4th-newest boxed game: out');
  assert.equal(active.has(Number(smith.id)), true);
  assert.equal(active.has(Number(wilson.id)), true, 'g5 has no box, so the last three are g4, g3, g2');
});
