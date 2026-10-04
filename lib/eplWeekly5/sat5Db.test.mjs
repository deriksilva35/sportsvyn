// EPL Weekly 5, ruling sat-5, against DEV:
//   E1  nextRound(): a postponed fixture does not pin its round; re-dated weeks
//       later it is a straggler, 'moved' on its old board, and CARRIED by the
//       gameweek it is now played in;
//   E2  a double gameweek through the real doors - the save door's lock at the
//       first fixture, the pool, the view, the grade and the perfect five.
// Sentinel rows only - season 2083, slugs and emails carrying "test" - made in
// before() and removed in after(), which asserts its own teardown.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { sql } = await import('../db.js');
const { ensureGameweek, gameweek, nextRound } = await import('./create.js');
const { saveEpl5Pick, epl5View } = await import('./entry.js');
const { settleGameweek } = await import('./settle.js');
const { standings } = await import('./board.js');
const { GAME_KEY } = await import('./rules.js');

const SEASON = 2083;
const TAG = `test-e5s5-${process.pid}`;
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
    { slug: `${TAG}-aaa`, name: 'Test Athletic', abbr: 'TXA' },
    { slug: `${TAG}-bbb`, name: 'Test Bridge', abbr: 'TXB' },
    { slug: `${TAG}-ccc`, name: 'Test Castle', abbr: 'TXC' },
    { slug: `${TAG}-ddd`, name: 'Test Dale', abbr: 'TXD' },
  ])}::jsonb) AS x(slug text, name text, abbr text)
    RETURNING id, abbreviation`;
  F.team = Object.fromEntries(teams.map((t) => [t.abbreviation, t.id]));
  const { TXA, TXB, TXC, TXD } = F.team;
  // ROUND 1: TXA plays TWICE (m1 at +48h, m3 at +96h) - a double gameweek.
  //          m4 TXB-TXD is POSTPONED.
  // ROUND 2: m5 at +400h, m6 at +480h.
  const ms = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, week)
    SELECT ${epl.id}, x.slug, x.h, x.a, x.ko::timestamptz, x.status, ${SEASON}, x.week
      FROM jsonb_to_recordset(${JSON.stringify([
    { slug: `${TAG}-m1`, h: TXA, a: TXB, ko: at(48).toISOString(), status: 'scheduled', week: 1 },
    { slug: `${TAG}-m2`, h: TXC, a: TXD, ko: at(72).toISOString(), status: 'scheduled', week: 1 },
    { slug: `${TAG}-m3`, h: TXC, a: TXA, ko: at(96).toISOString(), status: 'scheduled', week: 1 },
    { slug: `${TAG}-m4`, h: TXB, a: TXD, ko: at(60).toISOString(), status: 'postponed', week: 1 },
    { slug: `${TAG}-m5`, h: TXA, a: TXD, ko: at(400).toISOString(), status: 'scheduled', week: 2 },
    { slug: `${TAG}-m6`, h: TXB, a: TXC, ko: at(480).toISOString(), status: 'scheduled', week: 2 },
  ])}::jsonb) AS x(slug text, h int, a int, ko text, status text, week int)
    RETURNING id, slug`;
  F.m = Object.fromEntries(ms.map((m) => [m.slug.slice(TAG.length + 1), m.id]));
  const ps = await sql`
    INSERT INTO players (slug, full_name, position, current_team_id)
    SELECT x.slug, x.name, x.pos, x.team
      FROM jsonb_to_recordset(${JSON.stringify([
    { slug: `${TAG}-a-fwd`, name: 'A. Double', pos: 'ATT', team: TXA },
    { slug: `${TAG}-b-def`, name: 'B. Single', pos: 'DEF', team: TXB },
    { slug: `${TAG}-b-mid`, name: 'B. Other', pos: 'MID', team: TXB },
    { slug: `${TAG}-c-mid`, name: 'C. Twice', pos: 'MID', team: TXC },
    { slug: `${TAG}-d-gk`, name: 'D. Keeper', pos: 'GK', team: TXD },
  ])}::jsonb) AS x(slug text, name text, pos text, team int)
    RETURNING id, slug`;
  F.p = Object.fromEntries(ps.map((p) => [p.slug.slice(TAG.length + 1), p.id]));
  const [u] = await sql`INSERT INTO users (name, email) VALUES ('E5 Sat5', ${`${TAG}-1@example.test`}) RETURNING id`;
  F.u = u.id;
});

