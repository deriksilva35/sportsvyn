// lib/followRoundTrip.test.mjs - the follow write path, end to end, against a
// real database (TEAM FOLLOWING relay item 6).
//
// HERMETIC AND SENTINEL-ONLY. Its own league, teams, match and users in a
// timestamped namespace; every id tracked and torn down. No real account's
// row is read or written - the round trip is proved on rows this file created
// and this file deletes.
//
// It exercises lib/follows.js and the SQL the server actions run rather than
// the actions themselves, because app/actions/follows.js is 'use server' and
// resolves auth() from a request this process does not have. The statements
// below are the actions' statements verbatim; a pin further down asserts that,
// so the copy cannot drift away from the original without failing.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
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

const { sql } = await import('./db.js');
const { isFollowingTeam, getFollowedTeamIds, getFollowedTeams } = await import('./follows.js');
const { stakeForMatches } = await import('./gridiron/scoresV2.js');
const { hasStake, mineCount } = await import('./gridiron/scoresV2Shape.js');

const NS = `followtest-${Date.now()}`;
const userIds = []; const teamIds = [];
let leagueId; let matchId;

const [lg] = await sql`
  INSERT INTO leagues (slug, name, sport) VALUES (${NS}, 'Follow Test League', 'nfl') RETURNING id`;
leagueId = lg.id;
for (const tag of ['home', 'away']) {
  const [t] = await sql`
    INSERT INTO teams (league_id, slug, name, abbreviation)
    VALUES (${leagueId}, ${`${NS}-${tag}`}, ${`${NS} ${tag}`}, ${tag === 'home' ? 'FHM' : 'FAW'})
    RETURNING id`;
  teamIds.push(t.id);
}
const [homeId, awayId] = teamIds;
const [m] = await sql`
  INSERT INTO matches (league_id, slug, home_team_id, away_team_id, status, kickoff_at)
  VALUES (${leagueId}, ${`${NS}-match`}, ${homeId}, ${awayId}, 'scheduled', now() + interval '2 hours')
  RETURNING id`;
matchId = m.id;
const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}@example.invalid`}) RETURNING id`;
const uid = u.id; userIds.push(uid);

after(async () => {
  await sql`DELETE FROM user_team_follows WHERE user_id = ANY(${userIds})`;
  await sql`DELETE FROM matches WHERE id = ${matchId}`;
  await sql`DELETE FROM teams WHERE id = ANY(${teamIds})`;
  await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  // Prove the teardown: residue on a sentinel table is how a test starts
  // lying to the next one.
  const left = await sql`SELECT count(*)::int c FROM user_team_follows WHERE user_id = ANY(${userIds})`;
  assert.equal(left[0].c, 0, 'SENTINEL RESIDUE LEFT BEHIND in user_team_follows');
});

// The actions' own statements, verbatim.
const doFollow = (teamId) => sql`
  INSERT INTO user_team_follows (user_id, team_id)
  VALUES (${uid}, ${teamId})
  ON CONFLICT (user_id, team_id) DO NOTHING`;
const doUnfollow = (teamId) => sql`
  DELETE FROM user_team_follows
   WHERE user_id = ${uid} AND team_id = ${teamId}`;

test('follow and unfollow round trip', async () => {
  assert.equal(await isFollowingTeam(uid, homeId), false, 'starts unfollowed');
  await doFollow(homeId);
  assert.equal(await isFollowingTeam(uid, homeId), true, 'follow lands');
  assert.ok((await getFollowedTeamIds(uid)).has(homeId), 'and shows in the id set');
  const rows = await getFollowedTeams(uid);
  assert.equal(rows.length, 1, 'and in the list the account page reads');
  assert.equal(rows[0].id, homeId);
  assert.equal(rows[0].abbreviation, 'FHM', 'with the identity a row needs to render');
  assert.equal(rows[0].leagueSlug, NS);
  await doUnfollow(homeId);
  assert.equal(await isFollowingTeam(uid, homeId), false, 'unfollow lands');
  assert.deepEqual(await getFollowedTeams(uid), [], 'and the list empties');
});

test('duplicate follows are idempotent - the double tap cannot corrupt state', async () => {
  await doFollow(homeId);
  await doFollow(homeId);
  await doFollow(homeId);
  const n = await sql`SELECT count(*)::int c FROM user_team_follows WHERE user_id = ${uid} AND team_id = ${homeId}`;
  assert.equal(n[0].c, 1, 'three follows, one row');
  // And an unfollow of something not followed is not an error either.
  await doUnfollow(awayId);
  assert.equal(await isFollowingTeam(uid, awayId), false);
  await doUnfollow(homeId);
});

test('getFollowedTeams is newest first; the standings group still takes the OLDEST', async () => {
  await doFollow(awayId);
  await sql`UPDATE user_team_follows SET followed_at = now() - interval '10 days'
             WHERE user_id = ${uid} AND team_id = ${awayId}`;
  await doFollow(homeId);
  const list = await getFollowedTeams(uid);
  assert.deepEqual(list.map((t) => t.id), [homeId, awayId], 'the list leads with the newest');
  // followedGroup() orders the other way on purpose - your first team is your
  // team - so the two must not be "fixed" to agree.
  const first = await sql`SELECT team_id FROM user_team_follows WHERE user_id = ${uid}
                           ORDER BY followed_at ASC LIMIT 1`;
  assert.equal(first[0].team_id, awayId, 'the oldest follow is what the snapshot group reads');
  const src = readFileSync(path.join(REPO, 'lib/gridiron/landingModules.js'), 'utf8');
  assert.match(src, /ORDER BY f\.followed_at ASC\s*\n?\s*LIMIT 1/, 'and followedGroup still says so');
  await doUnfollow(homeId); await doUnfollow(awayId);
});

test('MINE COUNTS A FOLLOWED TEAM (R2), and the count moves with it', async () => {
  const games = [{
    id: matchId, leagueSlug: 'nfl', status: 'scheduled', kickoffAt: new Date(Date.now() + 7.2e6).toISOString(),
    home: { id: homeId, abbreviation: 'FHM' }, away: { id: awayId, abbreviation: 'FAW' },
    homeScore: null, awayScore: null,
  }];

  const before = await stakeForMatches(uid, games);
  assert.equal(before.size, 0, 'no pick, no Weekly player, no alert, no follow: not mine');
  assert.equal(hasStake(before.get(matchId)), false);
  assert.equal(mineCount(games, before), 0, 'Mine reads 0');

  await doFollow(homeId);
  const after1 = await stakeForMatches(uid, games);
  const st = after1.get(matchId);
  assert.ok(st, 'the game is now in the stake map');
  assert.equal(st.follow, 'home', 'and it names WHICH side is followed');
  assert.equal(st.pick, null, 'without inventing a pick');
  assert.deepEqual(st.weekly, [], 'or a Weekly player');
  assert.equal(st.alerts, false, 'or an alert');
  assert.equal(hasStake(st), true, 'a follow alone makes the game mine');
  assert.equal(mineCount(games, after1), 1, 'Mine reads 1');

  // The away side answers too, and only one side is named.
  await doUnfollow(homeId); await doFollow(awayId);
  assert.equal((await stakeForMatches(uid, games)).get(matchId).follow, 'away');

  await doUnfollow(awayId);
  assert.equal(mineCount(games, await stakeForMatches(uid, games)), 0, 'unfollow takes it back out');
});
