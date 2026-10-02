// lib/soccer/uclLive.test.mjs - THE CHAMPIONS LEAGUE THROUGH THE EPL'S LIVE
// TICK (ucl, fri-3), replayed on DEV from a recorded final: Club Brugge 2-3
// Aston Villa, matchday 1 (testdata/ucl/ucl-md1-1635643.json, the provider's
// /fixtures?ids= shape with events, statistics, lineups and players embedded).
//
// What is proved:
//   - ONE REQUEST A TICK covers both leagues: an EPL row and a UCL row in the
//     same window go out in the same ids= call;
//   - the UCL row is scored, timed, given its goals/cards and team stats, and
//     finals at full time;
//   - what stays EPL's stays EPL's: no full-time player-stats import and no
//     in-play lines for a UCL row.
// Sentinel rows only (zz- slugs, 99xxxxxxx fixture ids, kickoffs in 2031),
// removed in after() and the removal asserted.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sql } from '../db.js';
import { runEplLive, eplWindowOpen, goalsOf } from './eplLive.js';
import { upsertSoccerLeague } from './epl.js';

const REC = JSON.parse(readFileSync(new URL('./testdata/ucl/ucl-md1-1635643.json', import.meta.url), 'utf8'));

const FX_UCL = '992635643';
const FX_EPL = '991557411';
const KO = new Date('2031-03-11T20:00:00Z');
const at = (min) => new Date(KO.getTime() + min * 60000);
const PID = process.pid;
const SLUG_UCL = `zz-ucl-replay-${PID}`;
const SLUG_EPL = `zz-epl-ucl-replay-${PID}`;
let ids = []; let teamIds = [];

/** The recorded final as it stood at `elapsed`. */
function frame(short, elapsed) {
  const events = short === 'NS' ? [] : REC.events.filter((e) => (e.time?.elapsed ?? 0) <= elapsed);
  const g = goalsOf({ ...REC, events });
  return {
    ...REC,
    fixture: { ...REC.fixture, id: Number(FX_UCL), status: { long: short, short, elapsed, extra: null } },
    goals: short === 'NS' ? { home: null, away: null } : { home: g.filter((x) => x.side === 'home').length, away: g.filter((x) => x.side === 'away').length },
    score: { ...REC.score, halftime: elapsed >= 45 && short !== '1H' ? REC.score.halftime : { home: null, away: null } },
    events,
    statistics: short === 'NS' ? [] : REC.statistics,
    players: short === 'FT' ? REC.players : [],
  };
}

const calls = [];
const client = (f) => ({ fixturesByIds: async (want) => { calls.push([...want].map(String)); return [f].filter((x) => want.map(String).includes(String(x.fixture.id))); } });
const noBreaker = { isTripped: async () => false, trip: async () => {} };
const linesFor = [];
const liveLines = async (_sql, matchId) => { linesFor.push(matchId); };
const statsFor = [];
const importStats = async (_sql, { matchIds }) => { statsFor.push(...matchIds); return { inserted: 0, updated: 0 }; };
const row = async (slug) => (await sql`SELECT id, status, home_score, away_score, metadata FROM matches WHERE slug = ${slug}`)[0];

before(async () => {
  // The 'ucl' league row is configuration, not a fixture: the importer makes
  // it on its first run and this makes it if that has not happened on DEV.
  const ucl = await upsertSoccerLeague('ucl');
  const t = await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids)
    VALUES (${ucl}, ${`zz-ucl-home-${PID}`}, 'Zz Brugge', 'Zz Brugge', 'BRU', ${JSON.stringify({ api_sports: '569' })}::jsonb),
           (${ucl}, ${`zz-ucl-away-${PID}`}, 'Zz Villa', 'Zz Villa', 'AVL', ${JSON.stringify({ api_sports: '66' })}::jsonb)
    RETURNING id`;
  teamIds = t.map((r) => r.id);
  const epl = await sql`SELECT id FROM leagues WHERE slug = 'epl'`;
  const et = await sql`SELECT id FROM teams WHERE league_id = ${epl[0].id} AND external_ids->>'api_sports' IN ('45', '57') ORDER BY id LIMIT 2`;
  const ins = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, week, stage, external_ids)
    VALUES (${ucl}, ${SLUG_UCL}, ${teamIds[0]}, ${teamIds[1]}, ${KO.toISOString()}, 'scheduled', 2026, 1, 'league', ${JSON.stringify({ api_sports: FX_UCL })}::jsonb),
           (${epl[0].id}, ${SLUG_EPL}, ${et[0].id}, ${et[1].id}, ${at(-30).toISOString()}, 'scheduled', 2026, 99, null, ${JSON.stringify({ api_sports: FX_EPL })}::jsonb)
    RETURNING id`;
  ids = ins.map((r) => r.id);
});

