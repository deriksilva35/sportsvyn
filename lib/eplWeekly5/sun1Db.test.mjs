// EPL Weekly 5, ruling sun-1, against DEV: "a fixture re-dated into a gameweek
// whose board is already open is appended to that board (double gameweek for
// its clubs) any time before that board settles." create.js appendCarried(),
// run by /api/cron/epl-weekly-5 after ensureNextGameweek.
// Sentinel rows only - season 2084 (sat5Db holds 2083; each file deletes its
// own season's contests), slugs and emails carrying "test" - made in before()
// and removed in after(), which asserts its own teardown. appendCarried is
// called with { season: SEASON } so it never touches another board on DEV.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { sql } = await import('../db.js');
const { ensureGameweek, gameweek, appendCarried } = await import('./create.js');
const { saveEpl5Pick, epl5View } = await import('./entry.js');
const { GAME_KEY } = await import('./rules.js');

const SEASON = 2084;
const TAG = `test-e5sun1-${process.pid}`;
const H = 3600e3;
const T0 = Date.now();
const at = (h) => new Date(T0 + h * H);
const F = {};

before(async () => {
  const [epl] = await sql`SELECT id FROM leagues WHERE slug = 'epl'`;
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
  // ROUND 1: m1 +48h, m2 +72h; m4 TXB-TXD POSTPONED (re-dated later, AFTER round 2 opens).
  // ROUND 2: m7 TXB-TXA +300h, m5 TXA-TXD +400h, m6 TXB-TXC +480h (window ends +480h).
  // m8 TXC-TXD: a second round-1 fixture, postponed, for the settled-board case.
  const ms = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, week)
    SELECT ${epl.id}, x.slug, x.h, x.a, x.ko::timestamptz, x.status, ${SEASON}, x.week
      FROM jsonb_to_recordset(${JSON.stringify([
    { slug: `${TAG}-m1`, h: TXA, a: TXB, ko: at(48).toISOString(), status: 'scheduled', week: 1 },
    { slug: `${TAG}-m2`, h: TXC, a: TXD, ko: at(72).toISOString(), status: 'scheduled', week: 1 },
    { slug: `${TAG}-m4`, h: TXB, a: TXD, ko: at(60).toISOString(), status: 'postponed', week: 1 },
    { slug: `${TAG}-m8`, h: TXC, a: TXD, ko: at(66).toISOString(), status: 'postponed', week: 1 },
    { slug: `${TAG}-m7`, h: TXB, a: TXA, ko: at(300).toISOString(), status: 'scheduled', week: 2 },
    { slug: `${TAG}-m5`, h: TXA, a: TXD, ko: at(400).toISOString(), status: 'scheduled', week: 2 },
    { slug: `${TAG}-m6`, h: TXB, a: TXC, ko: at(480).toISOString(), status: 'scheduled', week: 2 },
  ])}::jsonb) AS x(slug text, h int, a int, ko text, status text, week int)
    RETURNING id, slug`;
  F.m = Object.fromEntries(ms.map((m) => [m.slug.slice(TAG.length + 1), m.id]));
  const ps = await sql`
    INSERT INTO players (slug, full_name, position, current_team_id)
    SELECT x.slug, x.name, x.pos, x.team
      FROM jsonb_to_recordset(${JSON.stringify([
    { slug: `${TAG}-a-fwd`, name: 'A. Forward', pos: 'ATT', team: TXA },
    { slug: `${TAG}-b-def`, name: 'B. Back', pos: 'DEF', team: TXB },
    { slug: `${TAG}-d-gk`, name: 'D. Keeper', pos: 'GK', team: TXD },
  ])}::jsonb) AS x(slug text, name text, pos text, team int)
    RETURNING id, slug`;
  F.p = Object.fromEntries(ps.map((p) => [p.slug.slice(TAG.length + 1), p.id]));
  const [u] = await sql`INSERT INTO users (name, email) VALUES ('E5 Sun1', ${`${TAG}-1@example.test`}) RETURNING id`;
  F.u = u.id;
});

after(async () => {
  await sql`DELETE FROM contests WHERE game_type = ${GAME_KEY} AND season_year = ${SEASON}`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM players WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM teams WHERE slug LIKE ${`${TAG}-%`}`;
  await sql`DELETE FROM users WHERE email LIKE ${`${TAG}-%`}`;
  const [left] = await sql`
    SELECT (SELECT count(*) FROM matches WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM players WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM teams WHERE slug LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM users WHERE email LIKE ${`${TAG}-%`})::int
         + (SELECT count(*) FROM contest_entries WHERE contest_id = ANY(${[F.gw1, F.gw2].filter(Boolean)}))::int
         + (SELECT count(*) FROM contests WHERE game_type = ${GAME_KEY} AND season_year = ${SEASON})::int AS n`;
  assert.equal(left.n, 0, 'teardown left nothing');
});

