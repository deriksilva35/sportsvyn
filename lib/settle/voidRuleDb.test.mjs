// lib/settle/voidRuleDb.test.mjs - the sun-8 void rule, end to end on DEV.
//
// A Run PREVIEW round and an October day, each holding a game that will never
// be final. Before settles_at + 48h the settle refuses; after it the void game
// is void, its player scores 0 (even with a half-game of stat lines on it),
// the rest score, and contests.meta.void stores the list.
//
// SENTINELS IN SEASON 1998, slugs `sentinel-voidrule-<pid>-<ts>-*`, users at
// example.invalid. Every row is created here and deleted by id in after(),
// which asserts its own teardown.

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
const { settleRunRound } = await import('../run/settle.js');
const { settleOctoberDay } = await import('../october/settle.js');
const { slotPoints, round1 } = await import('../mlb/fantasyPoints.js');

const SEASON = 1998;
const NS = `sentinel-voidrule-${process.pid}-${Date.now()}`;
// A FIXED CLOCK. settles_at S, first pitch 10h before it; "before" is S+47h
// (57h after first pitch, inside October's 72h postponement rule too) and
// "after" is S+49h.
const S = new Date('1998-10-02T12:00:00.000Z');
const KO = new Date(S.getTime() - 10 * 3600e3).toISOString();
const BEFORE = new Date(S.getTime() + 47 * 3600e3);
const AFTER = new Date(S.getTime() + 49 * 3600e3);

const P = 910000000 + (process.pid % 100000) * 10;
const PL = { arm: P, a: P + 1, b: P + 2, c: P + 3, d: P + 4 };
const ids = { users: [], matches: {}, contests: {} };
let teams = [];

