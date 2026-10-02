// lib/nba/replay.test.mjs - THE NBA LIVE PATH, REPLAYED ON DEV (nba-core,
// Phase A, plan section 6).
//
// Three recorded 2025-26 games run through the real pollOnce at 30-second
// steps (lib/nba/replayRun.js), side by side: an overtime game, a blowout and
// a one-point finish. What it proves, per game:
//   scheduled -> live -> final, and the final score is the recorded one
//   the placeholder tip is corrected from the feed (kickoffOf)
//   the chip runs Q1 Q2 Half Q3 Q4 (OT), and tenths clocks parse
//   tip-off, quarter, close and final fire - and NO per-basket score push
//   final_seen_at and the line score both survive in metadata.detail (the
//   nested-merge rule), and the last play lands beside them
//   the box score lands and sums to the final score
// What it cannot prove: the live feed's own `time` spelling (never observed).
//
// DEV WRITES: one sentinel match per game (sentinel-nba-replay-<id>), deleted
// in the runner's finally{}. If DEV has no nba league, before() creates it with
// the real import's own writer (one BDL call) - the same rows
// scripts/nba-league-import.mjs --apply writes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { runNbaReplay, SENTINEL_PREFIX } from './replayRun.js';
import { REPLAY_GAMES } from './replay.js';
import { fetchNbaTeams, upsertNbaLeague, upsertNbaTeams } from './sync.js';
import { syncNbaColors } from './teamColors.js';
import { writeNbaMatches } from './schedule.js';

const sql = neon(process.env.DATABASE_URL);
if (process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
  throw new Error('replay.test refuses to run against PROD');
}

let results = null;
const byId = (id) => results.find((r) => r.id === id);
const count = (r, e) => r.events.filter((x) => x.event === e).length;

before(async () => {
  const [l] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
  const n = l ? (await sql`SELECT count(*)::int AS n FROM teams WHERE league_id = ${l.id}`)[0].n : 0;
  if (n !== 30) {
    // Fixture repair, costed: one BDL call and 30 idempotent team upserts.
    const id = await upsertNbaLeague(sql);
    await upsertNbaTeams(sql, id, await fetchNbaTeams());
    await syncNbaColors(sql, id);
  }
  results = await runNbaReplay(sql, Object.values(REPLAY_GAMES), { stepSec: 30 });
});

after(async () => {
  // THE TEARDOWN IS ASSERTED, not assumed (topicEnvelope's rule).
  const [r] = await sql`SELECT count(*)::int AS n FROM matches WHERE slug LIKE ${`${SENTINEL_PREFIX}%`}`;
  assert.equal(r.n, 0, 'replay sentinels left behind');
});

test('every game: scheduled -> live -> final, at the recorded score, nothing unmapped', () => {
  for (const r of results) {
    assert.deepEqual(r.statuses, ['scheduled', 'live', 'final'], r.label);
    assert.equal(r.final.status, 'final');
    assert.equal(r.final.home, r.recordedFinal.home, r.label);
    assert.equal(r.final.away, r.recordedFinal.away, r.label);
    assert.deepEqual(r.unmapped, [], r.label);
    assert.equal(r.final.liveState, null, 'a final carries no live state');
    assert.ok(r.livePolls > 250, `${r.label}: ${r.livePolls} live polls at 30 s`);
  }
});

test('THE PLACEHOLDER TIP IS CORRECTED from the feed before the game starts', () => {
  for (const r of results) {
    assert.ok(r.kickoffMoved, r.label);
    assert.equal(r.kickoffAt, r.scheduledTip, r.label);
    assert.ok(Date.parse(r.kickoffMoved) < Date.parse(r.tipAt), 'corrected before the first play');
  }
});

test('the chip: Q1 Q2 Half Q3 Q4, then OT; tenths clocks parse', () => {
  for (const r of results) {
    assert.deepEqual(r.shorts.slice(0, 5), ['Q1', 'Q2', 'Half', 'Q3', 'Q4'], r.label);
    assert.ok(r.tenths.length > 0, `${r.label}: a sub-minute clock was held`);
  }
  assert.deepEqual(byId(REPLAY_GAMES.ot).shorts, ['Q1', 'Q2', 'Half', 'Q3', 'Q4', 'OT']);
  assert.deepEqual(byId(REPLAY_GAMES.blowout).shorts, ['Q1', 'Q2', 'Half', 'Q3', 'Q4']);
});

test('push events: one tip-off, one per quarter left, one final - and no per-basket score', () => {
  for (const r of results) {
    assert.equal(count(r, 'score'), 0, `${r.label}: basketball sends no per-basket push`);
    assert.equal(count(r, 'kickoff'), 1, r.label);
    assert.equal(count(r, 'final'), 1, r.label);
    assert.equal(r.events.at(-1).event, 'final');
  }
  assert.equal(count(byId(REPLAY_GAMES.ot), 'quarter'), 4, 'Q1, Q2, Q3, Q4 -> OT');
  assert.equal(count(byId(REPLAY_GAMES.blowout), 'quarter'), 3);
  assert.equal(count(byId(REPLAY_GAMES.close), 'quarter'), 3);
  // the half is the quarter event that leaves period 2
  for (const r of results) assert.ok(r.events.some((e) => e.event === 'quarter' && e.period === 2), r.label);
});