const ids = (c) => c.board.map((g) => g.match_id);

test('sun-1: round 2 opens while m4 is still postponed - nothing carried, picks saved', async () => {
  F.gw1 = (await ensureGameweek({ season: SEASON, week: 1, now: at(0) })).id;
  const r = await ensureGameweek({ season: SEASON, week: 2, now: at(150) });
  assert.ok(r.created);
  F.gw2 = r.id;
  const gw2 = await gameweek(SEASON, 2);
  assert.deepEqual(ids(gw2), [F.m.m7, F.m.m5, F.m.m6]);
  assert.equal(gw2.meta.carried, undefined);
  assert.ok((await saveEpl5Pick(F.u, F.gw2, 'flex1', F.p['b-def'], { now: at(150) })).ok);
  assert.ok((await saveEpl5Pick(F.u, F.gw2, 'defgk', F.p['d-gk'], { now: at(150) })).ok);
  assert.ok((await saveEpl5Pick(F.u, F.gw2, 'fwd', F.p['a-fwd'], { now: at(150) })).ok);
  assert.deepEqual((await appendCarried({ now: at(310), season: SEASON })).appended, [], 'no re-date yet: nothing to append');
});

test('sun-1: a re-date announced AFTER round 2 opened is appended to its open board, in kickoff order', async () => {
  // re-dated to +350h: out of round 1 (its others end +72h, +72h moved threshold), inside round 2's window
  await sql`UPDATE matches SET status = 'scheduled', kickoff_at = ${at(350).toISOString()} WHERE id = ${F.m.m4}`;
  const { appended } = await appendCarried({ now: at(310), season: SEASON });
  assert.deepEqual(appended, [{ contestId: F.gw2, week: 2, match_id: F.m.m4, from_week: 1 }]);
  const gw2 = await gameweek(SEASON, 2);
  assert.ok(Array.isArray(gw2.board), 'board is still an ARRAY');
  assert.deepEqual(ids(gw2), [F.m.m7, F.m.m4, F.m.m5, F.m.m6], 'appended in kickoff order');
  assert.ok(gw2.board.every((g) => g.match_id != null && g.home?.id != null && g.away?.id != null), 'every element is a board game, no stray object');
  const m4 = gw2.board.find((g) => g.match_id === F.m.m4);
  assert.deepEqual([m4.home.id, m4.away.id, m4.kickoff_at], [F.team.TXB, F.team.TXD, at(350).toISOString()]);
  assert.deepEqual(gw2.meta.carried, [{ match_id: F.m.m4, from_week: 1, appended_at: at(310).toISOString() }]);
  assert.equal(gw2.meta.games, 4);
  // the window is unchanged: an appended fixture is never later than the round's last
  assert.equal(new Date(gw2.locks_at).toISOString(), at(480).toISOString());
  // round 1's board is untouched (one fixture, one gameweek)
  assert.deepEqual(ids(await gameweek(SEASON, 1)), [F.m.m1, F.m.m4, F.m.m8, F.m.m2]);
});

test('sun-1: idempotent - a second run appends nothing and the board does not grow', async () => {
  assert.deepEqual((await appendCarried({ now: at(311), season: SEASON })).appended, []);
  const gw2 = await gameweek(SEASON, 2);
  assert.equal(gw2.board.length, 4);
  assert.equal(gw2.board.filter((g) => g.match_id === F.m.m4).length, 1);
  assert.equal(gw2.meta.carried.length, 1);
});

