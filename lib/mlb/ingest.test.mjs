// lib/mlb/ingest.test.mjs - the BDL MLB payload, against rows captured from
// the real feed on 22 Sep 2026.
//
// THE FIXTURES ARE VERBATIM, not written to suit the parser. LIVE is MIN @ SF
// in the 7th (away 7 inning entries, home 6 - the shape the half derivation
// reads); FINAL is TOR @ BAL complete; SCHEDULED is TB @ NYY before first
// pitch, which is the row that carries runs: 0 with no innings played and is
// the reason scopeToStatus exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromBdlMlb, lineScoreOf, halfFromInnings, liveStateOf, scoringPlaysOf, seasonPhaseOf,
} from './ingest.js';

const LIVE = {
  id: 5060114, season: 2026, postseason: false, season_type: 'regular',
  date: '2026-09-22T01:45:00.000Z',
  home_team_data: { hits: 9, runs: 5, errors: 0, inning_scores: [2, 2, 0, 0, 1, 0] },
  away_team_data: { hits: 3, runs: 1, errors: 0, inning_scores: [0, 0, 0, 1, 0, 0, 0] },
  venue: 'Oracle Park', status: 'STATUS_IN_PROGRESS', status_state: 'in_progress',
  period: 7, clock: 0, display_clock: '0:00',
  scoring_summary: [
    { play: 'B. Harris singled to center, Gilbert scored and Davidson scored.', inning: 'bottom', period: '1st', away_score: 0, home_score: 2 },
    { play: 'Lee homered to right center (387 feet).', inning: 'top', period: '4th', away_score: 1, home_score: 4 },
  ],
};
const FINAL = {
  id: 5060112, season: 2026, postseason: false, season_type: 'regular',
  home_team_data: { hits: 6, runs: 4, errors: 0, inning_scores: [1, 0, 0, 0, 0, 1, 0, 2] },
  away_team_data: { hits: 6, runs: 3, errors: 0, inning_scores: [3, 0, 0, 0, 0, 0, 0, 0, 0] },
  venue: 'Oriole Park at Camden Yards', status: 'STATUS_FINAL', status_state: 'final',
  period: 9, clock: 0, display_clock: '0:00', scoring_summary: [],
};
const SCHEDULED = {
  id: 8160916, season: 2026, postseason: false, season_type: 'regular',
  home_team_data: { hits: 0, runs: 0, errors: 0, inning_scores: [] },
  away_team_data: { hits: 0, runs: 0, errors: 0, inning_scores: [] },
  venue: 'Yankee Stadium', status: 'STATUS_SCHEDULED', status_state: 'scheduled',
  period: 1, clock: 0, display_clock: '0:00', scoring_summary: [],
};
// One /plays row, also verbatim.
const PLAY = {
  game_id: 5060114, order: 394082896, type: 'Fly Out', text: 'Pitch 3 : Ball In Play',
  home_score: 0, away_score: 0, inning: 7, inning_type: 'Top', scoring_play: false,
  score_value: null, outs: 1, balls: 1, strikes: 1, batter_id: 4941211, pitcher_id: 947389,
};

test('RUNS COME FROM home_team_data/away_team_data, not from the NFL field names', () => {
  const u = {};
  const live = fromBdlMlb(LIVE, u);
  assert.equal(live.homeScore, 5);
  assert.equal(live.awayScore, 1);
  assert.equal(live.status, 'live');
  assert.equal(live.providerId, '5060114');
  // The NFL normaliser reads home_team_score / visitor_team_score, which are
  // ABSENT here - a shared function would have returned null for both and put
  // a blank scoreline on a live game.
  assert.equal(LIVE.home_team_score, undefined);
  assert.equal(LIVE.visitor_team_score, undefined);
  assert.deepEqual(u, {}, 'every status token in these fixtures is mapped');
  assert.equal(fromBdlMlb(FINAL, u).status, 'final');
  assert.equal(fromBdlMlb(SCHEDULED, u).status, 'scheduled');
});