after(async () => {
  await sql`DELETE FROM contests WHERE game_type = ${GAME_KEY} AND season_year = ${SEASON}`;
  await sql`DELETE FROM player_match_stats WHERE match_id = ANY(${Object.values(F.m ?? {})})`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM players WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM teams WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${TAG}-%`}`;
  const [left] = await sql`
    SELECT (SELECT count(*) FROM matches WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM players WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM teams WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM users WHERE email LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM contests WHERE game_type = ${GAME_KEY} AND season_year = ${SEASON})::int AS n`;
  assert.equal(left.n, 0, 'teardown left nothing');
});

test('E1: round 1 is next while it has a fixture to play', async () => {
  assert.deepEqual(await nextRound({ season: SEASON }), { season: SEASON, week: 1 });
  F.gw1 = (await ensureGameweek({ season: SEASON, week: 1, now: at(0) })).id;
  const c = await gameweek(SEASON, 1);
  assert.equal(c.board.length, 4, 'the postponed fixture is on the board (off), the double club twice');
});

test('E2: the pool lists the double-gameweek player once, both fixtures, and the slot locks at the FIRST', async () => {
  const c = await gameweek(SEASON, 1);
  const v = await epl5View(F.u, c, { now: at(1) });
  const a = v.pool.find((p) => p.playerId === String(F.p['a-fwd']));
  assert.ok(a.double);
  assert.deepEqual(a.matchIds, [F.m.m1, F.m.m3]);
  assert.equal(a.opp, 'vs TXB, @ TXC');
  assert.equal(v.pool.filter((p) => p.playerId === String(F.p['a-fwd'])).length, 1);
  // the save door: open before m1, refused after m1 although m3 is still ahead
  assert.equal((await saveEpl5Pick(F.u, F.gw1, 'fwd', F.p['a-fwd'], { now: at(50) })).reason, 'game_started');
  assert.ok((await saveEpl5Pick(F.u, F.gw1, 'fwd', F.p['a-fwd'], { now: at(1) })).ok);
  assert.ok((await saveEpl5Pick(F.u, F.gw1, 'mid', F.p['c-mid'], { now: at(1) })).ok);
  // TXB's only fixture with a known date is m1 (m4 is postponed): pickable, locks at m1
  assert.ok((await saveEpl5Pick(F.u, F.gw1, 'flex1', F.p['b-def'], { now: at(1) })).ok);
  // TXD's fixtures: m2 (+72h) and m4 (postponed): locks at m2
  assert.ok((await saveEpl5Pick(F.u, F.gw1, 'defgk', F.p['d-gk'], { now: at(1) })).ok);
  const live = await epl5View(F.u, await gameweek(SEASON, 1), { now: at(50), withPool: false });
  const fwd = live.slots.find((s) => s.slot === 'fwd');
  assert.equal(fwd.pip, 'locked');
  assert.equal(fwd.fixtures.length, 2, 'the double-gameweek row shows both fixtures');
  assert.deepEqual(fwd.fixtures.map((f) => f.opp), ['vs TXB', '@ TXC']);
  assert.equal(live.slots.find((s) => s.slot === 'defgk').pip, 'picked', 'TXD locks at m2, not yet');
  assert.ok(live.board.every((g) => 'home' in g && 'away' in g), 'the client gets the club ids pickFixtures reads');
});

