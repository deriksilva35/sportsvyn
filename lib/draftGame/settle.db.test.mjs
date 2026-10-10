// lib/draftGame/settle.db.test.mjs - per-game Draft settle on DEV (fri-1 S2):
// live scoring from the box as it stands, the final settle (best 3, a player
// who did not play scores 0, the percentile), idempotence, and a void game.
//
// ITS OWN FIXTURES, its own prefixes - 'dgsettletest-' league, teams and
// players, 'dgsettle-' users - so it never touches draftGame.db.test.mjs's rows
// (that file tears down 'dgtest-' users) and the two can run in parallel.
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
const { createGameBoard } = await import('./create.js');
const { startRoom, readRoom } = await import('./room.js');
const { settleGameBoard, liveResult, SETTLE_AFTER_HOURS } = await import('./settle.js');

const LG = 'dgsettletest-nfl';
const H = 3_600_000;
const KO = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 30 * 24 * H); // a month out: nothing real collides
let leagueId; let tA; let tB; const players = []; const users = []; const M = {}; const C = {};

async function teardown() {
  const lg = await sql`SELECT id FROM leagues WHERE slug = ${LG}`;
  const ids = lg.map((r) => r.id);
  if (ids.length) {
    const teams = (await sql`SELECT id FROM teams WHERE league_id = ANY(${ids})`).map((r) => r.id);
    await sql`DELETE FROM contests WHERE match_id IN (SELECT id FROM matches WHERE league_id = ANY(${ids}))`;
    await sql`DELETE FROM matches WHERE league_id = ANY(${ids})`;
    await sql`DELETE FROM nfl_players WHERE team_id = ANY(${teams})`;
    await sql`DELETE FROM teams WHERE league_id = ANY(${ids})`;
    await sql`DELETE FROM leagues WHERE id = ANY(${ids})`;
  }
  await sql`DELETE FROM users WHERE email LIKE 'dgsettle-%@example.invalid'`;
}

before(async () => {
  await teardown();
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Draft Game Settle Test', 'nfl', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const mk = async (slug, abbr) => (await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${abbr}, ${abbr}, ${abbr}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  tA = await mk('dgsettletest-a', 'DSA'); tB = await mk('dgsettletest-b', 'DSB');
  for (let i = 0; i < 20; i += 1) {
    const pos = ['QB', 'RB', 'WR', 'TE'][i % 4];
    const name = `Dgsettletest Player ${i}`;
    const [p] = await sql`INSERT INTO nfl_players (full_name, normalized_name, position, team_id)
      VALUES (${name}, ${name.toLowerCase()}, ${pos}, ${i % 2 ? tA : tB}) RETURNING id`;
    players.push({ id: p.id, name, pos, team: i % 2 ? 'DSA' : 'DSB', team_id: i % 2 ? tA : tB, proj: 30 - i, games: 4 });
  }
  const mm = async (key, ko) => {
    M[key] = (await sql`
      INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                           season_year, season_phase, week, external_ids, metadata)
      VALUES (${leagueId}, ${'dgsettletest-' + key}, ${ko.toISOString()}, 'scheduled', ${tA}, ${tB}, 2099, 'REG', 98, '{}'::jsonb, '{}'::jsonb)
      RETURNING id, slug, kickoff_at, status, season_year, week, home_team_id, away_team_id`)[0];
    M[key].home = 'DSA'; M[key].away = 'DSB';
    const b = await createGameBoard(M[key], { now: new Date(ko.getTime() - 24 * H), buildPool: async () => players });
    C[key] = b.id;
  };
  await mm('main', KO);
  await mm('off', new Date(KO.getTime() + 3 * H));
  for (const n of [1, 2]) {
    users.push((await sql`INSERT INTO users (name, email) VALUES (${'DGS ' + n}, ${`dgsettle-${n}-${process.pid}@example.invalid`}) RETURNING id`)[0].id);
  }
  // Two readers drafted the main game (seats 1 and 2), one the game that gets called off.
  const pre = new Date(KO.getTime() - H);
  await startRoom(users[0], C.main, { now: pre, seat: 1 });
  await startRoom(users[1], C.main, { now: pre, seat: 2 });
  await startRoom(users[0], C.off, { now: pre, seat: 3 });
});

