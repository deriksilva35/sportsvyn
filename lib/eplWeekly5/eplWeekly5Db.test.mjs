// EPL Weekly 5 against DEV: the gameweek create, the save door (every rule the
// card states, enforced by the SERVER), the live-kickoff lock in both
// directions, the settle gate, the grade, the perfect five and the re-grade
// hook. Sentinel fixtures only - season 2098, slugs and emails carrying
// "test" - created in before() and removed in after(), which asserts its own
// teardown.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { sql } = await import('../db.js');
const { ensureGameweek, gameweek } = await import('./create.js');
const { saveEpl5Pick, clearEpl5Pick, epl5View } = await import('./entry.js');
const { settleGameweek, resettleForMatch, registerResettle } = await import('./settle.js');
const { standings } = await import('./board.js');
const { GAME_KEY } = await import('./rules.js');

const SEASON = 2098;
const TAG = `test-e5-${process.pid}`;
const H = 3600e3;
const T0 = Date.now();
const at = (h) => new Date(T0 + h * H);
const F = {};

before(async () => {
  const [epl] = await sql`SELECT id FROM leagues WHERE slug = 'epl'`;
  F.league = epl.id;
  const teams = await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation)
    SELECT ${epl.id}, x.slug, x.name, x.name, x.abbr
      FROM jsonb_to_recordset(${JSON.stringify([
    { slug: `${TAG}-aaa`, name: 'Test Albion', abbr: 'TAA' },
    { slug: `${TAG}-bbb`, name: 'Test Borough', abbr: 'TBB' },
    { slug: `${TAG}-ccc`, name: 'Test City', abbr: 'TCC' },
    { slug: `${TAG}-ddd`, name: 'Test Dynamo', abbr: 'TDD' },
  ])}::jsonb) AS x(slug text, name text, abbr text)
    RETURNING id, abbreviation`;
  F.team = Object.fromEntries(teams.map((t) => [t.abbreviation, t.id]));
  const ms = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, week)
    VALUES (${epl.id}, ${`${TAG}-m1`}, ${F.team.TAA}, ${F.team.TBB}, ${at(48).toISOString()}, 'scheduled', ${SEASON}, 1),
           (${epl.id}, ${`${TAG}-m2`}, ${F.team.TCC}, ${F.team.TDD}, ${at(72).toISOString()}, 'scheduled', ${SEASON}, 1)
    RETURNING id, slug`;
  F.m1 = ms.find((m) => m.slug.endsWith('m1')).id;
  F.m2 = ms.find((m) => m.slug.endsWith('m2')).id;
  const ps = await sql`
    INSERT INTO players (slug, full_name, position, current_team_id)
    SELECT x.slug, x.name, x.pos, x.team
      FROM jsonb_to_recordset(${JSON.stringify([
    { slug: `${TAG}-a-gk`, name: 'A. Keeper', pos: 'GK', team: F.team.TAA },
    { slug: `${TAG}-a-mid`, name: 'A. Mid', pos: 'MID', team: F.team.TAA },
    { slug: `${TAG}-a-fwd`, name: 'A. Striker', pos: 'ATT', team: F.team.TAA },
    { slug: `${TAG}-b-def`, name: 'B. Back', pos: 'DEF', team: F.team.TBB },
    { slug: `${TAG}-c-mid`, name: 'C. Mid', pos: 'MID', team: F.team.TCC },
    { slug: `${TAG}-d-fwd`, name: 'D. Striker', pos: 'ATT', team: F.team.TDD },
  ])}::jsonb) AS x(slug text, name text, pos text, team int)
    RETURNING id, slug`;
  F.p = Object.fromEntries(ps.map((p) => [p.slug.slice(TAG.length + 1), p.id]));
  const us = await sql`
    INSERT INTO users (name, email)
    VALUES ('E5 One', ${`${TAG}-1@example.test`}),
           ('E5 Two', ${`${TAG}-2@example.test`})
    RETURNING id`;
  [F.u1, F.u2] = us.map((u) => u.id);
  const r = await ensureGameweek({ season: SEASON, week: 1, now: at(0) });
  F.contest = r.id;
});