test('E1: the postponed fixture does not pin round 1 - round 2 opens once the rest is played', async () => {
  await sql`UPDATE matches SET status = 'final', home_score = 1, away_score = 0 WHERE id = ANY(${[F.m.m1, F.m.m2, F.m.m3]})`;
  assert.deepEqual(await nextRound({ season: SEASON }), { season: SEASON, week: 2 });
  // RE-DATED to +450h (scheduled again, still round 1): a straggler - round 2 stays next
  await sql`UPDATE matches SET status = 'scheduled', kickoff_at = ${at(450).toISOString()} WHERE id = ${F.m.m4}`;
  assert.deepEqual(await nextRound({ season: SEASON }), { season: SEASON, week: 2 });
  // round 2 opens and CARRIES it (its window is +400h..+480h)
  const r = await ensureGameweek({ season: SEASON, week: 2, now: at(150) });
  assert.ok(r.created);
  const gw2 = await gameweek(SEASON, 2);
  assert.deepEqual(gw2.board.map((g) => g.match_id), [F.m.m5, F.m.m4, F.m.m6], 'in kickoff order');
  assert.deepEqual(gw2.meta.carried, [{ match_id: F.m.m4, from_week: 1 }]);
  // TXD and TXB now play twice in gameweek 2
  const v2 = await epl5View(null, gw2, { now: at(151) });
  assert.ok(v2.pool.find((p) => p.playerId === String(F.p['d-gk'])).double);
  // on round 1's board it is 'moved': off, never holds the settle
  const v1 = await epl5View(F.u, await gameweek(SEASON, 1), { now: at(151), withPool: false });
  assert.equal(v1.board.find((g) => g.match_id === F.m.m4).status, 'moved');
});

test('E2: the grade sums both fixtures; the perfect five too; the moved fixture scores nothing in round 1', async () => {
  const stat = (pid, mid, team, o) => ({ player_id: pid, match_id: mid, team_id: team, started: true, minutes_played: 90, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, saves: 0, conceded_on_pitch: 1, ...o });
  const rows = [
    stat(F.p['a-fwd'], F.m.m1, F.team.TXA, { goals: 1 }),               // 2 + 4 = 6
    stat(F.p['a-fwd'], F.m.m3, F.team.TXA, { goals: 1, assists: 1 }),   // 2 + 4 + 3 = 9   -> 15
    stat(F.p['c-mid'], F.m.m2, F.team.TXC, { assists: 1 }),             // 2 + 3 = 5
    stat(F.p['c-mid'], F.m.m3, F.team.TXC, {}),                         // 2               -> 7
    stat(F.p['b-def'], F.m.m1, F.team.TXB, { yellow_cards: 2, red_cards: 1 }), // 2 - 3 = -1 (second yellow)
    stat(F.p['d-gk'], F.m.m2, F.team.TXD, { saves: 3 }),                // 2 + 1 = 3
    stat(F.p['b-mid'], F.m.m1, F.team.TXB, {}),                         // 2
    // the MOVED fixture's line, played later: never round 1's
    stat(F.p['d-gk'], F.m.m4, F.team.TXD, { saves: 9, conceded_on_pitch: 0 }),
  ];
  await sql`
    INSERT INTO player_match_stats (player_id, match_id, team_id, started, minutes_played, goals, assists,
                                    yellow_cards, red_cards, saves, conceded_on_pitch)
    SELECT x.player_id, x.match_id, x.team_id, x.started, x.minutes_played, x.goals, x.assists,
           x.yellow_cards, x.red_cards, x.saves, x.conceded_on_pitch
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(player_id int, match_id int, team_id int, started bool,
           minutes_played int, goals int, assists int, yellow_cards int, red_cards int, saves int, conceded_on_pitch int)`;
  await sql`UPDATE matches SET metadata = jsonb_set(CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END,
                                                    '{epl_stats}', '{"resyncAt":"2083-01-01T00:00:00Z"}'::jsonb, true)
             WHERE id = ANY(${[F.m.m1, F.m.m2, F.m.m3]})`;
  const done = await settleGameweek(await gameweek(SEASON, 1), { now: at(200) });
  assert.equal(done.settled, true, 'the moved fixture does not hold the settle');
  const [e] = await sql`SELECT score, meta FROM contest_entries WHERE contest_id = ${F.gw1} AND user_id = ${F.u}`;
  assert.deepEqual(e.meta.epl5.slots, { fwd: 15, mid: 7, flex1: -1, defgk: 3 });
  assert.equal(Number(e.score), 24);
  const c = await gameweek(SEASON, 1);
  assert.equal(c.perfect.players.find((p) => p.playerId === String(F.p['a-fwd'])).points, 15);
  assert.equal(c.perfect.players.find((p) => p.playerId === String(F.p['d-gk'])).points, 3, 'not the moved fixture\'s 9 saves');
  assert.equal(c.perfect.score, 15 + 7 + 3 + 2 - 1);
  assert.equal((await standings(c))[0].total, 24);
});
