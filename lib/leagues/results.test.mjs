// lib/leagues/results.test.mjs - the league table on DEV, end to end: a
// Pick'em + Daily bundle, rank points, scored from each game's own tables.
//
// Fixture (all torn down and asserted gone in after()): SENTINEL users
// (@example.invalid, "test" in the address), one league "Test results ...",
// three contests in season 1999 (weeks 98/99 - no real schedule has them, so a
// parallel fixture can never find them) and one Daily board dated 1999-03-03
// (edition_date is UNIQUE; the real Daily began in 2026).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const core = await import('./core.js');
const { leagueTable } = await import('./table.js');
const { sql } = await import('../db.js');

const NS = `lgresults-test-${process.pid}-${Date.now()}`;
const U = {};
let league; const contestIds = []; let boardId = null;

const ANCHORS = { nfl: { season: 1999, week: 98, at: '1999-01-01T00:00:00Z' }, day: { date: '1999-01-01', at: '1999-01-01T05:00:00Z' } };

before(async () => {
  for (const k of ['a', 'b', 'c', 'outsider']) {
    const [u] = await sql`INSERT INTO users (email, handle) VALUES (${`${NS}-${k}@example.invalid`}, ${`t${k}${process.pid}`.slice(0, 20)}) RETURNING id`;
    U[k] = u.id;
  }
  league = await core.createLeague(U.a, 'Test results bundle', {
    games: ['pickem', 'daily'], span: 'season', scoring: 'rank', format: 'table', maxMembers: 12, lateJoins: true,
  }, { anchors: ANCHORS, survivor: false });
  assert.equal(league.ok, true, league.reason);
  for (const k of ['b', 'c']) assert.equal((await core.joinLeague(U[k], league.joinCode)).ok, true);

  const mk = async (sport, week, settled, locks) => {
    const [c] = await sql`
      INSERT INTO contests (game_type, sport, season_year, week, opens_at, locks_at, settled)
      VALUES ('pickem', ${sport}, 1999, ${week}, ${locks}, ${locks}, ${settled}) RETURNING id`;
    contestIds.push(c.id);
    return c.id;
  };
  const w98 = await mk('nfl', 98, true, '1999-03-05T01:00:00Z');       // Thu night ET, week of Tue 1999-03-02
  const w99 = await mk('nfl', 99, false, '1999-03-12T01:00:00Z');      // next week, not settled
  const mlb = await mk('mlb', 98, true, '1999-03-05T01:00:00Z');       // a sport this league does not play
  const entry = (cid, uid, score) => sql`INSERT INTO contest_entries (contest_id, user_id, score) VALUES (${cid}, ${uid}, ${score})`;
  await entry(w98, U.a, 10); await entry(w98, U.b, 8); await entry(w98, U.outsider, 12);
  await entry(w99, U.b, 9);
  await entry(mlb, U.c, 99);

  const [b] = await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, slots, opens_at, closes_at)
    VALUES ('1999-03-03', 1999, ${NS}, '[]'::jsonb, 100, '[]'::jsonb, '[]'::jsonb, '1999-03-03T05:00:00Z', '1999-03-04T05:00:00Z')
    RETURNING id`;
  boardId = b.id;
  await sql`INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s, completed_at)
            VALUES (${boardId}, ${U.a}, '[]'::jsonb, 50, 50, 1, 60, '1999-03-03T12:00:00Z'),
                   (${boardId}, ${U.c}, '[]'::jsonb, 70, 70, 1, 60, '1999-03-03T12:00:00Z')`;
});

after(async () => {
  if (contestIds.length) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${contestIds})`;
    await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
  }
  if (boardId) await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
  if (league?.leagueId) await sql`DELETE FROM player_leagues WHERE id = ${league.leagueId}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM contests WHERE id = ANY(${contestIds}))
         + (SELECT count(*) FROM daily_boards WHERE id = ${boardId ?? -1})
         + (SELECT count(*) FROM player_leagues WHERE id = ${league?.leagueId ?? -1}) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('a Pick\'em + Daily bundle: rank points per game, no entry = 0, outsiders and other sports never count', async () => {
  const detail = await core.leagueDetail(league.leagueId, U.a);
  const t = await leagueTable(detail, { now: new Date('1999-03-20T12:00:00Z') });
  assert.equal(t.unit, 'week');
  const by = Object.fromEntries(t.standings.rows.map((r) => [r.userId, r]));
  // Pick'em w98 among 3 members: a 1st (3), b 2nd (2), c none (0) - the outsider's 12 is not on it.
  // Daily 1999-03-03: c 1st (3), a 2nd (2), b none (0). Pick'em MLB (c's 99) is not a game this league plays.
  assert.deepEqual([by[U.a].total, by[U.c].total, by[U.b].total], [5, 3, 2]);
  assert.deepEqual(t.standings.rows.map((r) => r.place), [1, 2, 3]);
  assert.equal(by[U.outsider], undefined);
  assert.deepEqual(t.standings.buckets, ['1999-03-02'], 'Thursday night and Wednesday\'s Daily share the Tuesday week');
  // the unsettled week 99 is not in the table, but it is this week so far
  assert.equal(t.live, '1999-03-09');
  assert.equal(t.liveFinal, false);
  assert.equal(t.thisBucket.rows.find((r) => r.userId === U.b).current, 3, 'b alone so far: 1st of 3');
  assert.equal(t.liveLabel, 'Week 99', 'an NFL week in the bucket names it');
});

test('before the start nothing counts: a league anchored after these results has an empty table', async () => {
  const detail = await core.leagueDetail(league.leagueId, U.a);
  const later = { ...detail, starts_at: '1999-03-10T00:00:00Z' };
  const t = await leagueTable(later, { now: new Date('1999-03-20T12:00:00Z') });
  assert.deepEqual(t.standings.buckets, []);
  assert.equal(t.live, '1999-03-09', 'only the week-99 contest locks after the start');
});
