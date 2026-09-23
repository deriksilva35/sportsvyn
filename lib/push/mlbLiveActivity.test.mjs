// lib/push/mlbLiveActivity.test.mjs - what an MLB card actually receives.
//
// IT WALKS THE RIDER'S OWN COMPOSITION - laLineFor -> stateFromMatch ->
// pushLiveActivities - against a REAL DEV ROW, because that is the only way to
// see the PAYLOAD. A test around pollOnce sees push counts and never the ten
// keys, and the ten keys are the contract: native decodes a fixed shape, and a
// missing `clock` is a decode failure rather than an empty field.
//
// A SENTINEL MATCH AND A SENTINEL ACTIVITY, created here and deleted here, with
// the sender INJECTED so nothing leaves this process.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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
// ENABLED BUT INJECTED: pushLiveActivities skips everything when the config is
// dark, and a skipped push builds no payload. The transport is the stub below.
process.env.PUSH_ENABLED = '1';
process.env.APNS_KEY_ID = 'TESTKEYID';
process.env.APNS_TEAM_ID = 'TESTTEAM';
process.env.APNS_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

const { sql } = await import('../db.js');
const { laLineFor } = await import('../../services/live-poller/poll.mjs');
const { stateFromMatch } = await import('./liveActivityState.js');
const { pushLiveActivities } = await import('./liveActivityStore.js');
const { situationLine } = await import('../mlb/strip.js');

const NS = `sentinel-mlb-la-${Date.now()}`;
const ACT = `${NS}-a1`;
const TOKEN = 'e'.repeat(160);
let matchId; let homeId; let awayId; let homeAbbr; let awayAbbr;

// The mock's own game: Rays at Yankees, top 7th, 2 out, 3-2, 1st and 3rd.
const LIVE_STATE = {
  period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2,
  bases: { first: true, second: false, third: true },
  batter: 'J. Caminero', pitcher: 'L. Weaver',
};
const SCORING = [{ text: 'Judge homered to left (412 feet), Soto scored.', inning: '4th', half: 'bottom', homeScore: 2, awayScore: 0 }];

/** The candidate-row shape the rider holds. */
const rowFor = () => ({
  id: matchId, slug: NS, league_slug: 'mlb',
  home_team_id: homeId, away_team_id: awayId,
  home_abbr: homeAbbr, away_abbr: awayAbbr,
  home_short_name: 'Yankees', away_short_name: 'Rays',
  home_name: 'New York Yankees', away_name: 'Tampa Bay Rays',
  kickoff_at: new Date('2026-09-22T17:05:00Z'),
  scoring_plays: SCORING,
});