test('THE LINE SCORE IS THE INNING ARRAY, with R/H/E beside it', () => {
  const l = lineScoreOf(FINAL);
  assert.deepEqual(l.away.innings, [3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(l.home.innings, [1, 0, 0, 0, 0, 1, 0, 2]);
  assert.deepEqual([l.away.runs, l.away.hits, l.away.errors], [3, 6, 0]);
  assert.deepEqual([l.home.runs, l.home.hits, l.home.errors], [4, 6, 0]);
  // THE HOME SIDE HAS EIGHT ENTRIES AND THE AWAY NINE, and that is not a bug:
  // the home team led after the top of the 9th and did not bat. A renderer
  // must not pad it to nine or it invents a scoreless inning that was never
  // played.
  assert.equal(l.home.innings.length, 8);
  assert.equal(l.away.innings.length, 9);
  assert.equal(lineScoreOf(SCHEDULED).home.innings.length, 0);
  assert.equal(lineScoreOf({}), null);
});

test('THE HALF IS DERIVED FROM THE TWO ARRAYS when only /games has been read', () => {
  // Live: away 7, home 6 -> the away side is batting -> Top of the 7th.
  assert.equal(halfFromInnings(lineScoreOf(LIVE)), 'Top');
  // Equal lengths -> the home side has batted in this inning too -> Bottom.
  assert.equal(halfFromInnings({ away: { innings: [0, 0, 0] }, home: { innings: [0, 0, 0] } }), 'Bottom');
  // Before a pitch is thrown there is no half to name.
  assert.equal(halfFromInnings(lineScoreOf(SCHEDULED)), null);
  assert.equal(halfFromInnings(null), null);
  // A home side somehow AHEAD of the away side is not a half this can name -
  // it is a payload that contradicts itself, and null beats a guess.
  assert.equal(halfFromInnings({ away: { innings: [0] }, home: { innings: [0, 0] } }), null);
});

test('THE PLAY WINS ON THE HALF, and is the only source of outs and the count', () => {
  const withoutPlay = liveStateOf(LIVE);
  assert.deepEqual(withoutPlay, { period: 7, half: 'Top' });
  assert.equal('outs' in withoutPlay, false, 'no play, no outs - not a zero');
  const withPlay = liveStateOf(LIVE, PLAY);
  assert.deepEqual(withPlay, { period: 7, half: 'Top', outs: 1, balls: 1, strikes: 1 });
  // Mid and End are states the array derivation CANNOT see, and the play can.
  assert.equal(liveStateOf(LIVE, { ...PLAY, inning_type: 'Mid' }).half, 'Mid');
  assert.equal(liveStateOf(LIVE, { ...PLAY, inning_type: 'End' }).half, 'End');
  // A zero count is a real count and must survive as 0, not fall to null.
  assert.deepEqual(liveStateOf(LIVE, { ...PLAY, outs: 0, balls: 0, strikes: 0 }),
    { period: 7, half: 'Top', outs: 0, balls: 0, strikes: 0 });
});

test('NO CLOCK REACHES THE LIVE STATE, in any shape', () => {
  // BDL sends clock 0 and display_clock "0:00" on every row. A card that
  // renders a clock would show a stopped one on a live game.
  for (const row of [LIVE, FINAL, SCHEDULED]) {
    const st = liveStateOf(row, PLAY) ?? {};
    assert.equal('clock' in st, false, 'liveState must carry no clock key');
    assert.equal('display_clock' in st, false);
  }
  assert.equal('clock' in (fromBdlMlb(LIVE, {}).liveState ?? {}), false);
});

test('A SCHEDULED ROW CONTRIBUTES NO LIVE STATE, and its runs: 0 is not a score', () => {
  // The same trap CFBD has: 0 is not null, and COALESCE treats it as a value.
  // scopeToStatus is the gate, and this parser does not pretend otherwise -
  // but it also does not hand a scheduled row a live state to be scoped away.
  assert.equal(fromBdlMlb(SCHEDULED, {}).liveState, null);
  assert.equal(fromBdlMlb(FINAL, {}).liveState, null, 'a final has no live state either');
  assert.equal(fromBdlMlb(LIVE, {}).liveState.period, 7);
  // The runs ARE parsed - refusing them is scopeToStatus's job, not this one's,
  // and two places deciding it is how they disagree.
  assert.equal(fromBdlMlb(SCHEDULED, {}).homeScore, 0);
});

test('SCORING PLAYS carry the half, the inning and the score after', () => {
  const s = scoringPlaysOf(LIVE);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], {
    text: 'B. Harris singled to center, Gilbert scored and Davidson scored.',
    half: 'bottom', inning: '1st', homeScore: 2, awayScore: 0,
  });
  assert.equal(s[1].text, 'Lee homered to right center (387 feet).');
  // A row with no text is not a play - it would render as an empty line.
  assert.deepEqual(scoringPlaysOf({ scoring_summary: [{ play: '  ', inning: 'top' }] }), []);
  assert.deepEqual(scoringPlaysOf({}), []);
  assert.deepEqual(scoringPlaysOf(FINAL), []);
});

test('THE PHASE COMES FROM THE FEED, and an unknown one is refused', () => {
  assert.equal(seasonPhaseOf(LIVE), 'REG');
  assert.equal(seasonPhaseOf({ postseason: true, season_type: 'regular' }), 'POST',
    'postseason true wins - it is the more specific claim');
  assert.equal(seasonPhaseOf({ postseason: false, season_type: 'postseason' }), 'POST');
  // SPRING TRAINING AND THE ALL-STAR GAME are both on this calendar and
  // neither is a REG game. null lets the caller refuse the row rather than
  // file an exhibition under the season.
  assert.equal(seasonPhaseOf({ season_type: 'spring' }), null);
  assert.equal(seasonPhaseOf({ season_type: 'allstar' }), null);
  assert.equal(seasonPhaseOf({}), null);
});