test('sun-1: saved entries stay valid - a locked slot stays locked, an open one locks at the earliest current kickoff', async () => {
  const gw2 = await gameweek(SEASON, 2);
  const v = await epl5View(F.u, gw2, { now: at(320), withPool: false });
  const slot = (s) => v.slots.find((x) => x.slot === s);
  // TXB: m7 (+300, kicked off) and now m4 (+350): already locked, stays locked
  assert.equal(slot('flex1').pip, 'locked');
  assert.deepEqual(slot('flex1').fixtures.map((f) => f.matchId), [F.m.m7, F.m.m4, F.m.m6], 'TXB gains m4: three fixtures');
  // TXD: m5 (+400) and the appended m4 (+350): open, and its lock moved EARLIER to +350
  assert.equal(slot('defgk').pip, 'picked');
  assert.equal(slot('defgk').kickoffAt, at(350).toISOString());
  assert.deepEqual(slot('defgk').fixtures.map((f) => f.matchId), [F.m.m4, F.m.m5]);
  // TXA gained nothing: still m7 and m5
  assert.deepEqual(slot('fwd').fixtures.map((f) => f.matchId), [F.m.m7, F.m.m5]);
  // the save door agrees: the TXD slot can still be changed at +349h and not at +351h
  assert.ok((await saveEpl5Pick(F.u, F.gw2, 'defgk', F.p['d-gk'], { now: at(349) })).ok);
  assert.equal((await saveEpl5Pick(F.u, F.gw2, 'defgk', F.p['d-gk'], { now: at(351) })).reason, 'slot_locked');
  const later = await epl5View(F.u, gw2, { now: at(351), withPool: false });
  assert.equal(later.slots.find((x) => x.slot === 'defgk').pip, 'locked');
});

test('sun-1: never appended to a SETTLED board - and the settle flag is the only reason', async () => {
  await sql`UPDATE matches SET status = 'scheduled', kickoff_at = ${at(460).toISOString()} WHERE id = ${F.m.m8}`;
  await sql`UPDATE contests SET settled = true WHERE id = ${F.gw2}`;
  assert.deepEqual((await appendCarried({ now: at(320), season: SEASON })).appended, []);
  assert.equal((await gameweek(SEASON, 2)).board.length, 4, 'the settled board did not grow');
  await sql`UPDATE contests SET settled = false WHERE id = ${F.gw2}`;
  const { appended } = await appendCarried({ now: at(320), season: SEASON });
  assert.deepEqual(appended.map((a) => a.match_id), [F.m.m8]);
  const gw2 = await gameweek(SEASON, 2);
  assert.deepEqual(ids(gw2), [F.m.m7, F.m.m4, F.m.m5, F.m.m8, F.m.m6]);
  assert.deepEqual(gw2.meta.carried.map((c) => c.match_id), [F.m.m4, F.m.m8], 'meta.carried appended, the earlier row kept');
  assert.equal(gw2.meta.games, 5);
});

test('sun-1: a re-date to a kickoff already past, or past the window, is not appended', async () => {
  // a fresh postponed round-1 fixture, re-dated beyond round 2's last (+480h)
  const [late] = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, week)
    SELECT league_id, ${`${TAG}-m9`}, home_team_id, away_team_id, ${at(500).toISOString()}::timestamptz, 'scheduled', ${SEASON}, 1
      FROM matches WHERE id = ${F.m.m1}
    RETURNING id`;
  assert.deepEqual((await appendCarried({ now: at(320), season: SEASON })).appended, [], 'past the window');
  await sql`UPDATE matches SET kickoff_at = ${at(330).toISOString()} WHERE id = ${late.id}`;
  assert.deepEqual((await appendCarried({ now: at(340), season: SEASON })).appended, [], 'already kicked off');
  assert.equal((await gameweek(SEASON, 2)).board.length, 5);
});