const ARM_ROW = { outs_recorded: 18, strikeouts_pitched: 7, earned_runs: 1, wins: 1 };
const A_ROW = { at_bats: 4, hits: 2, home_runs: 1, rbi: 2, runs: 1 };
const HALF = { at_bats: 2, hits: 2, home_runs: 1, rbi: 3, runs: 1 };   // the void game's half-game

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'mlb'`;
  teams = (await sql`SELECT id, abbreviation FROM teams WHERE league_id = ${lg.id} ORDER BY id LIMIT 6`);
  assert.equal(teams.length, 6, 'DEV has MLB clubs to borrow');
  const T = teams.map((t) => t.id);
  const mkMatch = async (tag, status, home, away) => (await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, season_year, season_phase, external_ids, metadata)
    VALUES (${lg.id}, ${`${NS}-${tag}`}, ${status}, ${home}, ${away}, ${KO}, ${SEASON}, 'POST', '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
  ids.matches.final = await mkMatch('final', 'final', T[0], T[1]);
  ids.matches.cancelled = await mkMatch('cancelled', 'cancelled', T[2], T[3]);
  ids.matches.postponed = await mkMatch('postponed', 'postponed', T[4], T[5]);

  const box = (matchId, pid, teamId, r) => sql`
    INSERT INTO mlb_player_game_stats (match_id, bdl_player_id, player_name, team_id,
      at_bats, hits, home_runs, rbi, runs, outs_recorded, strikeouts_pitched, earned_runs, wins)
    VALUES (${matchId}, ${pid}, ${`Sentinel ${pid}`}, ${teamId},
      ${r.at_bats ?? 0}, ${r.hits ?? 0}, ${r.home_runs ?? 0}, ${r.rbi ?? 0}, ${r.runs ?? 0},
      ${r.outs_recorded ?? 0}, ${r.strikeouts_pitched ?? 0}, ${r.earned_runs ?? 0}, ${r.wins ?? 0})`;
  await box(ids.matches.final, PL.arm, T[0], ARM_ROW);
  await box(ids.matches.final, PL.a, T[0], A_ROW);
  await box(ids.matches.cancelled, PL.b, T[2], HALF);
  await box(ids.matches.postponed, PL.c, T[4], HALF);

  for (const k of ['a', 'b']) {
    ids.users.push((await sql`
      INSERT INTO users (email) VALUES (${`${NS}-${k}@example.invalid`}) RETURNING id`)[0].id);
  }
  const [U1, U2] = ids.users;

  // THE RUN PREVIEW: the final game and the cancelled one - #26's shape.
  const clubs = teams.slice(0, 4).map((t) => ({ teamId: t.id, abbr: t.abbreviation, bye: false, games: 1 }));
  ids.contests.run = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('run', 'mlb', ${SEASON}, NULL, '1998-10-01', ${JSON.stringify(clubs)}::jsonb,
            ${new Date(S.getTime() - 5 * 86400e3).toISOString()}, ${KO}, ${S.toISOString()},
            ${JSON.stringify({ preview: true, round: 'world_series', matchIds: [ids.matches.final, ids.matches.cancelled] })}::jsonb)
    RETURNING id`)[0].id;
  const runLineup = {
    arm1: { playerId: String(PL.arm), teamId: T[0] },
    bat1: { playerId: String(PL.a), teamId: T[0] },
    bat2: { playerId: String(PL.b), teamId: T[2] },          // on the cancelled game
  };
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES
    (${ids.contests.run}, ${U1}, ${JSON.stringify(runLineup)}::jsonb),
    (${ids.contests.run}, ${U2}, ${JSON.stringify({ bat1: { playerId: String(PL.b), teamId: T[2] } })}::jsonb)`;

  // THE OCTOBER DAY: final, cancelled (void at once, thu-26) and postponed
  // (blocks until the cutoff - 57h after first pitch is inside the 72h rule).
  const board = [
    { match_id: ids.matches.final, slug: `${NS}-final`, kickoff_at: KO },
    { match_id: ids.matches.cancelled, slug: `${NS}-cancelled`, kickoff_at: KO },
    { match_id: ids.matches.postponed, slug: `${NS}-postponed`, kickoff_at: KO },
  ];
  ids.contests.october = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('october', 'mlb', ${SEASON}, NULL, '1998-10-01', ${JSON.stringify(board)}::jsonb,
            ${new Date(S.getTime() - 5 * 86400e3).toISOString()}, ${KO}, ${S.toISOString()},
            ${JSON.stringify({ games: 3 })}::jsonb)
    RETURNING id`)[0].id;
  const card = {
    arm: { playerId: String(PL.arm), matchId: ids.matches.final },
    bat1: { playerId: String(PL.a), matchId: ids.matches.final },
    bat2: { playerId: String(PL.b), matchId: ids.matches.cancelled },
    bat3: { playerId: String(PL.c), matchId: ids.matches.postponed },
    bat4: { playerId: String(PL.d), matchId: ids.matches.final },     // did not appear: 0
  };
  await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES
    (${ids.contests.october}, ${U1}, ${JSON.stringify(card)}::jsonb)`;
  // ALL-VOID BOARDS (ruling sun-10 item 4): one postponed, one cancelled, nothing final.
  ids.matches.vPost = await mkMatch('allvoid-postponed', 'postponed', T[0], T[1]);
  ids.matches.vCanc = await mkMatch('allvoid-cancelled', 'cancelled', T[2], T[3]);
  const vIds = [ids.matches.vPost, ids.matches.vCanc];
  const vBoard = vIds.map((id, i) => ({ match_id: id, slug: `${NS}-allvoid-${i}`, kickoff_at: KO }));
  const opens = new Date(S.getTime() - 5 * 86400e3).toISOString();
  ids.contests.runVoid = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('run', 'mlb', ${SEASON}, NULL, '1998-10-03', ${JSON.stringify(clubs)}::jsonb, ${opens}, ${KO}, ${S.toISOString()},
            ${JSON.stringify({ preview: true, round: 'world_series', roundIndex: 4, matchIds: vIds })}::jsonb) RETURNING id`)[0].id;
  ids.contests.octVoid = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('october', 'mlb', ${SEASON}, NULL, '1998-10-03', ${JSON.stringify(vBoard)}::jsonb, ${opens}, ${KO}, ${S.toISOString()},
            ${JSON.stringify({ games: 2 })}::jsonb) RETURNING id`)[0].id;
  ids.contests.pickVoid = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', 'nfl', ${SEASON}, 98, ${JSON.stringify(vBoard)}::jsonb, ${opens}, ${KO}, ${S.toISOString()}, '{}'::jsonb)
    RETURNING id`)[0].id;
  for (const cid of [ids.contests.runVoid, ids.contests.octVoid, ids.contests.pickVoid]) {
    await sql`INSERT INTO contest_entries (contest_id, user_id, lineup) VALUES (${cid}, ${U1}, '{}'::jsonb)`;
  }
});

