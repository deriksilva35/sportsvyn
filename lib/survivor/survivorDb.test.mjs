// lib/survivor/survivorDb.test.mjs - Survivor through the real writers and the
// real grader, on a synthetic sports league ('survtest', season 2097) that is
// created and torn down here. Nothing real is read or written: the pools, the
// teams, the games and the lines are this file's own, and after() asserts it
// left none of them behind.
//
// THE WEEK, as the fixture lays it out (2097, REG):
//   wk 4  AAA-BBB final                 (before the pool's start: never offered)
//   wk 5  AAA v BBB  Thu 00:15Z  AAA -7    -> final 24-17   (AAA wins)
//         CCC v DDD  Sun 17:00Z  CCC -3    -> final 20-20   (TIE = loss both ways)
//         EEE v FFF  Sun 20:25Z  FFF -2.5  -> final 10-27   (FFF wins)
//         GGG v HHH  Tue 00:15Z  no line   -> cancelled     (survive)
//         III, JJJ on bye
//   wk 6  III v JJJ, AAA v CCC

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { makePick } from './pick.js';
import { gradePool } from './grade.js';
import { weekBoard, poolWeek, entryWithPicks } from './read.js';

const LG = 'survtest'; const SEASON = 2097;
const EMAIL = (n) => `survivor-sentinel-${n}@sportsvyn.test`;
const T = {
  pre: new Date('2097-10-05T12:00:00Z'),        // the Monday before: everything open
  afterThu: new Date('2097-10-09T00:25:00Z'),   // ten minutes after the Thursday kickoff
  afterAll: new Date('2097-10-13T01:00:00Z'),   // every week-5 game has kicked
  tue: new Date('2097-10-14T12:00:00Z'),        // the Tuesday after
};
let leagueId; let playerLeagueId; let pool; let pool2;
const teams = {}; const m = {}; const u = {};

const mkTeam = async (abbr, name) => {
  teams[abbr] = (await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, metadata)
    VALUES (${leagueId}, ${`${LG}-${abbr.toLowerCase()}`}, ${name}, ${abbr}, ${abbr}, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
};
const mkGame = async (key, week, home, away, ko, status = 'scheduled') => {
  m[key] = (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id, season_year, season_phase, week, external_ids, metadata)
    VALUES (${leagueId}, ${`${LG}-${key}`}, ${ko}, ${status}, ${teams[home]}, ${teams[away]}, ${SEASON}, 'REG', ${week}, '{}'::jsonb, '{}'::jsonb)
    RETURNING id`)[0].id;
};
const mkSpread = async (key, label, value) => sql`
  INSERT INTO odds_markets (market_scope, market_type, match_id, selection_label, selection_value,
                            american_odds, implied_probability, is_current, fetcher_version)
  VALUES ('match', 'spread', ${m[key]}, ${label}, ${String(value)}, -110, 52.38, true, 'odds-api-v4')`;
const setFinal = (key, hs, as) => sql`UPDATE matches SET status = 'final', home_score = ${hs}, away_score = ${as} WHERE id = ${m[key]}`;

async function teardown() {
  const lg = await sql`SELECT id FROM leagues WHERE slug = ${LG}`;
  await sql`DELETE FROM survivor_pools WHERE sport = ${LG}`;            // cascades entries, picks
  for (const l of lg) {
    await sql`DELETE FROM matches WHERE league_id = ${l.id}`;           // cascades odds rows
    await sql`DELETE FROM teams WHERE league_id = ${l.id}`;
    await sql`DELETE FROM leagues WHERE id = ${l.id}`;
  }
  await sql`DELETE FROM player_leagues WHERE name = 'Survivor sentinel league'`;
  await sql`DELETE FROM users WHERE email LIKE 'survivor-sentinel-%@sportsvyn.test'`;
}

before(async () => {
  await teardown();
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport) VALUES (${LG}, 'Survivor Test', 'football') RETURNING id`)[0].id;
  for (const [abbr, name] of [['AAA', 'Alpha Survtest'], ['BBB', 'Bravo Survtest'], ['CCC', 'Charlie Survtest'],
    ['DDD', 'Delta Survtest'], ['EEE', 'Echo Survtest'], ['FFF', 'Foxtrot Survtest'], ['GGG', 'Golf Survtest'],
    ['HHH', 'Hotel Survtest'], ['III', 'India Survtest'], ['JJJ', 'Juliet Survtest']]) await mkTeam(abbr, name);
  await mkGame('w4', 4, 'AAA', 'BBB', '2097-10-02T00:15:00Z', 'final');
  await mkGame('ab', 5, 'AAA', 'BBB', '2097-10-09T00:15:00Z');
  await mkGame('cd', 5, 'CCC', 'DDD', '2097-10-11T17:00:00Z');
  await mkGame('ef', 5, 'EEE', 'FFF', '2097-10-11T20:25:00Z');
  await mkGame('gh', 5, 'GGG', 'HHH', '2097-10-13T00:15:00Z');
  await mkGame('ij', 6, 'III', 'JJJ', '2097-10-16T00:15:00Z');
  await mkGame('ac', 6, 'AAA', 'CCC', '2097-10-18T17:00:00Z');
  await mkSpread('ab', 'Alpha Survtest', -7);
  await mkSpread('cd', 'Charlie Survtest', -3);
  await mkSpread('ef', 'Echo Survtest', 2.5);     // the HOME team at +2.5: Foxtrot is the favorite
  pool = (await sql`
    INSERT INTO survivor_pools (league_id, sport, season_year, start_week, lives, missed, name)
    VALUES (NULL, ${LG}, ${SEASON}, 5, 1, 'auto', 'National test') RETURNING *`)[0];
  playerLeagueId = (await sql`
    INSERT INTO player_leagues (name, owner_id, join_code) VALUES ('Survivor sentinel league', NULL, ${`S${Date.now().toString(36).slice(-5).toUpperCase()}`})
    RETURNING id`)[0].id;
  pool2 = (await sql`
    INSERT INTO survivor_pools (league_id, sport, season_year, start_week, lives, missed, name)
    VALUES (${playerLeagueId}, ${LG}, ${SEASON}, 5, 2, 'out', 'League test') RETURNING *`)[0];
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    u[n] = (await sql`INSERT INTO users (email) VALUES (${EMAIL(n)}) RETURNING id`)[0].id;
  }
});