/** The rider's own three steps, in order, with the transport captured. */
async function cardFor({ liveState = LIVE_STATE } = {}) {
  const m = rowFor();
  const line = await laLineFor(sql, m);
  const state = stateFromMatch({
    away: { abbreviation: m.away_abbr, short_name: m.away_short_name, name: m.away_name },
    home: { abbreviation: m.home_abbr, short_name: m.home_short_name, name: m.home_name },
    awayScore: 3, homeScore: 2, liveState, kickoffAt: m.kickoff_at, leagueSlug: 'mlb',
    scoringPlays: SCORING,
  }, line);
  const sent = [];
  const out = await pushLiveActivities(sql, {
    matchId, state, event: 'update',
    // THE REAL SIGNATURE IS POSITIONAL - send(cfg, pushToken, payload) - and
    // success is `ok`, not a status. A stub that guessed either reported zero
    // sends and no payload, which is how this test first "passed" nothing.
    send: async (_cfg, token, payload) => { sent.push({ token, payload }); return { ok: true, status: 200 }; },
  });
  return { out, sent, state, line };
}

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'mlb'`;
  // PICKED BY NAME, NOT BY SORT ORDER. An ORDER BY here made the Yankees the
  // AWAY side, which inverted `possession` - the card was right and the fixture
  // was backwards, which is the wrong way round to discover a bug.
  const teams = await sql`
    SELECT id, abbreviation FROM teams WHERE league_id = ${lg.id}
       AND abbreviation IN ('NYY', 'TB')`;
  const byAbbr = new Map(teams.map((t) => [t.abbreviation, t]));
  assert.ok(byAbbr.get('NYY') && byAbbr.get('TB'), 'both sentinel clubs exist on DEV');
  homeId = byAbbr.get('NYY').id; homeAbbr = 'NYY';
  awayId = byAbbr.get('TB').id; awayAbbr = 'TB';
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at,
                         home_score, away_score, season_year, metadata)
    VALUES (${lg.id}, ${NS}, 'live', ${homeId}, ${awayId}, now(), 2, 3, 2099,
            ${JSON.stringify({ live_state: LIVE_STATE, scoring_plays: SCORING })}::jsonb)
    RETURNING id`;
  matchId = m.id;
  await sql`
    INSERT INTO live_activities (activity_id, push_token, user_id, match_id, started_at)
    VALUES (${ACT}, ${TOKEN}, NULL, ${matchId}, now())`;
  // AN AT-BAT RESULT, THEN THREE PITCHES - the shape the rule exists for. The
  // newest ROW is a pitch and the card must name the double.
  const plays = [
    [1, 'Start Batter/Pitcher', null, null, null, false],
    [2, 'Double', 'Sinker', 90, 'Pitch 1 : Ball In Play', false],
    [3, 'Play Result', null, null, 'Diaz doubled to left.', false],
    [4, 'End Batter/Pitcher', null, null, null, false],
    [5, 'Start Batter/Pitcher', null, null, null, false],
    [6, 'Ball', 'Slider', 84, 'Pitch 1 : Ball 1', false],
    [7, 'Foul Ball', 'Cutter', 93, 'Pitch 2 : Strike 1 Foul', false],
    [8, 'Ball', 'Curve', 79, 'Pitch 3 : Ball 2', false],
  ];
  for (const [n, type, pt, pv, text, scoring] of plays) {
    await sql`
      INSERT INTO plays (match_id, provider_play_id, play_number, period, inning_type,
                         play_type, text, home_score, away_score, scoring,
                         pitch_type, pitch_velocity, created_at, updated_at)
      VALUES (${matchId}, ${`${NS}-${n}`}, ${n}, 7, 'Top', ${type}, ${text}, 2, 3, ${scoring},
              ${pt}, ${pv}, now(), now())`;
  }
});