after(async () => {
  const cids = Object.values(ids.contests).filter(Boolean);
  const mids = Object.values(ids.matches).filter(Boolean);
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${cids})`;
  await sql`DELETE FROM contests WHERE id = ANY(${cids})`;
  await sql`DELETE FROM mlb_player_game_stats WHERE match_id = ANY(${mids})`;
  await sql`DELETE FROM matches WHERE id = ANY(${mids})`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE id = ANY(${cids}))
         + (SELECT count(*)::int FROM contest_entries WHERE contest_id = ANY(${cids}))
         + (SELECT count(*)::int FROM matches WHERE slug LIKE ${`${NS}%`})
         + (SELECT count(*)::int FROM mlb_player_game_stats WHERE match_id = ANY(${mids}))
         + (SELECT count(*)::int FROM users WHERE email LIKE ${`${NS}%`}) AS n`;
  assert.equal(left.n, 0, 'every sentinel row is gone');
});

const contestRow = async (id) => (await sql`
  SELECT id, board, meta, week, puzzle_date, season_year, settles_at, settled FROM contests WHERE id = ${id}`)[0];
const entries = async (id) => new Map((await sql`
  SELECT user_id, score, meta FROM contest_entries WHERE contest_id = ${id}`).map((e) => [e.user_id, e]));

test('THE RUN PREVIEW: a cancelled game blocks before settles_at + 48h, and is void after it', async () => {
  const before = await settleRunRound(await contestRow(ids.contests.run), { now: BEFORE });
  assert.equal(before.settled, false);
  assert.equal(before.reason, 'games-pending');
  assert.equal(before.remaining, 1);
  assert.equal((await contestRow(ids.contests.run)).settled, false);

  const done = await settleRunRound(await contestRow(ids.contests.run), { now: AFTER });
  assert.equal(done.settled, true, JSON.stringify(done));
  assert.deepEqual(done.void, [ids.matches.cancelled]);
  const c = await contestRow(ids.contests.run);
  assert.equal(c.settled, true);
  assert.deepEqual(c.meta.void, [ids.matches.cancelled], 'meta.void is stored');
  assert.equal(c.meta.preview, true, 'the rest of meta survives the merge');
  assert.deepEqual(c.meta.matchIds, [ids.matches.final, ids.matches.cancelled]);

  const [U1, U2] = ids.users;
  const e = await entries(ids.contests.run);
  const want = round1(slotPoints('arm', ARM_ROW) + slotPoints('bat', A_ROW));
  assert.equal(Number(e.get(U1).score), want, 'the arm and bat1 score; the cancelled game\'s bat scores 0');
  assert.equal(Number(e.get(U2).score), 0, 'a nine whose only player was on the void game scores 0');
  assert.equal(e.get(U2).meta.run.state, 'short', 'a short nine, not a DNF - the DNF rule is untouched');
});

test('THE OCTOBER DAY: a postponed game blocks before the cutoff; after it, both void, meta.void stored', async () => {
  const before = await settleOctoberDay(await contestRow(ids.contests.october), { now: BEFORE });
  assert.equal(before.settled, false);
  assert.equal(before.remaining, 1);
  assert.deepEqual(before.waitingOn.map((g) => g.status), ['postponed'],
    'the cancelled game does not hold the day (thu-26); the postponed one does');

  const done = await settleOctoberDay(await contestRow(ids.contests.october), { now: AFTER });
  assert.equal(done.settled, true, JSON.stringify(done));
  const voidIds = [ids.matches.cancelled, ids.matches.postponed].sort((a, b) => a - b);
  assert.deepEqual(done.voidIds, voidIds);
  const c = (await sql`SELECT settled, meta, perfect FROM contests WHERE id = ${ids.contests.october}`)[0];
  assert.equal(c.settled, true);
  assert.deepEqual(c.meta.void, voidIds, 'meta.void is stored');
  assert.equal(c.meta.games, 3, 'the rest of meta survives the merge');
  assert.deepEqual(c.perfect.void.sort(), [`${NS}-cancelled`, `${NS}-postponed`], 'perfect.void keeps its slugs');

  const e = await entries(ids.contests.october);
  const want = round1(slotPoints('arm', ARM_ROW) + slotPoints('bat1', A_ROW));
  assert.equal(Number(e.get(ids.users[0]).score), want, 'both void slots score 0 despite their half-game rows');
  assert.equal(e.get(ids.users[0]).meta.october.state, 'complete');
});

