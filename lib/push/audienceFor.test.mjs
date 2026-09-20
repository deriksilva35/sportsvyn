// lib/push/audienceFor.test.mjs - the audience UNION fix (RELAY - GAME ALERTS
// FIX). A saved match-scoped alert_prefs row is sufficient on its own to
// enter audienceFor()'s result set - no team-follow required. Hermetic:
// synthetic league/teams/match/users/device_tokens/follows/prefs, own
// namespace, torn down by tracked id.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
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
const { audienceFor } = await import('./dispatch.js');
const { wants, resolvePrefs } = await import('./prefs.js');

const NS = `audiencetest-${Date.now()}`;
const userIds = [];
const teamIds = [];
let leagueId; let matchId;

const leagueRow = await sql`
  INSERT INTO leagues (slug, name, sport) VALUES (${NS}, 'Audience Test League', 'nfl') RETURNING id`;
leagueId = leagueRow[0].id;

async function mkTeam(slug) {
  const [row] = await sql`
    INSERT INTO teams (league_id, slug, name) VALUES (${leagueId}, ${slug}, ${slug}) RETURNING id`;
  teamIds.push(row.id);
  return row.id;
}
const homeId = await mkTeam(`${NS}-home`);
const awayId = await mkTeam(`${NS}-away`);
const thirdId = await mkTeam(`${NS}-third`); // a team in the match neither, follows

const [matchRow] = await sql`
  INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status)
  VALUES (${leagueId}, ${NS}, ${homeId}, ${awayId}, now(), 'live') RETURNING id`;
matchId = matchRow.id;
// league_id IS PART OF THE CONTRACT NOW (NFL RED ZONE). The red-zone arm keys
// on it, so a caller that forgets it silently admits nobody - matchForPush
// spreads the candidate row, which carries it, and this object mirrors that.
const match = { id: matchId, league_id: leagueId, home_team_id: homeId, away_team_id: awayId };

// A SECOND LEAGUE AND A SECOND GAME, so "red zone is one league" is provable
// rather than asserted. Same shape, different league id.
const [otherLeagueRow] = await sql`
  INSERT INTO leagues (slug, name, sport) VALUES (${`${NS}-other`}, 'Other League', 'nfl') RETURNING id`;
const otherLeagueId = otherLeagueRow.id;
const [otherHome] = await sql`
  INSERT INTO teams (league_id, slug, name) VALUES (${otherLeagueId}, ${`${NS}-oh`}, ${`${NS}-oh`}) RETURNING id`;
const [otherAway] = await sql`
  INSERT INTO teams (league_id, slug, name) VALUES (${otherLeagueId}, ${`${NS}-oa`}, ${`${NS}-oa`}) RETURNING id`;
teamIds.push(otherHome.id, otherAway.id);
const [otherMatchRow] = await sql`
  INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status)
  VALUES (${otherLeagueId}, ${`${NS}-other`}, ${otherHome.id}, ${otherAway.id}, now(), 'live') RETURNING id`;
const otherMatch = {
  id: otherMatchRow.id, league_id: otherLeagueId,
  home_team_id: otherHome.id, away_team_id: otherAway.id,
};

async function mkUser(tag) {
  const [row] = await sql`
    INSERT INTO users (email) VALUES (${`${NS}-${tag}@example.invalid`}) RETURNING id`;
  userIds.push(row.id);
  return row.id;
}
const uFollowOnly = await mkUser('follow-only');
const uMatchOnly = await mkUser('match-only');
const uNeither = await mkUser('neither');
const uBoth = await mkUser('both');
const uLeague = await mkUser('league-only');      // red zone, nothing else
const uLeagueFollow = await mkUser('league-follow');
const uLeagueMatch = await mkUser('league-match');
const uLeagueOff = await mkUser('league-off');    // red zone switched off

async function mkDevice(userId, tag) {
  await sql`INSERT INTO device_tokens (token, user_id, platform) VALUES (${`${NS}-${tag}`}, ${userId}, 'ios')`;
}
await mkDevice(uFollowOnly, 'follow-only');
await mkDevice(uMatchOnly, 'match-only');
await mkDevice(uNeither, 'neither');
await mkDevice(uBoth, 'both');
await mkDevice(uLeague, 'league-only');
await mkDevice(uLeagueFollow, 'league-follow');
await mkDevice(uLeagueMatch, 'league-match');
await mkDevice(uLeagueOff, 'league-off');

// uFollowOnly follows the home team - existing path.
await sql`INSERT INTO user_team_follows (user_id, team_id) VALUES (${uFollowOnly}, ${homeId})`;
// uBoth follows the away team AND saves a match row - both entry points.
await sql`INSERT INTO user_team_follows (user_id, team_id) VALUES (${uBoth}, ${awayId})`;
// uNeither follows an unrelated third team - present in follows, absent from this match.
await sql`INSERT INTO user_team_follows (user_id, team_id) VALUES (${uNeither}, ${thirdId})`;

