// lib/leagues/pickFormatDb.test.mjs - league Pick'em formats on DEV, end to end
// (S2): created REGULAR and CONFIDENCE leagues, the table each scores from the
// same public entries, the lock, the one-time switch, and a pre-S2 league left
// exactly as it was.
//
// Fixture (all torn down and asserted gone in after()): SENTINEL users
// (@example.invalid), leagues named "Test pickfmt ...", and two Pick'em
// contests under a FIXTURE sport slug (pf<pid>, not a real league - the orphan
// sweep's convention) in season 1999 with locks either side of 20 Oct 2026, so
// no real board, lobby or parallel fixture can find them. Each league's
// player_league_games is pointed at the fixture sport.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const core = await import('./core.js');
const { leagueTable } = await import('./table.js');
const { sql } = await import('../db.js');
const { CONFIDENCE_START } = await import('../pickem/confidence.js');

const NS = `pickfmt-test-${process.pid}-${Date.now()}`;
const SPORT = `pf${process.pid}`;
const U = {};
const leagueIds = []; const contestIds = [];
const ANCHORS = { nfl: { season: 1999, week: 96, at: '2026-10-09T00:15:00Z' }, day: { date: '2026-10-09', at: '2026-10-09T04:00:00Z' } };
const BEFORE_LOCK = new Date('2026-10-08T12:00:00Z');
const AFTER_ALL = new Date('2026-11-20T12:00:00Z');

// One week before 20 Oct (a REGULAR board) and one after (a CONFIDENCE board),
// same three games and results: home, away, away.
const RESULTS = { 1: 'home', 2: 'away', 3: 'away' };
const ENTRIES = {
  // a: 2 right (games 1 and 2) - on the confidence board ranked 3 and 2 = 5 of 6
  a: { lineup: { 1: 'home', 2: 'away', 3: 'home' }, ranks: { 1: 3, 2: 2, 3: 1 } },
  // b: 2 right (games 2 and 3) - ranked 1 and 3 = 4 of 6
  b: { lineup: { 1: 'away', 2: 'away', 3: 'away' }, ranks: { 1: 2, 2: 1, 3: 3 } },
};
const confScore = (e) => Object.entries(e.lineup).reduce((s, [id, side]) => s + (RESULTS[id] === side ? e.ranks[id] : 0), 0);

async function mkLeague(owner, name, pickFormat) {
  const r = await core.createLeague(owner, name, {
    games: ['pickem'], span: 'season', scoring: 'total', format: 'table', maxMembers: 12, lateJoins: true,
    ...(pickFormat ? { pickFormat } : {}),
  }, { anchors: ANCHORS, survivor: false });
  assert.equal(r.ok, true, r.reason);
  leagueIds.push(r.leagueId);
  await sql`DELETE FROM player_league_games WHERE league_id = ${r.leagueId}`;
  await sql`INSERT INTO player_league_games (league_id, game_type, sport) VALUES (${r.leagueId}, 'pickem', ${SPORT})`;
  assert.equal((await core.joinLeague(U.b, r.joinCode)).ok, true);
  return r.leagueId;
}

before(async () => {
  for (const k of ['a', 'b']) {
    const [u] = await sql`INSERT INTO users (email, handle) VALUES (${`${NS}-${k}@example.invalid`}, ${`pf${k}${process.pid}`.slice(0, 20)}) RETURNING id`;
    U[k] = u.id;
  }
  const mk = async (week, locks, conf) => {
    const [c] = await sql`
      INSERT INTO contests (game_type, sport, season_year, week, opens_at, locks_at, settled, meta, perfect)
      VALUES ('pickem', ${SPORT}, 1999, ${week}, ${locks}, ${locks}, true,
              ${JSON.stringify(conf ? { scoring: 'confidence' } : {})}::jsonb,
              ${JSON.stringify({ results: RESULTS, max: 3 })}::jsonb)
      RETURNING id`;
    contestIds.push(c.id);
    for (const k of ['a', 'b']) {
      const e = ENTRIES[k];
      const score = conf ? confScore(e) : Object.entries(e.lineup).filter(([id, s]) => RESULTS[id] === s).length;
      await sql`INSERT INTO contest_entries (contest_id, user_id, score, lineup, ranks, max_score)
                VALUES (${c.id}, ${U[k]}, ${score}, ${JSON.stringify(e.lineup)}::jsonb,
                        ${conf ? JSON.stringify(e.ranks) : null}::jsonb, ${conf ? 6 : null})`;
    }
  };
  await mk(96, '2026-10-16T00:15:00Z', false);   // the week of 13 Oct - a REGULAR board
  await mk(97, '2026-10-23T00:15:00Z', true);    // the week of 20 Oct - a CONFIDENCE board
});

after(async () => {
  if (contestIds.length) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${contestIds})`;
    await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
  }
  if (leagueIds.length) await sql`DELETE FROM player_leagues WHERE id = ANY(${leagueIds})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM contests WHERE id = ANY(${contestIds}) OR sport = ${SPORT})
         + (SELECT count(*) FROM player_leagues WHERE id = ANY(${leagueIds})) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

const tableOf = async (id, now = AFTER_ALL) => {
  const t = await leagueTable(await core.leagueDetail(id, U.a), { now });
  return Object.fromEntries(t.standings.rows.map((r) => [r.userId, r]));
};

