// Tonight's Six, ruling sat-5 S3, against DEV: a box corrected after the night
// is graded RE-GRADES it within 7 days of the tip - scores, ranks and the
// perfect six - keeping settled_at and recording regraded_at; a second pass
// writes nothing; a night older than 7 days is left alone. The box re-pull is
// a stub here (the tick passes syncNbaGameStats).
//
// Sentinel rows only - two teams and two matches in the NBA league with slugs
// carrying "test", one contest on 2083-01-15, two users on @example.test - made
// in before() and removed in after(), which asserts its own teardown.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { sql } = await import('../db.js');
const { settleSixNight, regradeRecentSix } = await import('./settle.js');

const TAG = `test-six-regrade-${process.pid}`;
const DAY = '2083-01-15';
const TIP = '2083-01-16T00:00:00.000Z';
const F = {};
const H = 3600e3;
const after_ = (h) => new Date(Date.parse(TIP) + h * H);

before(async () => {
  const [nba] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
  const teams = await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation)
    VALUES (${nba.id}, ${`${TAG}-h`}, 'Test Homers', 'Homers', 'TSH'),
           (${nba.id}, ${`${TAG}-a`}, 'Test Aways', 'Aways', 'TSA')
    RETURNING id, abbreviation`;
  F.h = teams.find((t) => t.abbreviation === 'TSH').id;
  F.a = teams.find((t) => t.abbreviation === 'TSA').id;
  const ms = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, home_score, away_score)
    VALUES (${nba.id}, ${`${TAG}-m1`}, ${F.h}, ${F.a}, ${TIP}, 'final', 2082, 100, 90),
           (${nba.id}, ${`${TAG}-m2`}, ${F.a}, ${F.h}, ${TIP}, 'postponed', 2082, NULL, NULL)
    RETURNING id, slug`;
  F.m1 = ms.find((m) => m.slug.endsWith('m1')).id;
  F.m2 = ms.find((m) => m.slug.endsWith('m2')).id;
  const line = (pid, team, pos, pts, reb = 0) => ({ match_id: F.m1, team_id: team, bdl_player_id: pid, player_name: `Test ${pid}`, position: pos, seconds: 1800, dnp: false, pts, reb, ast: 0, stl: 0, blk: 0, turnovers: 0, fg3m: 0 });
  const box = [
    line('t1', F.h, 'G', 30), line('t2', F.h, 'G', 20), line('t3', F.h, 'F', 18), line('t4', F.a, 'F', 16),
    line('t5', F.a, 'C', 14), line('t6', F.a, 'G', 12), line('t7', F.a, 'C', 10),
  ];
  await sql`
    INSERT INTO nba_player_game_stats (match_id, team_id, bdl_player_id, player_name, position, seconds, dnp, pts, reb, ast, stl, blk, turnovers, fg3m)
    SELECT x.match_id, x.team_id, x.bdl_player_id, x.player_name, x.position, x.seconds, x.dnp, x.pts, x.reb, x.ast, x.stl, x.blk, x.turnovers, x.fg3m
      FROM jsonb_to_recordset(${JSON.stringify(box)}::jsonb) AS x(match_id int, team_id int, bdl_player_id text, player_name text,
           position text, seconds int, dnp bool, pts int, reb int, ast int, stl int, blk int, turnovers int, fg3m int)`;
  const board = [
    { match_id: F.m1, slug: `${TAG}-m1`, kickoff_at: TIP, home_team_id: F.h, away_team_id: F.a, home: { abbr: 'TSH' }, away: { abbr: 'TSA' } },
    { match_id: F.m2, slug: `${TAG}-m2`, kickoff_at: TIP, home_team_id: F.a, away_team_id: F.h, home: { abbr: 'TSA' }, away: { abbr: 'TSH' } },
  ];
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES ('six', 'nba', 2082, ${DAY}::date, ${JSON.stringify(board)}::jsonb, ${after_(-18).toISOString()}, ${TIP},
            ${after_(6).toISOString()}, ${JSON.stringify({ day_et: DAY, test: TAG })}::jsonb)
    RETURNING id, board`;
  F.contest = c;
  const us = await sql`
    INSERT INTO users (name, email) VALUES ('Six R1', ${`${TAG}-1@example.test`}), ('Six R2', ${`${TAG}-2@example.test`})
    RETURNING id`;
  [F.u1, F.u2] = us.map((u) => u.id);
  const P = (pid, matchId, teamId, position) => ({ playerId: pid, matchId, teamId, position, name: pid });
  // u1: t1 (30) + t4 (16) = 46. u2: t2 (20) + t3 (18) + a slot on the VOID game (0) = 38.
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${c.id}, ${F.u1}, ${JSON.stringify({ g1: P('t1', F.m1, F.h, 'G'), f1: P('t4', F.m1, F.a, 'F') })}::jsonb),
           (${c.id}, ${F.u2}, ${JSON.stringify({ g1: P('t2', F.m1, F.h, 'G'), f1: P('t3', F.m1, F.h, 'F'), c: P('zz', F.m2, F.a, 'C') })}::jsonb)`;
});