// uMatchOnly and uBoth each save a match-scoped row for THIS match - no follow needed for uMatchOnly.
await sql`
  INSERT INTO alert_prefs (user_id, scope, scope_id, master, kickoff, score, quarter, close, final_only)
  VALUES (${uMatchOnly}, 'match', ${matchId}, true, true, true, true, true, false)`;
await sql`
  INSERT INTO alert_prefs (user_id, scope, scope_id, master, kickoff, score, quarter, close, final_only)
  VALUES (${uBoth}, 'match', ${matchId}, true, true, true, true, true, false)`;

// RED-ZONE ROWS. score and final on, kickoff/quarter/close off - the shape the
// You-page switch writes.
const rz = (uid, master = true) => sql`
  INSERT INTO alert_prefs (user_id, scope, scope_id, master, kickoff, score, quarter, close, final_only)
  VALUES (${uid}, 'league', ${leagueId}, ${master}, false, true, false, false, true)`;
await rz(uLeague);
await rz(uLeagueFollow);
await rz(uLeagueMatch);
await rz(uLeagueOff, false);
// uLeagueFollow ALSO follows the home team; uLeagueMatch ALSO saved this match.
await sql`INSERT INTO user_team_follows (user_id, team_id) VALUES (${uLeagueFollow}, ${homeId})`;
await sql`
  INSERT INTO alert_prefs (user_id, scope, scope_id, master, kickoff, score, quarter, close, final_only)
  VALUES (${uLeagueMatch}, 'match', ${matchId}, true, false, false, false, false, true)`;

after(async () => {
  await sql`DELETE FROM alert_prefs WHERE user_id = ANY(${userIds})`;
  await sql`DELETE FROM user_team_follows WHERE user_id = ANY(${userIds})`;
  await sql`DELETE FROM device_tokens WHERE user_id = ANY(${userIds})`;
  await sql`DELETE FROM matches WHERE id = ANY(${[matchId, otherMatchRow.id]})`;
  await sql`DELETE FROM teams WHERE id = ANY(${teamIds})`;
  await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
  await sql`DELETE FROM leagues WHERE id = ANY(${[leagueId, otherLeagueId]})`;
});

test('a follow-only user appears once, via the existing path', async () => {
  const rows = await audienceFor(sql, match);
  const mine = rows.filter((r) => r.userId === uFollowOnly);
  assert.equal(mine.length, 1, 'follow-only user must appear exactly once');
});

test('a match-only user (no follow) appears once - the ruling: a saved match row is sufficient on its own', async () => {
  const rows = await audienceFor(sql, match);
  const mine = rows.filter((r) => r.userId === uMatchOnly);
  assert.equal(mine.length, 1, 'match-scoped-only user must now appear');
  assert.ok(mine[0].prefs, 'their resolved prefs must be present');
});

test('a user with neither a follow on this match nor a saved match row does not appear', async () => {
  const rows = await audienceFor(sql, match);
  const mine = rows.filter((r) => r.userId === uNeither);
  assert.equal(mine.length, 0, 'a follow on an unrelated team must not leak this user in');
});

test('a user reachable via BOTH entry points appears exactly once, not twice', async () => {
  const rows = await audienceFor(sql, match);
  const mine = rows.filter((r) => r.userId === uBoth);
  assert.equal(mine.length, 1, 'DISTINCT ON (d.token) must collapse both entry points to one row');
});

// ---------------------------------------------------------------------------
// WHICH ARM ADMITTED THEM (migration 096)
// ---------------------------------------------------------------------------
// The entry path used to be thrown away, and it is not recoverable
// afterwards: a follow with no team-scoped pref resolves to DEFAULTS and
// reports source='default', which reads like neither path. `via` is now
// carried out of the query and recorded on the push_sends row.

test('via names the arm: follow, match, or both', async () => {
  const rows = await audienceFor(sql, match);
  const via = (uid) => rows.find((r) => r.userId === uid)?.via;
  assert.equal(via(uFollowOnly), 'follow');
  assert.equal(via(uMatchOnly), 'match');
  assert.equal(via(uBoth), 'both', 'reachable by both paths - neither is hidden by the other');
});

test('via is independent of the resolved pref source', async () => {
  // The distinction the old data could not express: uFollowOnly has no
  // team-scoped row, so its prefs report source='default' while its ENTRY
  // was unambiguously the follow. Two different questions, two fields.
  const row = (await audienceFor(sql, match)).find((r) => r.userId === uFollowOnly);
  assert.equal(row.via, 'follow');
  assert.equal(row.prefs.source, 'default');
});

test('collapsing to one row did not cost the arm - both is still both', async () => {
  // UNION ALL + GROUP BY, not UNION: with the arm labelled the two rows
  // stop being duplicates, so a plain UNION would have kept both and
  // DISTINCT ON would have silently picked whichever sorted first.
  const rows = await audienceFor(sql, match);
  const mine = rows.filter((r) => r.userId === uBoth);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].via, 'both');
});