after(async () => {
  await sql`DELETE FROM contests WHERE game_type = ${GAME_KEY} AND season_year = ${SEASON}`;
  await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${[F.m1, F.m2]})`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM players WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM teams WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${TAG}-%`}`;
  const left = await sql`
    SELECT (SELECT count(*) FROM matches WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM players WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM teams WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM users WHERE email LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM contests WHERE game_type = ${GAME_KEY} AND season_year = ${SEASON})::int AS n`;
  assert.equal(left[0].n, 0, 'teardown left nothing');
});

test('one contest per gameweek, idempotent, its board the round\'s fixtures', async () => {
  const again = await ensureGameweek({ season: SEASON, week: 1, now: at(0) });
  assert.equal(again.created, false);
  assert.equal(again.id, F.contest);
  const c = await gameweek(SEASON, 1);
  assert.deepEqual(c.board.map((g) => g.match_id).sort(), [F.m1, F.m2].sort());
});

test('the server enforces position, two-per-club and one-player-once', async () => {
  const now = at(1);
  assert.equal((await saveEpl5Pick(F.u1, F.contest, 'mid', F.p['a-gk'], { now })).reason, 'wrong_position');
  assert.ok((await saveEpl5Pick(F.u1, F.contest, 'defgk', F.p['a-gk'], { now })).ok);
  assert.ok((await saveEpl5Pick(F.u1, F.contest, 'mid', F.p['a-mid'], { now })).ok);
  assert.equal((await saveEpl5Pick(F.u1, F.contest, 'fwd', F.p['a-fwd'], { now })).reason, 'max_from_club', 'a third TAA');
  assert.equal((await saveEpl5Pick(F.u1, F.contest, 'flex1', F.p['a-mid'], { now })).reason, 'already_on_card');
  // swapping an TAA slot for another TAA player is not a third
  assert.ok((await saveEpl5Pick(F.u1, F.contest, 'mid', F.p['c-mid'], { now })).ok);
  assert.ok((await saveEpl5Pick(F.u1, F.contest, 'fwd', F.p['a-fwd'], { now })).ok);
  assert.ok((await saveEpl5Pick(F.u1, F.contest, 'flex1', F.p['b-def'], { now })).ok);
  assert.ok((await saveEpl5Pick(F.u1, F.contest, 'flex2', F.p['d-fwd'], { now })).ok);
  const [e] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${F.contest} AND user_id = ${F.u1}`;
  assert.equal(e.lineup.fwd.clubId, F.team.TAA, 'the club is the database\'s, not the client\'s');
});

test('each slot locks at the CURRENT kickoff: moved earlier locks earlier, moved later stays open', async () => {
  // m1 brought forward to T0+2h: at T0+3h its slots are sealed
  await sql`UPDATE matches SET kickoff_at = ${at(2).toISOString()} WHERE id = ${F.m1}`;
  assert.equal((await clearEpl5Pick(F.u1, F.contest, 'defgk', { now: at(3) })).reason, 'slot_locked');
  assert.equal((await saveEpl5Pick(F.u2, F.contest, 'defgk', F.p['a-gk'], { now: at(3) })).reason, 'game_started');
  // pushed back to T0+48h: open again at T0+3h
  await sql`UPDATE matches SET kickoff_at = ${at(48).toISOString()} WHERE id = ${F.m1}`;
  assert.ok((await saveEpl5Pick(F.u2, F.contest, 'defgk', F.p['a-gk'], { now: at(3) })).ok);
  assert.ok((await clearEpl5Pick(F.u2, F.contest, 'defgk', { now: at(3) })).ok);
  assert.ok((await saveEpl5Pick(F.u2, F.contest, 'fwd', F.p['d-fwd'], { now: at(3) })).ok);
});

test('the view: pick before the first kickoff, live after it', async () => {
  const c = await gameweek(SEASON, 1);
  const pick = await epl5View(F.u1, c, { now: at(10), withPool: true });
  assert.equal(pick.phase, 'pick');
  assert.equal(pick.contest.label, 'Gameweek 1');
  assert.ok(pick.pool.some((p) => p.playerId === String(F.p['a-mid'])));
  assert.equal(pick.slots.filter((s) => s.playerId).length, 5);
  const live = await epl5View(F.u1, c, { now: at(50), withPool: false });
  assert.equal(live.phase, 'live');
  assert.deepEqual(live.slots.map((s) => s.pip), ['locked', 'picked', 'locked', 'locked', 'picked'], 'the three on m1 sealed, the two on m2 not');
});

