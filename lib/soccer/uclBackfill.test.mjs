// lib/soccer/uclBackfill.test.mjs - the UCL matchday-1 backfill (ruling fri-4),
// on DEV through a sentinel league and one sentinel final, fed the recorded
// Brugge 2-3 Villa payload: dry run writes nothing and asks nothing; --apply
// is one request through the live tick's atoms; a second run finds nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from '../db.js';
import { backfillUclEvents } from './uclBackfill.js';
import { upsertSoccerLeague } from './epl.js';

const REC = JSON.parse(readFileSync(new URL('./testdata/ucl/ucl-md1-1635643.json', import.meta.url), 'utf8'));
const PID = process.pid;
const LG = `zz-ucl-bf-${PID}`;
const FX = '994635643';
let leagueId; let teamIds = []; let matchId;

const calls = [];
const client = { fixturesByIds: async (ids) => { calls.push(ids.map(String)); return [{ ...REC, fixture: { ...REC.fixture, id: Number(FX) } }]; } };

before(async () => {
  leagueId = await upsertSoccerLeague('ucl', { storeAs: LG });
  const t = await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids)
    VALUES (${leagueId}, ${`zz-bf-home-${PID}`}, 'Zz Brugge', 'Zz Brugge', 'BRU', ${JSON.stringify({ api_sports: '569' })}::jsonb),
           (${leagueId}, ${`zz-bf-away-${PID}`}, 'Zz Villa', 'Zz Villa', 'AVL', ${JSON.stringify({ api_sports: '66' })}::jsonb)
    RETURNING id`;
  teamIds = t.map((r) => r.id);
  const m = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, season_year, week, stage, external_ids)
    VALUES (${leagueId}, ${`zz-ucl-bf-${PID}`}, ${teamIds[0]}, ${teamIds[1]}, '2031-05-01T19:00:00Z', 'final', 2, 3, 2026, 1, 'league', ${JSON.stringify({ api_sports: FX })}::jsonb)
    RETURNING id`;
  matchId = m[0].id;
});

after(async () => {
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
  const left = await sql`SELECT (SELECT count(*)::int FROM leagues WHERE slug = ${LG}) AS l, (SELECT count(*)::int FROM matches WHERE id = ${matchId}) AS m`;
  assert.deepEqual(left[0], { l: 0, m: 0 }, 'teardown');
});

test('BACKFILL: dry run lists and asks nothing; apply is one request writing events + team stats; a second run finds nothing', async () => {
  const dry = await backfillUclEvents({ sql, client, league: LG });
  assert.deepEqual(dry.candidates, [`zz-ucl-bf-${PID}`]);
  assert.equal(dry.requests, 0); assert.equal(calls.length, 0, 'a dry run makes no request');
  assert.equal((await sql`SELECT count(*)::int AS n FROM match_events WHERE match_id = ${matchId}`)[0].n, 0);

  const r = await backfillUclEvents({ sql, client, league: LG, apply: true });
  assert.equal(r.requests, 1); assert.deepEqual(calls, [[FX]]);
  assert.deepEqual(r.written, [{ slug: `zz-ucl-bf-${PID}`, events: REC.events.length, stats: true }]);
  const goals = await sql`SELECT count(*)::int AS n FROM match_events WHERE match_id = ${matchId} AND is_current AND event_type = 'Goal'`;
  assert.equal(goals[0].n, 5);
  const st = await sql`SELECT count(*)::int AS n FROM match_statistics WHERE match_id = ${matchId} AND is_current`;
  assert.equal(st[0].n, 2);

  const again = await backfillUclEvents({ sql, client, league: LG, apply: true });
  assert.deepEqual(again.candidates, []); assert.equal(again.requests, 0); assert.equal(calls.length, 1, 'idempotent: no second request');
});

test('THE SCRIPT: dry run by default, PROD only by flag with DATABASE_URL set from the env, no inline credential', () => {
  const s = readFileSync(new URL('../../scripts/ucl-backfill-events.mjs', import.meta.url), 'utf8');
  assert.match(s, /const APPLY = args\.includes\('--apply'\)/);
  assert.match(s, /process\.env\.DATABASE_URL !== process\.env\.PROD_DATABASE_URL/);
  assert.doesNotMatch(s, /postgres(ql)?:\/\//, 'no connection string in the file');
  assert.match(s, /backfillUclEvents\(\{ sql, client: apiSports, apply: APPLY, week \}\)/);
});
