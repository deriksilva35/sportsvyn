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
const match = { id: matchId, home_team_id: homeId, away_team_id: awayId };

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

async function mkDevice(userId, tag) {
  await sql`INSERT INTO device_tokens (token, user_id, platform) VALUES (${`${NS}-${tag}`}, ${userId}, 'ios')`;
}
await mkDevice(uFollowOnly, 'follow-only');
await mkDevice(uMatchOnly, 'match-only');
await mkDevice(uNeither, 'neither');
await mkDevice(uBoth, 'both');

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

after(async () => {
  await sql`DELETE FROM alert_prefs WHERE user_id = ANY(${userIds})`;
  await sql`DELETE FROM user_team_follows WHERE user_id = ANY(${userIds})`;
  await sql`DELETE FROM device_tokens WHERE user_id = ANY(${userIds})`;
  await sql`DELETE FROM matches WHERE id = ${matchId}`;
  await sql`DELETE FROM teams WHERE id = ANY(${teamIds})`;
  await sql`DELETE FROM users WHERE id = ANY(${userIds})`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
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