// ---------------------------------------------------------------------------
// THE ALL-VOID CLOSE (ruling sun-10 item 4)
// ---------------------------------------------------------------------------
const { gradePickemBoard } = await import('../pickem/settle.js');
const { roundSettleAlerts } = await import('../run/alerts.js');
const { daySettleAlerts } = await import('../october/alerts.js');

async function assertClosedVoid(id, label) {
  const [c] = await sql`SELECT settled, settled_at, meta, perfect FROM contests WHERE id = ${id}`;
  assert.equal(c.settled, true, `${label}: settled`);
  assert.ok(c.settled_at, `${label}: settled_at stamped`);
  assert.equal(c.meta.void_all, true, `${label}: meta.void_all`);
  assert.deepEqual(c.meta.void, [ids.matches.vPost, ids.matches.vCanc].sort((a, b) => a - b), `${label}: meta.void names every game`);
  assert.equal(c.perfect, null, `${label}: perfect left null`);
  const es = await sql`SELECT score, base_score, meta FROM contest_entries WHERE contest_id = ${id}`;
  assert.equal(es.length, 1);
  assert.equal(es[0].score, null, `${label}: no score`);
  assert.deepEqual(es[0].meta ?? {}, {}, `${label}: no DNF, no state written`);
}

test('ALL-VOID: a Run preview, an October day and a Pick\'em board each CLOSE as void - settled, no scores, no push', async () => {
  // Before the cutoff the postponed game still blocks the Run preview.
  const early = await settleRunRound(await contestRow(ids.contests.runVoid), { now: BEFORE });
  assert.equal(early.settled, false);
  assert.equal(early.reason, 'games-pending');

  const run = await settleRunRound(await contestRow(ids.contests.runVoid), { now: AFTER });
  assert.deepEqual([run.settled, run.voidAll, run.closed], [false, true, true], 'settled:false in the result - no push hook fires');
  await assertClosedVoid(ids.contests.runVoid, 'run');
  assert.deepEqual(await roundSettleAlerts(ids.contests.runVoid), [], 'no run-settled push');

  const oct = await settleOctoberDay(await contestRow(ids.contests.octVoid), { now: AFTER });
  assert.deepEqual([oct.settled, oct.voidAll, oct.closed], [false, true, true]);
  await assertClosedVoid(ids.contests.octVoid, 'october');
  assert.deepEqual(await daySettleAlerts(ids.contests.octVoid), [], 'no october-settled push');

  const pk = await gradePickemBoard(await contestRow(ids.contests.pickVoid), { now: AFTER });
  assert.deepEqual([pk.settled, pk.voidAll, pk.closed], [false, true, true]);
  await assertClosedVoid(ids.contests.pickVoid, 'pickem');

  // Idempotent: a second pass closes nothing.
  const again = await settleOctoberDay(await contestRow(ids.contests.octVoid), { now: AFTER });
  assert.equal(again.closed, false);
});

test('ALL-VOID: the October and Run boards do not count the closed day/round', async () => {
  const { octoberBoard } = await import('../october/board.js');
  const { runBoard } = await import('../run/board.js');
  const ob = (await octoberBoard(SEASON, { now: AFTER, preview: false })).find((r) => r.userId === ids.users[0]);
  // Only the real day (settled in the test above) counts: one day, no DNF.
  if (ob) { assert.equal(ob.days, 1); assert.equal(ob.dnf, 0); }
  const rb = (await runBoard(SEASON, { preview: true })).find((r) => r.userId === ids.users[0]);
  if (rb) assert.equal(rb.rounds.world_series ?? null, null, 'the void round is a dash, not points or DNF');
});
