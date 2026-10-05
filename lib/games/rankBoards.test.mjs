// lib/games/rankBoards.test.mjs - THE TIE RULE (sun-16 C) through the boards
// that rank in SQL: the real readers against DEV, on a sentinel sport.
//
// THE FIXTURE: four sentinel readers on one settled board. A and B tie on 10;
// B SUBMITTED FIRST although A has the lower user id (so an id tiebreak and
// the clock disagree, and only the clock passes). C is behind on 8 - 3rd, not
// 2nd. D has no score. Season 1999 and a sentinel sport, so no real board or
// other suite's "current contest" can ever see it; torn down by id, and the
// teardown asserts itself.

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
const { scoreLeaderboard, draftFieldLeaderboard, pickemBoardLeaderboard } = await import('./leaderboard.js');
const { weeklyBoardTable } = await import('../weekly/live.js');
const { lockEntries } = await import('../weekly/entries.js');
const { daySettleAlerts } = await import('../october/alerts.js');
const { roundSettleAlerts } = await import('../run/alerts.js');
const { pickemResults } = await import('../results/pickem.js');

const NS = `sentinel-ties-${process.pid}-${Date.now()}`;
const SPORT = NS.slice(0, 40);
const ids = { users: [], contests: [] };
const U = {};
const T = (min) => new Date(Date.UTC(2026, 9, 1, 12, min)).toISOString();

before(async () => {
  for (const k of ['a', 'b', 'c', 'd']) {
    const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}-${k}@example.invalid`}) RETURNING id`;
    ids.users.push(u.id); U[k] = u.id;
  }
  const past = new Date(Date.now() - 86400e3).toISOString();
  const [w] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, settled_at, meta)
    VALUES ('weekly', ${SPORT}, 1999, 97, '[]'::jsonb, ${past}, ${past}, true, now(), '{}'::jsonb) RETURNING id`;
  const results = { 1: 'home', 2: 'home' };
  const [p] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, settled_at, perfect, meta)
    VALUES ('pickem', ${SPORT}, 1999, 97,
            ${JSON.stringify([{ match_id: 1, home: 'H1', away: 'A1' }, { match_id: 2, home: 'H2', away: 'A2' }])}::jsonb,
            ${past}, ${past}, true, now(), ${JSON.stringify({ results, max: 2 })}::jsonb, '{}'::jsonb) RETURNING id`;
  ids.contests.push(w.id, p.id);
  ids.weekly = w.id; ids.pickem = p.id;
  const entry = (cid, uid, score, at, lineup = {}, meta = {}) => sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, score, meta, submitted_at)
    VALUES (${cid}, ${uid}, ${JSON.stringify(lineup)}::jsonb, ${score}, ${JSON.stringify(meta)}::jsonb, ${at})`;
  await entry(w.id, U.a, 10, T(30));
  await entry(w.id, U.b, 10, T(10));
  await entry(w.id, U.c, 8, T(0));
  await entry(w.id, U.d, null, T(5));
  await entry(p.id, U.a, 2, T(30), { 1: 'home', 2: 'home' });
  await entry(p.id, U.b, 2, T(10), { 1: 'home', 2: 'home' });
  await entry(p.id, U.c, 1, T(0), { 1: 'home', 2: 'away' });
});

after(async () => {
  await sql`DELETE FROM contests WHERE id = ANY(${ids.contests})`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE sport = ${SPORT})
         + (SELECT count(*)::int FROM users WHERE email LIKE ${`${NS}%`}) AS n`;
  assert.equal(left.n, 0, 'the sentinels are gone');
});

const order = (rows) => rows.map((r) => r.userId);
const places = (rows) => rows.map((r) => r.rank);

test('Weekly/Draft grade leaderboard (scoreLeaderboard): 1, 1, 3, earliest submission first', async () => {
  const lb = await scoreLeaderboard(ids.weekly, null, { limit: 10, game: 'weekly' });
  assert.deepEqual(order(lb.top), [U.b, U.a, U.c]);
  assert.deepEqual(places(lb.top), [1, 1, 3]);
});

test('Draft field leaderboard: the same rule, places as numbers', async () => {
  const lb = await draftFieldLeaderboard(ids.weekly, null, { limit: 10 });
  assert.deepEqual(order(lb.top), [U.b, U.a, U.c]);
  assert.deepEqual(places(lb.top), [1, 1, 3]);
});

test("Pick'em board leaderboard: National and a league both run the rule", async () => {
  const nat = await pickemBoardLeaderboard(ids.pickem, null, { limit: 10 });
  assert.deepEqual(order(nat.top), [U.b, U.a, U.c]);
  assert.deepEqual(places(nat.top), [1, 1, 3]);
  const lg = await pickemBoardLeaderboard(ids.pickem, null, { limit: 10, memberIds: [U.a, U.c] });
  assert.deepEqual(order(lg.top), [U.a, U.c]);
  assert.deepEqual(places(lg.top), [1, 2], 're-ranked within the league');
});

test("Pick'em results scoreboard: 1, 1, 3 by record (it was dense: 1, 1, 2)", async () => {
  const r = await pickemResults(ids.pickem, U.c);
  assert.deepEqual(r.scoreboard.rows.map((x) => x.userId), [U.b, U.a, U.c]);
  assert.deepEqual(r.scoreboard.rows.map((x) => x.rank), [1, 1, 3]);
  assert.equal(r.header.rank, 3);
  assert.equal(r.tied, 2);
});

test('Weekly settled board table: rank() places, earliest submission first', async () => {
  const t = await weeklyBoardTable({ id: ids.weekly, locks_at: new Date(Date.now() - 86400e3), settled: true, week: 97 }, U.c, { limit: 10 });
  assert.deepEqual(order(t.top), [U.b, U.a, U.c]);
  assert.deepEqual(places(t.top), [1, 1, 3]);
});

test('settle pushes (October/The Run shape): "1st" for everyone on a tie, the next is "3rd"', async () => {
  const oct = await daySettleAlerts(ids.weekly);
  const rankOf = (rows, uid) => rows.find((r) => r.userId === uid)?.params?.rank;
  assert.equal(rankOf(oct, U.a), '1st');
  assert.equal(rankOf(oct, U.b), '1st');
  assert.equal(rankOf(oct, U.c), '3rd');
  const run = await roundSettleAlerts(ids.weekly);
  assert.equal(rankOf(run, U.a), '1st');
  assert.equal(rankOf(run, U.c), '3rd');
});

test('submitted_at is the READER\'s: the lock (and the confirm, and settle) never write it', async () => {
  const [{ id: cid }] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, meta)
    VALUES ('weekly', ${SPORT}, 1999, 96, '[]'::jsonb, ${new Date(Date.now() - 86400e3).toISOString()},
            ${new Date(Date.now() - 3600e3).toISOString()}, false, '{}'::jsonb) RETURNING id`;
  ids.contests.push(cid);
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, submitted_at) VALUES (${cid}, ${U.a}, '{}'::jsonb, ${T(1)})`;
  const r = await lockEntries(cid);
  assert.equal(r.locked, 1);
  const [e] = await sql`SELECT submitted_at, locked_at FROM contest_entries WHERE contest_id = ${cid} AND user_id = ${U.a}`;
  assert.ok(e.locked_at, 'the lock landed');
  assert.equal(new Date(e.submitted_at).toISOString(), T(1), 'and left the submission alone');
});