test('the gate waits for every final AND its re-check; the grade, the perfect five, the re-grade', async () => {
  const c0 = await gameweek(SEASON, 1);
  assert.equal((await settleGameweek(c0, { now: at(80) })).settled, false, 'nothing final yet');
  await sql`UPDATE matches SET status = 'final', home_score = 2, away_score = 0 WHERE id = ${F.m1}`;
  await sql`UPDATE matches SET status = 'final', home_score = 1, away_score = 1 WHERE id = ${F.m2}`;
  const stat = (pid, mid, team, o) => ({ player_id: pid, match_id: mid, team_id: team, started: true, minutes_played: 90, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, ...o });
  const rows = [
    stat(F.p['a-gk'], F.m1, F.team.TAA, { saves: 6, conceded_on_pitch: 0 }),       // 2 + CS 4 + 2 = 8
    stat(F.p['a-fwd'], F.m1, F.team.TAA, { goals: 2, conceded_on_pitch: 0 }),      // 2 + 8 = 10
    stat(F.p['a-mid'], F.m1, F.team.TAA, { assists: 1, conceded_on_pitch: 0 }),    // 2 + 3 + 1 = 6
    stat(F.p['b-def'], F.m1, F.team.TBB, { yellow_cards: 1, conceded_on_pitch: 2 }), // 2 - 1 = 1
    stat(F.p['c-mid'], F.m2, F.team.TCC, { goals: 1, conceded_on_pitch: 1 }),      // 2 + 5 = 7
    stat(F.p['d-fwd'], F.m2, F.team.TDD, { goals: 1, minutes_played: 30, conceded_on_pitch: 0 }), // 1 + 4 = 5
  ];
  await sql`
    INSERT INTO player_match_stats (player_id, match_id, team_id, started, minutes_played, goals, assists,
                                    yellow_cards, red_cards, saves, conceded_on_pitch)
    SELECT x.player_id, x.match_id, x.team_id, x.started, x.minutes_played, x.goals, x.assists,
           x.yellow_cards, x.red_cards, x.saves, x.conceded_on_pitch
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(player_id int, match_id int, team_id int, started bool,
           minutes_played int, goals int, assists int, yellow_cards int, red_cards int, saves int, conceded_on_pitch int)`;
  const waiting = await settleGameweek(await gameweek(SEASON, 1), { now: at(80) });
  assert.equal(waiting.settled, false);
  assert.ok(waiting.waitingOn.every((w) => w.why === 'recheck'), 'finals wait for their +24h re-check');
  await sql`UPDATE matches SET metadata = jsonb_set(CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END,
                                                    '{epl_stats}', '{"resyncAt":"2098-01-01T00:00:00Z"}'::jsonb, true)
             WHERE id = ANY(${[F.m1, F.m2]})`;
  const done = await settleGameweek(await gameweek(SEASON, 1), { now: at(100) });
  assert.equal(done.settled, true);
  // u1: GK 8 + MID(c) 7 + FWD(a) 10 + FLEX b-def 1 + FLEX d-fwd 5 = 31
  const [e1] = await sql`SELECT score FROM contest_entries WHERE contest_id = ${F.contest} AND user_id = ${F.u1}`;
  assert.equal(Number(e1.score), 31);
  const c = await gameweek(SEASON, 1);
  // THE PERFECT FIVE obeys the cap: a-gk 8 + a-fwd 10 + a-mid 6 would be three
  // from TAA, so it is GK 8, MID c 7, FWD a 10, FLEX d 5, FLEX b 1 = 31.
  assert.equal(c.perfect.score, 31);
  assert.equal(c.perfect.players.length, 5);
  const board = await standings(c);
  assert.equal(board[0].total, 31);
  // A CORRECTION RE-GRADES: d-fwd's goal is struck off at the +24h re-sync
  await sql`UPDATE player_match_stats SET goals = 0 WHERE match_id = ${F.m2} AND player_id = ${F.p['d-fwd']}`;
  const hooks = registerResettle([]);
  assert.equal(registerResettle(hooks).length, 1, 'registered once');
  await hooks[0]({ matchId: F.m2 });
  const [e1b] = await sql`SELECT score FROM contest_entries WHERE contest_id = ${F.contest} AND user_id = ${F.u1}`;
  assert.equal(Number(e1b.score), 27);
  assert.equal((await gameweek(SEASON, 1)).perfect.score, 27, 'the perfect five is re-graded too');
  assert.equal((await resettleForMatch({ matchId: -1 })).length, 0);
  const view = await epl5View(F.u1, await gameweek(SEASON, 1), { now: at(120) });
  assert.equal(view.phase, 'final');
  assert.equal(view.rank.rank, 1);
});
