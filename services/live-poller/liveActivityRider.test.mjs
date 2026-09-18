// services/live-poller/liveActivityRider.test.mjs - the rider, driven through
// the REAL pollOnce against DEV (relay 4).
//
// WHY THROUGH pollOnce AND NOT AROUND IT. The thing worth proving is not that
// activityEventFor returns 'update' - a unit test says that in a millisecond -
// but that the poller reaches it at all, with the AFTER row in hand. pollOnce
// takes its fetcher and normalise as arguments, so a synthetic provider payload
// drives the whole path: candidate query, write, transitions, rider.
//
// A SENTINEL MATCH AND A SENTINEL ACTIVITY, never a real one. Everything here
// is created by this file and deleted by it, and the teardown verifies itself.
//
// THE SENDER IS DARK ON PURPOSE. The APNs env vars are deleted before pollOnce
// runs, so pushLiveActivities reports what it WOULD have sent and posts
// nothing. That is the one thing this test must not do: a live send from a
// suite run would push a stranger's lock screen.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { pollOnce } from './poll.mjs';
import { stateFromMatch } from '../../lib/push/liveActivityState.js';

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

// DARK BEFORE ANYTHING IMPORTS THE SENDER.
for (const k of ['PUSH_ENABLED', 'APNS_KEY', 'APNS_KEY_PATH', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k];

const { sql } = await import('../../lib/db.js');

const NS = `sentinel-la-rider-${Date.now()}`;
const PID = `${NS}-pid`;
const ACT = `${NS}-a1`;
const TOKEN = 'd'.repeat(160);
let matchId; let leagueId; let homeId; let awayId;

/** A provider payload for the sentinel game, in the one shape normalise reads. */
const feed = (status, homeScore, awayScore, period, clock) => async () => ({
  rows: [{ id: PID, status, homeScore, awayScore, period, clock }],
  calls: 1,
});
const normalise = (row) => ({
  providerId: String(row.id),
  status: row.status,
  homeScore: row.homeScore,
  awayScore: row.awayScore,
  // PERIOD IS AN INTEGER here, as lib/live/vocabulary.js's liveState() writes
  // it and as every row on PROD holds it. A string 'Q3' would make this test
  // agree with itself and with nothing else.
  liveState: row.status === 'live' ? { period: row.period, clock: row.clock } : null,
});

const poll = (fetcher) => pollOnce(sql, {
  league: 'nfl', providerKey: 'bdl_game_id', fetcher, normalise, now: new Date(), push: true,
});

const activityRow = async () =>
  (await sql`SELECT ended_at, revoked_at, updated_at FROM live_activities WHERE activity_id = ${ACT}`)[0] ?? null;

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
  leagueId = lg.id;
  const teams = await sql`SELECT id FROM teams WHERE league_id = ${leagueId} ORDER BY id LIMIT 2`;
  [homeId, awayId] = [teams[0].id, teams[1].id];
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at,
                         home_score, away_score, external_ids)
    VALUES (${leagueId}, ${NS}, 'live', ${homeId}, ${awayId}, now(), 3, 7,
            ${JSON.stringify({ bdl_game_id: PID })}::jsonb)
    RETURNING id`;
  matchId = m.id;
  await sql`
    INSERT INTO live_activities (activity_id, push_token, user_id, match_id, started_at)
    VALUES (${ACT}, ${TOKEN}, NULL, ${matchId}, now())`;
});

after(async () => {
  // THIS RUN'S ROWS, NOT THE WHOLE PREFIX (test-iso relay). The old sweep took
  // 'sentinel-la-rider-%' and then ASSERTED the count was zero - so a second
  // run of this file writing between the DELETE and the SELECT failed the
  // first one, the same shape that made collegeSurface flake for two relays.
  // NS already carries a per-run stamp; the teardown now uses it.
  //
  // RESIDUE FROM A DEAD RUN is still swept, but by AGE rather than by prefix:
  // an hour is longer than any suite file runs, so it can never be a live
  // sibling's row.
  await sql`DELETE FROM live_activities WHERE activity_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM live_activities WHERE activity_id LIKE 'sentinel-la-rider-%'
              AND created_at < now() - interval '1 hour'`;
  // THE WIRE ROWS TOO. A score change emits a headline, and a sentinel game
  // leaking onto the wire is exactly the residue this teardown exists for.
  await sql`DELETE FROM news_items WHERE payload->>'matchId' = ${String(matchId)}
               OR headline LIKE ${`%${NS}%`}`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${NS}%`}`;
  await sql`DELETE FROM matches WHERE slug LIKE 'sentinel-la-rider-%'
              AND kickoff_at < now() - interval '1 hour' AND season_year >= 2090`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM live_activities WHERE activity_id LIKE ${`${NS}%`}) AS acts,
           (SELECT count(*)::int FROM matches WHERE slug LIKE ${`${NS}%`}) AS matches`;
  assert.equal(left.acts, 0, 'sentinel activities left behind');
  assert.equal(left.matches, 0, 'sentinel matches left behind');
});

