// lib/cfb/bdlLiveLeagueWide.test.mjs - the live box score's enumeration, end
// to end against a real database (ruling sun-7: every live CFB game, not just
// Pick'em board games).
//
// SENTINEL-ONLY. Its own league, two teams and three matches in a timestamped
// `sentinel-` namespace (scripts/dev-orphan-sweep.mjs finds it if a killed run
// skips the teardown). None of the matches is on any contest's board - that is
// the point: under the old board join, NONE of them would have been seen.
// The provider is stubbed; no network.
//
// A REAL WRITE. Until 4 Oct 2026 DEV lacked migration 080 (cfb_live_player_lines)
// and this ran dryRun; 080 is now on DEV (ruling sun-20), so the upsert runs and
// the row is read back. The line rows cascade with the sentinel match.

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
})(path.join(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { liveCfbMatches, syncCfbLiveLines } = await import('./bdlLive.js');

const NS = `sentinel-cfblivebox-${Date.now()}`;
const [lg] = await sql`
  INSERT INTO leagues (slug, name, sport) VALUES (${NS}, 'CFB Live Box Sentinel', 'cfb') RETURNING id`;
const leagueId = lg.id;
const teamIds = [];
for (const [tag, name] of [['h', `${NS} Home`], ['a', `${NS} Away`]]) {
  const [t] = await sql`
    INSERT INTO teams (league_id, slug, name, abbreviation)
    VALUES (${leagueId}, ${`${NS}-${tag}`}, ${name}, ${tag === 'h' ? 'SLH' : 'SLA'}) RETURNING id`;
  teamIds.push(t.id);
}
const matchIds = {};
for (const status of ['live', 'final', 'scheduled']) {
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, status, kickoff_at)
    VALUES (${leagueId}, ${`${NS}-${status}`}, ${teamIds[0]}, ${teamIds[1]}, ${status}, now() - interval '1 hour')
    RETURNING id`;
  matchIds[status] = m.id;
}
const allMatches = Object.values(matchIds);

after(async () => {
  await sql`DELETE FROM cfb_live_player_lines WHERE match_id = ANY(${allMatches})`;
  await sql`DELETE FROM matches WHERE id = ANY(${allMatches})`;
  await sql`DELETE FROM teams WHERE id = ANY(${teamIds})`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  const [left] = await sql`
    SELECT (SELECT count(*) FROM matches WHERE league_id = ${leagueId})::int
         + (SELECT count(*) FROM leagues WHERE id = ${leagueId})::int AS c`;
  assert.equal(left.c, 0, 'SENTINEL RESIDUE LEFT BEHIND');
});

test('liveCfbMatches: the off-board LIVE match is listed; final and scheduled are not', async () => {
  const rows = await liveCfbMatches(leagueId);
  assert.deepEqual(rows.map((r) => r.id), [matchIds.live]);
  assert.equal(rows[0].home_name, `${NS} Home`, 'names come through for the /games join');
  const onBoard = await sql`
    SELECT count(*)::int c FROM contests c, jsonb_array_elements(c.board) g
     WHERE (g->>'match_id')::int = ANY(${allMatches})`;
  assert.equal(onBoard[0].c, 0, 'precondition: no board names these matches');
});

test('syncCfbLiveLines reaches the off-board live game and only it', async () => {
  const gamesCalls = [];
  const s = await syncCfbLiveLines(leagueId, {
    fetchGames: async (iso) => {
      gamesCalls.push(iso);
      return [{ id: 990001, home_team: { college: `${NS} Home` }, visitor_team: { college: `${NS} Away` } }];
    },
    fetchPlayerStats: async () => [{
      player: { id: 990002, first_name: 'Sentinel', last_name: 'Passer', position: 'QB' },
      team: { college: `${NS} Home` }, passing_yards: 12,
    }],
  });
  assert.equal(s.liveGames, 1);
  assert.equal(s.resolved, 1);
  assert.equal(s.rows, 1);
  assert.equal(s.noTeam, 0, 'the line resolved to our team by name');
  assert.equal(gamesCalls.length, 1);
  assert.deepEqual(s.perGame, [{ match: matchIds.live, bdlGameId: 990001, cached: false, rows: 1 }]);
  const [m] = await sql`SELECT external_ids->>'bdl_ncaaf_game_id' AS g FROM matches WHERE id = ${matchIds.live}`;
  assert.equal(m.g, '990001', 'the bridge id is cached for the next tick');
  const lines = await sql`
    SELECT match_id, bdl_player_id, last_name, team_id, pass_yds
      FROM cfb_live_player_lines WHERE match_id = ANY(${allMatches})`;
  assert.equal(lines.length, 1, 'exactly one line written, on the live match only');
  assert.equal(lines[0].match_id, matchIds.live);
  assert.equal(Number(lines[0].bdl_player_id), 990002);
  assert.equal(lines[0].team_id, teamIds[0], 'the line carries our team');
  assert.equal(Number(lines[0].pass_yds), 12);
});