after(async () => {
  await sql`DELETE FROM plays WHERE match_id = ${matchId}`;
  await sql`DELETE FROM live_activities WHERE activity_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM matches WHERE slug LIKE ${`${NS}%`}`;
  await sql`DELETE FROM matches WHERE slug LIKE 'sentinel-mlb-la-%'
              AND season_year = 2099 AND kickoff_at < now() - interval '1 hour'`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM live_activities WHERE activity_id LIKE ${`${NS}%`}) AS acts,
           (SELECT count(*)::int FROM matches WHERE slug LIKE ${`${NS}%`}) AS matches,
           (SELECT count(*)::int FROM plays WHERE provider_play_id LIKE ${`${NS}%`}) AS plays`;
  assert.equal(left.acts, 0, 'sentinel activities left behind');
  assert.equal(left.matches, 0, 'sentinel matches left behind');
  assert.equal(left.plays, 0, 'sentinel plays left behind');
});

test('A LIVE MLB ROW PRODUCES ALL TEN KEYS, clock "" AND PRESENT', async () => {
  const { out, sent } = await cardFor();
  assert.equal(out.activities, 1, 'found the sentinel Activity');
  assert.equal(out.sent, 1, 'and the injected transport took it');
  assert.equal(sent.length, 1);

  const cs = sent[0].payload?.aps?.['content-state'];
  assert.ok(cs, 'there is a content-state at all');
  // TEN KEYS, EXACTLY - native decodes a fixed shape.
  assert.deepEqual(Object.keys(cs).sort(), [
    'awayAbbr', 'awayScore', 'clock', 'homeAbbr', 'homeScore',
    'kickoffAt', 'lastPlay', 'period', 'possession', 'situation',
  ]);

  // THE CLOCK IS SENT AS "", NEVER OMITTED. Baseball has no clock, and the
  // native contract requires the KEY - an absent one is a decode failure, not
  // an empty field. JSON.stringify keeps an empty string and drops nothing.
  assert.equal(cs.clock, '');
  assert.ok(Object.prototype.hasOwnProperty.call(cs, 'clock'), 'the key itself is present');
  assert.match(JSON.stringify(sent[0].payload), /"clock":""/);

  // THE BASEBALL BRANCH, not the football one: the period is the half-inning and
  // possession is the side BATTING.
  assert.equal(cs.period, 'Top 7th');
  assert.equal(cs.possession, 'TB', 'the Rays are batting in the top');
  assert.equal(cs.awayAbbr, 'TB');
  assert.equal(cs.homeAbbr, 'NYY');
  assert.equal(cs.awayScore, 3);
  assert.equal(cs.homeScore, 2);

  // THE SITUATION IS baseballLine's, which is situationLine WITHOUT its leading
  // half - `period` already carries that, and saying it twice spends the only
  // line the widget has.
  assert.equal(cs.situation, '2 out · 3-2 · runners 1st, 3rd');
  assert.equal(situationLine(LIVE_STATE), 'Top 7th · 2 out · 3-2 · runners 1st, 3rd');
  assert.doesNotMatch(cs.situation, /7th/);

  // AND THE LAST PLAY IS A COMPLETED AT-BAT. The newest row in the table is a
  // pitch ("Pitch 3 : Ball 2") and three pitches have been thrown since.
  assert.equal(cs.lastPlay, 'Diaz doubled to left.');
  assert.doesNotMatch(cs.lastPlay, /^Pitch \d/);
  // NOT THE FOOTBALL READER'S ANSWER EITHER: liveLine() would have produced a
  // down and a spot from these same rows and left possession empty.
  assert.doesNotMatch(cs.situation, /&|1st &|yd|Q\d/);
});

test('BASES EMPTY IS A STATEMENT AND IS SENT; Mid/End omits the situation', async () => {
  const empty = await cardFor({
    liveState: { ...LIVE_STATE, bases: { first: false, second: false, third: false } },
  });
  assert.equal(empty.sent[0].payload.aps['content-state'].situation, '2 out · 3-2 · bases empty');

  // NOBODY IS BATTING BETWEEN HALVES, so the outs, the count and the diamond all
  // belong to the half that just ended - situationLine drops them, which leaves
  // baseballLine nothing after the half it strips. The KEY is still sent.
  const mid = await cardFor({ liveState: { period: 4, half: 'Mid' } });
  const cs = mid.sent[0].payload.aps['content-state'];
  assert.equal(cs.situation, '');
  assert.ok(Object.prototype.hasOwnProperty.call(cs, 'situation'));
  assert.equal(cs.period, 'Mid 4th');
  assert.equal(cs.clock, '');
  assert.equal(cs.possession, '', 'nobody is at the plate');
  // The last play survives a between-halves state: it is the last thing that
  // HAPPENED, not a fact about who is batting now.
  assert.equal(cs.lastPlay, 'Diaz doubled to left.');
});

test('THE LINE THE RIDER BUILDS OVERRIDES ONLY lastPlay', async () => {
  const { line } = await cardFor();
  // laLineFor returns the one field it can know from the plays table; passing
  // possession or situation from there would replace what only live_state knows.
  assert.deepEqual(Object.keys(line), ['lastPlay']);
});