test('A SCORE CHANGE REACHES THE RIDER, with the after row\'s numbers', async () => {
  const out = await poll(feed('live', 10, 7, 2, '8:12'));
  assert.equal(out.written, 1, 'the write happened');
  assert.equal(out.liveActivities.length, 1, 'exactly one live-activity push for the poll');
  const la = out.liveActivities[0];
  assert.equal(la.event, 'update');
  assert.equal(la.matchId, matchId);
  assert.equal(la.activities, 1, 'found the one live Activity for this match');
  // DARK, so it skipped rather than sent - and it still counted what it would
  // have pushed, which is the difference between a quiet night and a broken one.
  assert.equal(la.skipped, 1);
  assert.equal(la.sent, 0);
  assert.equal(la.failed, 0);
});

test('A QUARTER CHANGE PUSHES THE NEW QUARTER, not the one the game left', async () => {
  // THE HOLE THIS TEST WAS WRITTEN AGAINST, now closed. poll.mjs used to call
  //   transitionsFor({ ...m, live_state: null }, ...)
  // because the candidate query never selected m.metadata, so the BEFORE period
  // was null on every poll and 'quarter' could not fire at all. The query now
  // selects it.
  //
  // AND THE SECOND TRAP: transitionsFor deliberately puts the BEFORE period on
  // its quarter event so an alert can say "End of Q2". A card built from the
  // event would show Q2 at the moment the game entered Q3 - and would pass any
  // test that only checks that a push went out. The rider builds from the AFTER
  // row, so the assertion below is on the row, not on the event.
  const out = await poll(feed('live', 10, 7, 3, '14:52'));
  assert.equal(out.liveActivities.length, 1, 'the quarter alone is worth a push');
  assert.equal(out.liveActivities[0].event, 'update');
  const [row] = await sql`SELECT metadata->'live_state'->>'period' AS period FROM matches WHERE id = ${matchId}`;
  assert.equal(row.period, '3', 'and the row the state is built from holds the NEW period');
  // What the card would carry, built the way the rider builds it.
  assert.equal(stateFromMatch({
    away: { abbreviation: 'X' }, home: { abbreviation: 'Y' },
    awayScore: 7, homeScore: 10, liveState: { period: 3, clock: '14:52' },
  }).period, 'Q3');
});

test('A POLL THAT CHANGES NOTHING PUSHES NOTHING', async () => {
  // Never per poll. Same scoreline, same quarter, only the clock moved - which
  // is exactly the case the Part C ruling refuses to spend a push on.
  const out = await poll(feed('live', 10, 7, 3, '11:40'));
  assert.equal(out.liveActivities.length, 0);
});

test('KICKOFF IS NOT A CARD MOVE EITHER', async () => {
  // A fresh scheduled game flipping live: the alert path sends a kickoff, the
  // card has nothing to say that 0-0 with no clock does not already say.
  const [m2] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, external_ids)
    VALUES (${leagueId}, ${`${NS}-b`}, 'scheduled', ${homeId}, ${awayId}, now(),
            ${JSON.stringify({ bdl_game_id: `${PID}-b` })}::jsonb)
    RETURNING id`;
  await sql`INSERT INTO live_activities (activity_id, push_token, match_id, started_at)
            VALUES (${`${NS}-a2`}, ${TOKEN}, ${m2.id}, now())`;
  const out = await pollOnce(sql, {
    league: 'nfl', providerKey: 'bdl_game_id', push: true, now: new Date(), normalise,
    fetcher: async () => ({ rows: [{ id: `${PID}-b`, status: 'live', homeScore: 0, awayScore: 0, period: 1, clock: '15:00' }], calls: 1 }),
  });
  assert.deepEqual(out.liveActivities.filter((l) => l.matchId === m2.id), []);
  await sql`DELETE FROM live_activities WHERE activity_id = ${`${NS}-a2`}`;
  await sql`DELETE FROM news_items WHERE payload->>'matchId' = ${String(m2.id)}`;
  await sql`DELETE FROM matches WHERE id = ${m2.id}`;
});

test('THE WHISTLE SENDS ONE end, AND THE ROW IS ENDED', async () => {
  const before = await activityRow();
  assert.equal(before.ended_at, null, 'still running before the final');
  const out = await poll(feed('final', 10, 7, null, null));
  assert.equal(out.liveActivities.length, 1, 'one push, not an update chased by an end');
  assert.equal(out.liveActivities[0].event, 'end');
  // DARK, so nothing was delivered and the row therefore stays open - the end
  // stamp follows a SUCCESSFUL send, not the attempt. That is the honest
  // behaviour: a card nobody could be told about is not a card that ended.
  assert.equal(out.liveActivities[0].skipped, 1);
  assert.equal((await activityRow()).ended_at, null);
});

test('a match with no Activities costs the poll nothing', async () => {
  await sql`DELETE FROM live_activities WHERE activity_id = ${ACT}`;
  await sql`UPDATE matches SET status = 'live', home_score = 10, away_score = 7 WHERE id = ${matchId}`;
  const out = await poll(feed('live', 17, 7, 4, '2:00'));
  assert.equal(out.written, 1, 'the score still changed');
  assert.deepEqual(out.liveActivities, [], 'nothing to push to, nothing in the ledger');
});
