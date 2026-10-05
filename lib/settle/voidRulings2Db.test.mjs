// lib/settle/voidRulings2Db.test.mjs - ruling sun-12 end to end on DEV.
//
// (a) A Six night, an EPL Weekly 5 gameweek and an NBA day board whose every
//     game is void each CLOSE as void: settled, meta.void_all, meta.void =
//     every game, entries unscored and unranked, perfect null, settled:false
//     in the result (no settle hook fires). The Six re-grade skips it.
// (b) The Run: a pick on a club whose only game in a settled round was void
//     is released by usedPlayers; a pick on a club that played is not.
//
// SENTINELS IN SEASON 1997, slugs `sentinel-voidr2-<pid>-<ts>-*`, users at
// example.invalid. Deleted by id in after(), which asserts its own teardown.

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
const { settleSixNight } = await import('../six/settle.js');
const { settleGameweek } = await import('../eplWeekly5/settle.js');
const { settleDayBoard } = await import('../nba/dayPickem.js');
const { usedPlayers } = await import('../run/pool.js');

const SEASON = 1997;
const NS = `sentinel-voidr2-${process.pid}-${Date.now()}`;
const KO = new Date(Date.now() - 3 * 86400e3).toISOString();
const ids = { users: [], matches: {}, contests: {} };
let T = [];

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'mlb'`;
  T = (await sql`SELECT id FROM teams WHERE league_id = ${lg.id} ORDER BY id LIMIT 4`).map((t) => t.id);
  assert.equal(T.length, 4);
  const mk = async (tag, status, home, away) => (await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, season_year, season_phase, external_ids, metadata)
    VALUES (${lg.id}, ${`${NS}-${tag}`}, ${status}, ${home}, ${away}, ${KO}, ${SEASON}, 'POST', '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
  ids.matches.post = await mk('post', 'postponed', T[0], T[1]);
  ids.matches.canc = await mk('canc', 'cancelled', T[2], T[3]);
  ids.matches.final = await mk('final', 'final', T[0], T[1]);
  ids.users.push((await sql`INSERT INTO users (email) VALUES (${`${NS}-a@example.invalid`}) RETURNING id`)[0].id);
  const [U] = ids.users;

  const voidBoard = [ids.matches.post, ids.matches.canc].map((id, i) => ({ match_id: id, slug: `${NS}-g${i}`, kickoff_at: KO }));
  const opens = new Date(Date.now() - 5 * 86400e3).toISOString();
  const ins = async (gameType, sport, week, day, meta) => (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES (${gameType}, ${sport}, ${SEASON}, ${week}, ${day}, ${JSON.stringify(voidBoard)}::jsonb, ${opens}, ${KO}, ${KO},
            ${JSON.stringify(meta)}::jsonb) RETURNING id`)[0].id;
  ids.contests.six = await ins('six', 'nba', null, '1997-10-01', {});
  ids.contests.epl5 = await ins('epl_weekly_5', 'epl', 97, null, {});
  ids.contests.nbaDay = await ins('pickem', 'nba', null, '1997-10-01', { day_board: true, day_et: '1997-10-01' });
  for (const cid of [ids.contests.six, ids.contests.epl5, ids.contests.nbaDay]) {
    await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${cid}, ${U}, '{}'::jsonb)`;
  }

  // (b) A SETTLED Run preview round: club T0 played a counted game (final)
  // and club T2 only the cancelled one, which meta.void names.
  ids.contests.run = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, settled, settled_at, meta)
    VALUES ('run', 'mlb', ${SEASON}, NULL, '1997-10-02', '[]'::jsonb, ${opens}, ${KO}, ${KO}, true, now(),
            ${JSON.stringify({ preview: true, round: 'wild_card', matchIds: [ids.matches.final, ids.matches.canc], void: [ids.matches.canc] })}::jsonb)
    RETURNING id`)[0].id;
  // ... and a void_all Run preview round, whose whole roster is released.
  ids.contests.runVoidAll = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, settled, settled_at, meta)
    VALUES ('run', 'mlb', ${SEASON}, NULL, '1997-10-03', '[]'::jsonb, ${opens}, ${KO}, ${KO}, true, now(),
            ${JSON.stringify({ preview: true, round: 'division', matchIds: [ids.matches.post], void: [ids.matches.post], void_all: true })}::jsonb)
    RETURNING id`)[0].id;
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES
    (${ids.contests.run}, ${U}, ${JSON.stringify({
      bat1: { playerId: '7001', teamId: T[0] },     // played the final: burned
      bat2: { playerId: '7002', teamId: T[2] },     // only the void game: released
    })}::jsonb),
    (${ids.contests.runVoidAll}, ${U}, ${JSON.stringify({ bat1: { playerId: '7003', teamId: T[0] } })}::jsonb)`;
});