test('a league made with no format is REGULAR, and the switch is never offered to a league made after S2', async () => {
  const id = await mkLeague(U.a, 'Test pickfmt default', null);
  const [lg] = await sql`SELECT pick_format, pick_format_switch_open, pick_format_from FROM player_leagues WHERE id = ${id}`;
  assert.deepEqual(lg, { pick_format: 'regular', pick_format_switch_open: false, pick_format_from: null });
});

test('REGULAR league: every week scores wins, the confidence board\'s points re-counted; record second', async () => {
  const id = await mkLeague(U.a, 'Test pickfmt regular', 'regular');
  const by = await tableOf(id);
  assert.equal(by[U.a].total, 4, 'a: 2 wins + 2 wins');
  assert.equal(by[U.b].total, 4);
  assert.deepEqual(by[U.a].record, { w: 4, l: 2 });
});

test('CONFIDENCE league: the confidence week scores its rank points; the earlier unranked week its wins', async () => {
  const id = await mkLeague(U.a, 'Test pickfmt confidence', 'confidence');
  const [lg] = await sql`SELECT pick_format FROM player_leagues WHERE id = ${id}`;
  assert.equal(lg.pick_format, 'confidence');
  const by = await tableOf(id);
  assert.equal(by[U.a].total, 2 + 5, 'a: 2 wins, then 5 points - raw points, not a percent');
  assert.equal(by[U.b].total, 2 + 4);
  assert.deepEqual(by[U.b].record, { w: 4, l: 2 }, 'the record is the same picks either way');
  assert.equal(by[U.a].place, 1);
});

test('THE LOCK: a new league changes freely before its first week locks, and is refused after', async () => {
  const id = await mkLeague(U.a, 'Test pickfmt lock', 'regular');
  assert.equal((await core.setLeaguePickFormat(U.b, id, 'confidence', { now: BEFORE_LOCK })).code, 'not_owner');
  const set = await core.setLeaguePickFormat(U.a, id, 'confidence', { now: BEFORE_LOCK });
  assert.deepEqual(set, { ok: true, kind: 'set', from: null, pickFormat: 'confidence' });
  const after1 = await core.setLeaguePickFormat(U.a, id, 'regular', { now: new Date('2026-10-12T12:00:00Z') });
  assert.equal(after1.code, 'locked', 'starts_at (9 Oct) has passed');
  const [lg] = await sql`SELECT pick_format, pick_format_from FROM player_leagues WHERE id = ${id}`;
  assert.deepEqual(lg, { pick_format: 'confidence', pick_format_from: null });
});

test('THE ONE-TIME SWITCH on a pre-S2 league: from the 20 Oct week, earlier weeks as scored, once only', async () => {
  const id = await mkLeague(U.a, 'Test pickfmt switch', null);
  // what migration 133 does to every league that existed before it
  await sql`UPDATE player_leagues SET pick_format_switch_open = true, starts_at = '2026-09-11T00:15:00Z' WHERE id = ${id}`;
  const before1 = await tableOf(id);
  assert.equal(before1[U.a].total, 4, 'still REGULAR until the switch');

  const sw = await core.setLeaguePickFormat(U.a, id, 'confidence', { now: BEFORE_LOCK });
  assert.equal(sw.ok, true, sw.reason);
  assert.equal(sw.kind, 'switch');
  assert.equal(new Date(sw.from).toISOString(), CONFIDENCE_START);
  const [lg] = await sql`SELECT pick_format, pick_format_prev, pick_format_switch_open FROM player_leagues WHERE id = ${id}`;
  assert.deepEqual(lg, { pick_format: 'confidence', pick_format_prev: 'regular', pick_format_switch_open: false });

  const by = await tableOf(id);
  assert.equal(by[U.a].total, 2 + 5, 'the 13 Oct week stays 2 wins; the 20 Oct week is 5 points');
  assert.equal(by[U.b].total, 2 + 4);

  const again = await core.setLeaguePickFormat(U.a, id, 'regular', { now: BEFORE_LOCK });
  assert.equal(again.code, 'locked', 'the switch is spent');
});

test('A PRE-S2 LEAGUE THAT NEVER SWITCHES IS UNTOUCHED: a row written without the new columns scores as before', async () => {
  const [row] = await sql`
    INSERT INTO player_leagues (name, owner_id, join_code, span, scoring, format, starts_at)
    VALUES ('Test pickfmt legacy', ${U.a}, ${`PF${process.pid}`.slice(0, 6).padEnd(6, 'X')}, 'season', 'total', 'table', '2026-09-11T00:15:00Z')
    RETURNING id, pick_format, pick_format_switch_open`;
  leagueIds.push(row.id);
  assert.equal(row.pick_format, 'regular');
  await sql`INSERT INTO league_members (league_id, user_id) VALUES (${row.id}, ${U.a}), (${row.id}, ${U.b})`;
  await sql`INSERT INTO player_league_games (league_id, game_type, sport) VALUES (${row.id}, 'pickem', ${SPORT})`;
  const by = await tableOf(row.id);
  assert.equal(by[U.a].total, 4);
  assert.equal(by[U.b].total, 4);
});