after(async () => {
  if (F.contest?.id) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${F.contest.id}`;
    await sql`DELETE FROM contests WHERE id = ${F.contest.id}`;
  }
  await sql`DELETE FROM nba_player_game_stats WHERE match_id = ANY(${[F.m1, F.m2].filter(Boolean)})`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM teams WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${TAG}-%`}`;
  const [left] = await sql`
    SELECT (SELECT count(*) FROM matches WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM teams WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM users WHERE email LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM contests WHERE game_type = 'six' AND meta->>'test' = ${TAG})::int AS n`;
  assert.equal(left.n, 0, 'teardown left nothing');
});

const entry = async (u) => (await sql`SELECT score, meta FROM contest_entries WHERE contest_id = ${F.contest.id} AND user_id = ${u}`)[0];
const night = async () => (await sql`SELECT settled, settled_at, perfect, meta FROM contests WHERE id = ${F.contest.id}`)[0];
// Only this test's night: the window may hold other settled nights on DEV.
const mine = (r) => r.results.find((x) => x.contestId === F.contest.id);

test('the night settles as before', async () => {
  const r = await settleSixNight(F.contest, { now: after_(4) });
  assert.equal(r.settled, true, JSON.stringify(r));
  assert.equal(Number((await entry(F.u1)).score), 46);
  assert.equal(Number((await entry(F.u2)).score), 38);
  F.settledAt = (await night()).settled_at;
});

test('S3: an unchanged night - the re-check writes nothing (but re-pulls the box once a day)', async () => {
  const pulls = [];
  const syncBox = async (id) => { pulls.push(id); };
  const r = await regradeRecentSix({ now: after_(30), syncBox, maxBoxNights: 99 });
  const me = mine(r);
  assert.ok(me, 'the night is in the 7-day window');
  assert.equal(me.regraded, 0);
  assert.equal(me.perfect, false);
  assert.deepEqual(pulls.filter((id) => id === F.m1 || id === F.m2), [F.m1], 'the final game only - not the void one');
  const n = await night();
  assert.equal(n.meta.box_recheck_at, after_(30).toISOString());
  assert.equal(n.meta.regraded_at, undefined);
  // within 24h of that re-pull, no second one
  const again = [];
  await regradeRecentSix({ now: after_(40), syncBox: async (id) => { again.push(id); }, maxBoxNights: 99 });
  assert.ok(!again.includes(F.m1));
});

test('S3: a corrected box re-grades scores, ranks and the perfect six; settled_at kept, regraded_at recorded', async () => {
  // the scorer moves 20 points from t1 to t3 overnight
  await sql`UPDATE nba_player_game_stats SET pts = 10 WHERE match_id = ${F.m1} AND bdl_player_id = 't1'`;
  await sql`UPDATE nba_player_game_stats SET pts = 38 WHERE match_id = ${F.m1} AND bdl_player_id = 't3'`;
  const before = await night();
  const r = await regradeRecentSix({ now: after_(50) });
  const me = mine(r);
  assert.equal(me.regraded, 2, 'both cards: one score moved, and so did both ranks');
  assert.equal(me.perfect, true);
  const e1 = await entry(F.u1); const e2 = await entry(F.u2);
  assert.equal(Number(e1.score), 26);
  assert.equal(Number(e2.score), 58);
  assert.equal(e2.meta.six.rank, 1);
  assert.equal(e1.meta.six.rank, 2);
  assert.equal(e1.meta.six.regraded_at, after_(50).toISOString());
  const n = await night();
  assert.equal(new Date(n.settled_at).toISOString(), new Date(F.settledAt).toISOString(), 'settled_at is kept');
  assert.equal(n.meta.regraded_at, after_(50).toISOString());
  assert.equal(n.meta.box_recheck_at, before.meta.box_recheck_at, 'the other meta key survives the merge');
  // the night's total is the same 110 (20 points moved between two of its six) - its players' lines are not
  assert.notDeepEqual(n.perfect.players.map((p) => [p.playerId, p.points]), before.perfect.players.map((p) => [p.playerId, p.points]));
  assert.equal(n.perfect.players.find((p) => p.playerId === 't3').points, 38);
  // IDEMPOTENT: the same rows again change nothing
  const r2 = await regradeRecentSix({ now: after_(51) });
  assert.equal(mine(r2).regraded, 0);
  assert.equal(mine(r2).perfect, false);
  assert.equal((await night()).meta.regraded_at, after_(50).toISOString(), 'not re-stamped');
});

test('S3: past 7 days after the tip the night is left alone', async () => {
  await sql`UPDATE nba_player_game_stats SET pts = 0 WHERE match_id = ${F.m1} AND bdl_player_id = 't3'`;
  const r = await regradeRecentSix({ now: after_(7 * 24 + 1) });
  assert.equal(mine(r), undefined);
  assert.equal(Number((await entry(F.u2)).score), 58);
});