after(async () => {
  const cids = Object.values(ids.contests).filter(Boolean);
  const mids = Object.values(ids.matches).filter(Boolean);
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${cids})`;
  await sql`DELETE FROM contests WHERE id = ANY(${cids})`;
  await sql`DELETE FROM matches WHERE id = ANY(${mids})`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE id = ANY(${cids}))
         + (SELECT count(*)::int FROM contest_entries WHERE contest_id = ANY(${cids}))
         + (SELECT count(*)::int FROM matches WHERE slug LIKE ${`${NS}%`})
         + (SELECT count(*)::int FROM users WHERE email LIKE ${`${NS}%`}) AS n`;
  assert.equal(left.n, 0, 'every sentinel row is gone');
});

const row = async (id) => (await sql`SELECT * FROM contests WHERE id = ${id}`)[0];

async function assertClosedVoid(id, label) {
  const c = await row(id);
  assert.equal(c.settled, true, `${label}: settled`);
  assert.equal(c.meta.void_all, true, `${label}: meta.void_all`);
  assert.deepEqual(c.meta.void, [ids.matches.post, ids.matches.canc].sort((a, b) => a - b), `${label}: meta.void`);
  assert.equal(c.perfect, null, `${label}: no perfect`);
  const es = await sql`SELECT score, base_score, meta FROM contest_entries WHERE contest_id = ${id}`;
  assert.equal(es.length, 1);
  assert.equal(es[0].score, null, `${label}: no score`);
  assert.deepEqual(es[0].meta ?? {}, {}, `${label}: no rank, no state`);
}

test('SIX: an all-void night closes as VOID, and the re-grade predicate skips it', async () => {
  const r = await settleSixNight(await row(ids.contests.six));
  assert.deepEqual([r.settled, r.voidAll, r.closed], [false, true, true], 'settled:false - no hook announces it');
  await assertClosedVoid(ids.contests.six, 'six');
  // The re-grade's own read, run here as a SELECT (calling regradeRecentSix
  // would re-grade real DEV nights): its WHERE leaves the void night out.
  const [hit] = await sql`
    SELECT count(*)::int AS n FROM contests
     WHERE id = ${ids.contests.six} AND settled AND NOT COALESCE((meta->>'void_all')::boolean, false)`;
  assert.equal(hit.n, 0, 'the re-grade predicate excludes it');
});

test('EPL WEEKLY 5: an all-void gameweek closes as VOID; the correction path skips it', async () => {
  const r = await settleGameweek(await row(ids.contests.epl5), { now: new Date() });
  assert.deepEqual([r.settled, r.voidAll, r.closed], [false, true, true]);
  await assertClosedVoid(ids.contests.epl5, 'epl5');
  const again = await settleGameweek(await row(ids.contests.epl5), { now: new Date(), force: true });
  assert.equal(again.skipped, 'void_all');
  assert.equal((await sql`SELECT score FROM contest_entries WHERE contest_id = ${ids.contests.epl5}`)[0].score, null);
});

test('NBA DAY BOARD: an all-void day closes as VOID', async () => {
  const r = await settleDayBoard(await row(ids.contests.nbaDay));
  assert.deepEqual([r.settled, r.voidAll, r.closed], [false, true, true]);
  await assertClosedVoid(ids.contests.nbaDay, 'nba day');
});

test('THE RUN: a pick whose club played only the void game is released; the rest stay burned', async () => {
  const used = await usedPlayers(ids.users[0], SEASON, { preview: true });
  assert.equal(used.get('7001'), 'wild_card', 'played a counted game: burned');
  assert.equal(used.has('7002'), false, 'only the void game: released');
  assert.equal(used.has('7003'), false, 'a void_all round releases its roster');
});