after(async () => {
  await teardown();
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM leagues WHERE slug = ${LG}`;
  assert.equal(n, 0, 'teardown left the fixture league');
});

/** Insert one PPR-worth receiving line per player id: pts -> rec_yds = pts*10. */
async function box(matchId, linesById) {
  for (const [id, pts] of linesById) {
    await sql`INSERT INTO nfl_player_game_stats (match_id, nfl_player_id, team_id, rec, rec_yds)
      VALUES (${matchId}, ${id}, ${tA}, 0, ${Math.round(pts * 10)})
      ON CONFLICT (match_id, nfl_player_id) DO UPDATE SET rec_yds = EXCLUDED.rec_yds`;
  }
}

test('live: the room scores from the box as it stands; nothing settles before the final', async () => {
  // Kickoff: both rooms are finished by the first read after the lock.
  const v1 = (await readRoom(users[0], C.main, { now: KO })).view;
  assert.equal(v1.done, true);
  const mine = v1.seats.find((s) => s.you).picks.map((p) => Number(p.id));
  // Give every pooled player a line except ONE of user 1's four: he did not play.
  const lines = new Map(players.map((p, i) => [p.id, 5 + (i % 9)]));
  lines.delete(mine[3]);
  await box(M.main.id, lines);
  await sql`UPDATE matches SET status = 'live', home_score = 10, away_score = 7 WHERE id = ${M.main.id}`;
  assert.equal((await settleGameBoard(C.main, { now: new Date(KO.getTime() + H) })).reason, 'not_final');
  const live = await liveResult(C.main, users[0]);
  const me = live.seats.find((s) => s.you);
  const dnp = me.players.find((p) => p.id === mine[3]);
  assert.equal(dnp.played, false); assert.equal(dnp.pts, 0); assert.equal(dnp.counted, false);
  const best3 = me.players.map((p) => p.pts).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  assert.equal(me.score, Math.round(best3 * 10) / 10);
  // The page shows the live card.
  const lv = (await readRoom(users[0], C.main, { now: new Date(KO.getTime() + H) })).view;
  assert.equal(lv.phase, 'live');
  assert.equal(lv.result.you.score, me.score);
});

test('final: grace first, then settle - best 3, the percentile, and never twice', async () => {
  await sql`UPDATE matches SET status = 'final', home_score = 27, away_score = 24 WHERE id = ${M.main.id}`;
  assert.equal((await settleGameBoard(C.main, { now: new Date(KO.getTime() + H) })).reason, 'grace');
  const at = new Date(KO.getTime() + (SETTLE_AFTER_HOURS + 0.1) * H);
  const r = await settleGameBoard(C.main, { now: at });
  assert.equal(r.settled, true); assert.equal(r.entries, 2);
  const rows = await sql`SELECT user_id, score, meta->'result' AS result, lineup FROM contest_entries WHERE contest_id = ${C.main} ORDER BY user_id`;
  assert.equal(rows.length, 2);
  for (const e of rows) {
    assert.equal(Number(e.score), e.result.you.score);
    assert.equal(e.result.final, true);
    assert.equal(e.result.entrants, 2);
    assert.equal(e.result.score_line, 'FINAL 24-27');
    assert.equal(e.lineup.players.length, 4);
  }
  const [hi, lo] = [...rows].sort((a, b) => Number(b.score) - Number(a.score));
  assert.equal(hi.result.top_pct, Number(hi.score) === Number(lo.score) ? 100 : 50);
  assert.equal(lo.result.top_pct, 100);
  const [c] = await sql`SELECT settled, meta FROM contests WHERE id = ${C.main}`;
  assert.equal(c.settled, true); assert.equal(c.meta.entrants, 2);
  assert.equal((await settleGameBoard(C.main, { now: at })).reason, 'already');
  const fv = (await readRoom(users[0], C.main, { now: at })).view;
  assert.equal(fv.phase, 'final');
  assert.equal(fv.result.top_pct != null, true);
});

test('a game called off settles void: the room is kept, nobody scores', async () => {
  await sql`UPDATE matches SET status = 'postponed' WHERE id = ${M.off.id}`;
  const r = await settleGameBoard(C.off, { now: new Date(KO.getTime() + 10 * H) });
  assert.equal(r.settled, true); assert.equal(r.void, true);
  const [e] = await sql`SELECT score, meta FROM contest_entries WHERE contest_id = ${C.off}`;
  assert.equal(e.score, null);
  assert.equal(e.meta.result.void, true);
  assert.ok(Array.isArray(e.meta.room.picks), 'the room is kept');
});