// ---------------------------------------------------------------------------
// NFL RED ZONE - the third arm
// ---------------------------------------------------------------------------

test('A LEAGUE ROW ADMITS A DEVICE WITH NO FOLLOW AND NO MATCH ROW', async () => {
  const rows = await audienceFor(sql, match);
  const mine = rows.filter((r) => r.userId === uLeague);
  assert.equal(mine.length, 1, 'red zone is an admission on its own');
  assert.equal(mine[0].via, 'league', 'and the ledger records which arm let them in');
  assert.equal(mine[0].prefs.source, 'league', 'their prefs come from the league row');
  assert.equal(mine[0].prefs.score, true);
  assert.equal(mine[0].prefs.final, true);
});

test('THE OLD ARMS KEEP THEIR LABELS - league only when it is the sole admission', async () => {
  const rows = await audienceFor(sql, match);
  const follow = rows.filter((r) => r.userId === uLeagueFollow);
  assert.equal(follow.length, 1, 'a follow and a league row is ONE audience row, not two');
  assert.equal(follow[0].via, 'follow', 'the older, more specific label survives');

  const m = rows.filter((r) => r.userId === uLeagueMatch);
  assert.equal(m.length, 1);
  assert.equal(m[0].via, 'match');

  // And nothing already in the ledger changed meaning.
  assert.equal(rows.find((r) => r.userId === uFollowOnly).via, 'follow');
  assert.equal(rows.find((r) => r.userId === uMatchOnly).via, 'match');
  assert.equal(rows.find((r) => r.userId === uBoth).via, 'both');
});

test('A SILENCED LEAGUE ROW ADMITS NOBODY', async () => {
  // master is checked in the arm, not left to wants(): a silenced subscriber
  // must not be counted in an audience the dispatcher never intends to send to.
  const rows = await audienceFor(sql, match);
  assert.equal(rows.filter((r) => r.userId === uLeagueOff).length, 0);
});

test('RED ZONE IS ONE LEAGUE - it does not admit to another league\'s game', async () => {
  const rows = await audienceFor(sql, otherMatch);
  for (const uid of [uLeague, uLeagueFollow, uLeagueMatch]) {
    assert.equal(rows.filter((r) => r.userId === uid).length, 0,
      'an NFL red-zone row must not reach a game in another league');
  }
});

test('PRECEDENCE: MATCH BEATS TEAM BEATS LEAGUE', async () => {
  const rows = await audienceFor(sql, match);
  // uLeagueMatch has BOTH a league row (score on) and a match row (score off,
  // final on). The match row wins whole - not field by field.
  const m = rows.find((r) => r.userId === uLeagueMatch);
  assert.equal(m.prefs.source, 'match');
  assert.equal(wants(m.prefs, 'score'), false,
    'a game turned off stays off for a red-zone subscriber');
  // THE CLARIFICATION'S GUARD: they still get the RESULT of that game.
  assert.equal(wants(m.prefs, 'final'), true,
    'the final of a game they got no scores from still reaches them');

  // AND A BARE FOLLOW OUTRANKS THE LEAGUE FLOOR TOO. uLeagueFollow follows the
  // home team and has saved no team row, so their prefs are DEFAULTS - not the
  // league row's. Switching red zone on must never take away alerts a reader
  // already had for a team they follow.
  const f = rows.find((r) => r.userId === uLeagueFollow);
  assert.equal(f.prefs.source, 'default', 'a follow is a claim; the league row is not its override');
  assert.equal(wants(f.prefs, 'kickoff'), true, 'they keep the kickoff alert red zone does not send');
  assert.equal(wants(f.prefs, 'close'), true, 'and the close alert');
});

test('THE LEAGUE ROW ADMITS TO EVERY EVENT, with its own switches deciding', () => {
  // Pure: the arm admits regardless of event - audienceFor takes no event - and
  // wants() gates which of the five actually send.
  const p = resolvePrefs({
    leaguePref: { master: true, kickoff: false, score: true, quarter: false, close: false, final: true },
  });
  assert.equal(p.source, 'league');
  assert.deepEqual(
    ['kickoff', 'score', 'quarter', 'close', 'final'].map((e) => wants(p, e)),
    [false, true, false, false, true],
    'scores and finals, not kickoffs and quarter ends');

  // Scores off, finals on: the clarification's case stated at the pref level.
  const noScores = resolvePrefs({
    leaguePref: { master: true, kickoff: false, score: false, quarter: false, close: false, final: true },
  });
  assert.equal(wants(noScores, 'score'), false);
  assert.equal(wants(noScores, 'final'), true);

  // master gates all five, as it does everywhere.
  const off = resolvePrefs({
    leaguePref: { master: false, kickoff: true, score: true, quarter: true, close: true, final: true },
  });
  for (const e of ['kickoff', 'score', 'quarter', 'close', 'final']) assert.equal(wants(off, e), false);
});