after(async () => {
  await sql`DELETE FROM matches WHERE id = ANY(${ids})`;
  await sql`DELETE FROM teams WHERE id = ANY(${teamIds})`;
  const left = await sql`
    SELECT (SELECT count(*)::int FROM matches WHERE slug IN (${SLUG_UCL}, ${SLUG_EPL})) AS m,
           (SELECT count(*)::int FROM teams WHERE id = ANY(${teamIds})) AS t`;
  assert.deepEqual(left[0], { m: 0, t: 0 }, 'teardown removed the replay rows (events and stats cascade)');
});

test('REPLAY: one ids= call for both leagues; the UCL row goes 1H -> HT -> 2H -> FT with goals, cards and stats; nothing EPL-only touches it', async () => {
  assert.equal(await eplWindowOpen(sql, at(-600)), false, 'outside the window: no call');

  // 10 minutes out: both rows armed, ONE request carrying both fixtures.
  let r = await runEplLive({ sql, client: client(frame('NS', null)), breaker: noBreaker, importStats, liveLines, now: at(-10) });
  assert.equal(r.decision, 'ran');
  assert.equal(calls.length, 1, 'one request a tick');
  assert.deepEqual([...calls[0]].sort(), [FX_EPL, FX_UCL].sort(), 'the EPL and the UCL fixture in the same call');

  // 11': McGinn.
  await runEplLive({ sql, client: client(frame('1H', 11)), breaker: noBreaker, importStats, liveLines, now: at(11) });
  let m = await row(SLUG_UCL);
  assert.equal(m.status, 'live'); assert.equal(m.home_score, 0); assert.equal(m.away_score, 1);
  assert.deepEqual(m.metadata.live_state, { elapsed: 11, extra: null, period: '1H' });
  assert.equal(m.metadata.epl_live.goals[0].player, 'J. McGinn');
  assert.equal(m.metadata.epl_live.goals[0].side, 'away');

  // Half time, 1-3.
  await runEplLive({ sql, client: client(frame('HT', 45)), breaker: noBreaker, importStats, liveLines, now: at(48) });
  m = await row(SLUG_UCL);
  assert.equal(m.metadata.live_state.period, 'HT');
  assert.deepEqual(m.metadata.epl_live.halftime, { home: 1, away: 3 });
  assert.deepEqual([m.home_score, m.away_score], [1, 3]);

  // 62': Tresoldi's penalty.
  await runEplLive({ sql, client: client(frame('2H', 62)), breaker: noBreaker, importStats, liveLines, now: at(80) });
  m = await row(SLUG_UCL);
  assert.deepEqual([m.home_score, m.away_score], [2, 3]);
  assert.equal(m.metadata.epl_live.goals.at(-1).kind, 'penalty');

  // Full time: final, the whistle stamped; the timeline and the team stats are in.
  r = await runEplLive({ sql, client: client(frame('FT', 90)), breaker: noBreaker, importStats, liveLines, now: at(112) });
  m = await row(SLUG_UCL);
  assert.equal(m.status, 'final'); assert.equal(m.metadata.live_state, null);
  assert.deepEqual([m.home_score, m.away_score], [2, 3]);
  assert.equal(m.metadata.epl_live.fullTimeAt, at(112).toISOString());
  assert.ok(r.final.includes(SLUG_UCL));
  const ev = await sql`SELECT count(*)::int AS n FROM match_events WHERE match_id = ${m.id} AND is_current AND event_type = 'Goal'`;
  assert.equal(ev[0].n, 5, 'five goals on the timeline');
  const st = await sql`SELECT count(*)::int AS n FROM match_statistics WHERE match_id = ${m.id} AND is_current`;
  assert.equal(st[0].n, 2, 'team stats, both sides');

  // EPL's own: no player-stats import and no in-play lines for a UCL row.
  assert.ok(!statsFor.includes(m.id), 'no full-time player stats for the UCL');
  assert.ok(!linesFor.includes(m.id), 'no in-play lines for the UCL');
  assert.ok(!(r.ft ?? []).some((x) => x.slug === SLUG_UCL));
  assert.equal(m.metadata.epl_stats, undefined);
  assert.equal(r.errors.length, 0, r.errors.join(' | '));
});