test('close: fires on the one-point finish and in overtime, never in the blowout', () => {
  assert.equal(count(byId(REPLAY_GAMES.blowout), 'close'), 0);
  const close = byId(REPLAY_GAMES.close).events.filter((e) => e.event === 'close');
  assert.ok(close.length >= 1);
  for (const e of close) {
    assert.ok(e.period >= 4);
    assert.ok(Math.abs(e.home - e.away) <= 5);
  }
  const ot = byId(REPLAY_GAMES.ot).events.filter((e) => e.event === 'close');
  assert.ok(ot.some((e) => e.period === 5), 'the overtime is close');
});

test('metadata.detail keeps final_seen_at AND the line score AND the last play (nested merge)', () => {
  for (const r of results) {
    assert.match(String(r.final.finalSeenAt), /^\d{4}-\d{2}-\d{2}T/, r.label);
    const line = r.final.lineScore;
    assert.ok(Array.isArray(line) && line.length >= 4, r.label);
    assert.equal(line.reduce((a, p) => a + p.home, 0), r.recordedFinal.home, `${r.label} home line sums to the final`);
    assert.equal(line.reduce((a, p) => a + p.away, 0), r.recordedFinal.away, `${r.label} away line sums to the final`);
    assert.equal(r.final.lastPlay?.type, 'End Game', r.label);
  }
  assert.equal(byId(REPLAY_GAMES.ot).final.lineScore.length, 5);
});

test('the box score lands, every line, and sums to the final', () => {
  for (const r of results) {
    assert.equal(r.stats.rows, r.stats.recordedRows, r.label);
    assert.equal(r.stats.homePts, r.recordedFinal.home, r.label);
    assert.equal(r.stats.awayPts, r.recordedFinal.away, r.label);
  }
});

test('BDL CALLS PER MINUTE WHILE LIVE, one game through pollOnce at 30 s: plays every poll (thu-40), well under 600/min', () => {
  for (const r of results) {
    console.log(`# ${r.label}: ${r.liveCalls} calls over ${r.livePolls} live polls = ${r.callsPerLiveMin}/min`);
    // /games + /box_scores/live + /plays per poll = 6/min, the box every tenth poll = +0.2
    assert.ok(r.callsPerLiveMin >= 6 && r.callsPerLiveMin <= 7, `${r.label}: ${r.callsPerLiveMin}/min`);
  }
});

test('THE SCHEDULE RE-SYNC MOVES A TIP (the 20 Oct placeholder case), on DEV', async () => {
  const [l] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
  const teams = await sql`SELECT id, abbreviation, external_ids->>'bdl_team_id' AS pid FROM teams WHERE league_id = ${l.id} AND abbreviation IN ('BOS', 'DET')`;
  const t = new Map(teams.map((x) => [x.abbreviation, x]));
  const bdl = '990000001';
  const slug = 'sentinel-nba-tipmove';
  await sql`DELETE FROM matches WHERE league_id = ${l.id} AND external_ids->>'bdl_game_id' = ${bdl}`;
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, season_phase, metadata, external_ids, created_at, updated_at)
    VALUES (${l.id}, ${slug}, ${t.get('DET').id}, ${t.get('BOS').id}, '2031-10-20T19:00:00Z', 'scheduled', 2031, 'REG', '{}'::jsonb,
            ${JSON.stringify({ bdl_game_id: bdl })}::jsonb, now(), now()) RETURNING id`;
  try {
    const feed = [{
      id: Number(bdl), date: '2031-10-20', datetime: '2031-10-20T23:30:00.000Z', season: 2031, postseason: false,
      status: '2031-10-20T23:30:00Z', status_state: 'scheduled', period: 0, time: null,
      home_team: { id: Number(t.get('DET').pid), abbreviation: 'DET' }, visitor_team: { id: Number(t.get('BOS').pid), abbreviation: 'BOS' },
    }];
    const res = await writeNbaMatches(sql, l.id, feed);
    assert.equal(res.refused.length, 0);
    const c = res.changes.find((x) => x.bdl === bdl);
    assert.equal(c.kickoffFrom, '2031-10-20T19:00:00.000Z');
    assert.equal(c.kickoffTo, '2031-10-20T23:30:00.000Z');
    const [after] = await sql`SELECT kickoff_at, slug FROM matches WHERE id = ${m.id}`;
    assert.equal(new Date(after.kickoff_at).toISOString(), '2031-10-20T23:30:00.000Z');
    assert.equal(after.slug, 'nba-2031-10-20-bos-det', 'a sentinel slug is not an nba slug, so the writer files it');
  } finally {
    await sql`DELETE FROM matches WHERE id = ${m.id}`;
    const [gone] = await sql`SELECT count(*)::int AS n FROM matches WHERE id = ${m.id}`;
    assert.equal(gone.n, 0, 'teardown');
  }
});