after(async () => {
  await teardown();
  // THE TEARDOWN IS ASSERTED, not assumed: nothing of this file's survives it.
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM survivor_pools WHERE sport = ${LG}) AS pools,
           (SELECT count(*)::int FROM leagues WHERE slug = ${LG}) AS leagues,
           (SELECT count(*)::int FROM users WHERE email LIKE 'survivor-sentinel-%@sportsvyn.test') AS users`;
  assert.deepEqual(left, { pools: 0, leagues: 0, users: 0 });
});

test('the board: favorites first by each team\'s own spread, unpriced last, byes absent', async () => {
  const { rows } = await weekBoard(pool, 5);
  assert.deepEqual(rows.map((r) => [r.abbr, r.spread]), [
    ['AAA', -7], ['CCC', -3], ['FFF', -2.5], ['EEE', 2.5], ['DDD', 3], ['BBB', 7], ['GGG', null], ['HHH', null],
  ]);
  assert.ok(!rows.some((r) => r.abbr === 'III' || r.abbr === 'JJJ'), 'a bye team is not offered');
});

test('the open week is the start week, not the earlier finished one', async () => {
  assert.equal((await poolWeek(pool, T.pre)).week, 5);
});

test('picking: join on the first pick, change freely before kickoff, a bye team refused', async () => {
  assert.deepEqual(await makePick(u[1], pool.id, teams.CCC, { now: T.pre }), { ok: true, week: 5, teamId: teams.CCC, matchId: m.cd });
  const { entry } = await entryWithPicks(pool.id, u[1]);
  assert.equal(entry.lives_left, 1, 'the entry carries the pool\'s lives');
  assert.equal((await makePick(u[1], pool.id, teams.EEE, { now: T.pre })).ok, true, 'changed');
  assert.equal((await makePick(u[1], pool.id, teams.III, { now: T.pre })).reason, 'not_this_week');
  for (const [n, t] of [[2, 'DDD'], [3, 'GGG'], [6, 'AAA']]) {
    assert.equal((await makePick(u[n], pool.id, teams[t], { now: T.pre })).ok, true, `u${n} ${t}`);
  }
});

test('locks: a kicked team cannot be picked, a kicked pick cannot be changed, entries close at the first kickoff', async () => {
  assert.equal((await makePick(u[2], pool.id, teams.AAA, { now: T.afterThu })).reason, 'team_locked');
  assert.equal((await makePick(u[6], pool.id, teams.CCC, { now: T.afterThu })).reason, 'pick_locked', 'AAA kicked: locked in');
  assert.equal((await makePick(u[1], pool.id, teams.EEE, { now: T.afterThu })).ok, true, 'a Sunday pick still moves');
  assert.equal((await makePick(u[4], pool.id, teams.CCC, { now: T.afterThu })).reason, 'entries_closed');
});

test('the auto-pick: at the first kickoff, the biggest unused favorite among games still to come', async () => {
  // u5 joined before the week (an entry with no pick); u7 is in the 'out' pool with no pick.
  await sql`INSERT INTO survivor_entries (pool_id, user_id, lives_left, joined_at) VALUES (${pool.id}, ${u[5]}, 1, '2097-10-05T00:00:00Z')`;
  await sql`INSERT INTO survivor_entries (pool_id, user_id, lives_left, joined_at) VALUES (${pool2.id}, ${u[7]}, 2, '2097-10-05T00:00:00Z')`;
  const before1 = await gradePool(pool, { now: new Date('2097-10-08T23:00:00Z') });
  assert.equal(before1.assigned, 0, 'nothing before the first kickoff');
  const r = await gradePool(pool, { now: T.afterThu });
  assert.equal(r.assigned, 1);
  const { picks } = await entryWithPicks(pool.id, u[5]);
  assert.deepEqual(picks.map((p) => [p.week, p.abbr, p.auto]), [[5, 'CCC', true]], 'AAA has kicked: CCC -3 is next');
  // The auto-pick is a pick like any other - changeable until ITS kickoff.
  assert.equal((await makePick(u[5], pool.id, teams.FFF, { now: T.afterThu })).ok, true);
  assert.equal((await makePick(u[5], pool.id, teams.CCC, { now: T.afterThu })).ok, true);
  // The 'out' pool assigns nothing, and misses nothing while a game is still open.
  const r2 = await gradePool(pool2, { now: T.afterThu });
  assert.deepEqual([r2.assigned, r2.missed], [0, 0]);
});

test('grading: a win, a loss, a TIE is a loss, a CANCELLED game survives; lives and eliminations follow', async () => {
  await setFinal('ab', 24, 17);
  await setFinal('cd', 20, 20);
  await setFinal('ef', 10, 27);
  await sql`UPDATE matches SET status = 'cancelled' WHERE id = ${m.gh}`;
  const r = await gradePool(pool, { now: T.tue });
  assert.deepEqual(r.byResult, { win: 1, loss: 3, survive: 1 });
  const res = async (n) => (await entryWithPicks(pool.id, u[n])).picks[0].result;
  assert.deepEqual([await res(1), await res(2), await res(3), await res(5), await res(6)],
    ['loss', 'loss', 'survive', 'loss', 'win']);
  const out = await sql`SELECT user_id, lives_left, eliminated_week FROM survivor_entries WHERE pool_id = ${pool.id} ORDER BY user_id`;
  const byU = Object.fromEntries(out.map((e) => [e.user_id, [e.lives_left, e.eliminated_week]]));
  assert.deepEqual(byU[u[1]], [0, 5]);
  assert.deepEqual(byU[u[2]], [0, 5], 'the tie');
  assert.deepEqual(byU[u[3]], [1, null], 'the cancelled game');
  assert.deepEqual(byU[u[6]], [1, null]);
  // IDEMPOTENT: a second firing changes nothing.
  const again = await gradePool(pool, { now: T.tue });
  assert.deepEqual([again.graded, again.assigned, again.missed, again.eliminated], [0, 0, 0, 0]);
});

test('the out pool: no pick once every game has kicked is a MISSED week - one of two lives', async () => {
  const r = await gradePool(pool2, { now: T.afterAll });
  assert.equal(r.missed, 1);
  const [e] = await sql`SELECT lives_left, eliminated_week FROM survivor_entries WHERE pool_id = ${pool2.id} AND user_id = ${u[7]}`;
  assert.deepEqual([e.lives_left, e.eliminated_week], [1, null], 'two lives: still in');
});

test('week 6 opens once week 5 is graded; no reuse; the eliminated cannot pick', async () => {
  assert.equal((await poolWeek(pool, T.tue)).week, 6);
  assert.equal((await makePick(u[6], pool.id, teams.AAA, { now: T.tue })).reason, 'used');
  assert.equal((await makePick(u[6], pool.id, teams.CCC, { now: T.tue })).ok, true);
  assert.equal((await makePick(u[1], pool.id, teams.III, { now: T.tue })).reason, 'eliminated');
  assert.equal((await makePick(u[3], pool.id, teams.GGG, { now: T.tue })).reason, 'not_this_week', 'GGG is not on the week-6 slate');
});
