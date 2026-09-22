// lib/mlb/playsImport.test.mjs - /plays and /stats, against rows captured
// verbatim from the real feed on 22 Sep 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeMlbPlay, newestPlay, inningsToOuts, shapeMlbStatLine, DROPPED_SEASON_RATES,
} from './playsImport.js';

const PITCH = {
  game_id: 5060114, order: 394082896, type: 'Fly Out', text: 'Pitch 3 : Ball In Play',
  home_score: 0, away_score: 0, inning: 1, inning_type: 'Top', scoring_play: false,
  score_value: null, outs: 1, balls: 1, strikes: 1, batter_id: 4941211, pitcher_id: 947389,
  pitch_type: 'Sweeper', pitch_velocity: 83, hit_coordinate_x: 205, hit_coordinate_y: 103,
  trajectory: 'F',
};
const SCORING = {
  game_id: 5060114, order: 394088342, type: 'Play Result',
  text: 'B. Harris singled to center, Gilbert scored and Davidson scored.',
  home_score: 2, away_score: 0, inning: 1, inning_type: 'Bottom', scoring_play: true,
  score_value: 2, outs: 2, balls: 3, strikes: 2, batter_id: 525, pitcher_id: 816,
};
const START = {
  game_id: 5060114, order: 394081847, type: 'Start Inning', text: 'Top of the 1st inning',
  home_score: 0, away_score: 0, inning: 1, inning_type: 'Top', scoring_play: false,
  score_value: null, outs: 0, balls: 0, strikes: 0, batter_id: null, pitcher_id: null,
};
// A /stats row for a position player: every p_* is null, which is the shape.
const BATTER = {
  player: { id: 511, first_name: 'Kody', last_name: 'Clemens', full_name: 'Kody Clemens', position: '2B' },
  team: { id: 17, abbreviation: 'MIN' }, game_id: 5060114, team_name: 'Minnesota Twins',
  at_bats: 4, runs: 0, hits: 0, rbi: 0, hr: 0, bb: 0, k: 2,
  avg: 0.236, obp: 0.297, slg: 0.458,
  doubles: 0, triples: 0, intentional_walks: 0, hit_by_pitch: 0, stolen_bases: 0,
  caught_stealing: 0, plate_appearances: 4, total_bases: 0, left_on_base: 0,
  fly_outs: 2, ground_outs: 0, line_outs: 0, pop_outs: 0, air_outs: 2, gidp: 0,
  sac_bunts: 0, sac_flies: 0,
  ip: null, p_hits: null, p_runs: null, er: null, p_bb: null, p_k: null, p_hr: null,
  pitch_count: null, strikes: null, era: null, batters_faced: null, pitching_outs: null,
  wins: null, losses: null, saves: null, holds: null, blown_saves: null,
  games_started: null, wild_pitches: null, balks: null, pitching_hbp: null,
  inherited_runners: null, inherited_runners_scored: null,
  putouts: 1, assists: 2, errors: 0, fielding_chances: 3, fielding_pct: 0,
};
const PITCHER = {
  ...BATTER,
  player: { id: 816, first_name: 'Logan', last_name: 'Webb', full_name: 'Logan Webb', position: 'SP' },
  at_bats: null, runs: null, hits: null, rbi: null, hr: null, bb: null, k: null,
  ip: 6.2, p_hits: 5, p_runs: 1, er: 1, p_bb: 2, p_k: 7, p_hr: 1,
  pitch_count: 98, strikes: 64, era: 3.11, batters_faced: 26, pitching_outs: 20,
  wins: 1, losses: 0, saves: 0, holds: 0, blown_saves: 0, games_started: 1,
};

test('A PLAY MAPS ONTO THE COLUMNS plays ALREADY HAS, plus the six it gains', () => {
  const p = shapeMlbPlay(PITCH);
  // period IS the inning - the column means "which division of the game".
  assert.equal(p.period, 1);
  assert.equal(p.inningType, 'Top');
  assert.equal(p.playType, 'Fly Out');
  assert.equal(p.text, 'Pitch 3 : Ball In Play');
  assert.deepEqual([p.outs, p.balls, p.strikes], [1, 1, 1]);
  assert.equal(p.batterId, '4941211');
  assert.equal(p.pitcherId, '947389');
  assert.equal(p.scoring, false);
  // THE ORDINAL IS THE PROVIDER'S `order`, not an array index: a back-filled
  // play would renumber every row after it, and provider_play_id is what
  // idempotence rides on.
  assert.equal(p.providerPlayId, '394082896');
  assert.equal(p.playNumber, 394082896);
  const s = shapeMlbPlay(SCORING);
  assert.equal(s.scoring, true);
  assert.deepEqual([s.homeScore, s.awayScore], [2, 0]);
  assert.equal(s.inningType, 'Bottom');
});

test('A ZERO COUNT IS A REAL COUNT and survives as 0, never as null', () => {
  // outs 0 / 0-0 is the start of an at-bat. A shaper that nulled them would
  // make "nobody out" indistinguishable from "the provider did not say", and
  // the card would show nothing at the moment it matters most.
  const p = shapeMlbPlay(START);
  assert.deepEqual([p.outs, p.balls, p.strikes], [0, 0, 0]);
  assert.equal(p.batterId, null, 'an inning marker has no batter');
  assert.equal(p.pitcherId, null);
  // A genuinely absent field IS null.
  const bare = shapeMlbPlay({ order: 1, inning: 1 });
  assert.deepEqual([bare.outs, bare.balls, bare.strikes], [null, null, null]);
  // No ordinal, no row - it could not be written idempotently.
  assert.equal(shapeMlbPlay({ inning: 1 }), null);
  assert.equal(shapeMlbPlay({}), null);
});

test('THE NEWEST PLAY IS BY `order`, not by array position', () => {
  assert.equal(newestPlay([START, SCORING, PITCH]).order, SCORING.order);
  assert.equal(newestPlay([SCORING, START]).order, SCORING.order);
  assert.equal(newestPlay([]), null);
  assert.equal(newestPlay([{ inning: 1 }]), null, 'a row with no order cannot be newest');
});

test('INNINGS PITCHED BECOME OUTS, because 6.2 is not six point two', () => {
  // 6.2 is SIX AND TWO THIRDS. It does not add (6.2 + 6.2 is not 12.4 in any
  // sense a box score means), average, or compare as a number. Outs do all three.
  assert.equal(inningsToOuts(6.2), 20);
  assert.equal(inningsToOuts(6.1), 19);
  assert.equal(inningsToOuts(6), 18);
  assert.equal(inningsToOuts(0.1), 1);
  assert.equal(inningsToOuts(0.2), 2);
  assert.equal(inningsToOuts(0), 0, 'a pitcher who recorded no outs is 0, not unknown');
  assert.equal(inningsToOuts(9), 27);
  // A TENTHS DIGIT ABOVE 2 IS NOT AN INNINGS FIGURE. 6.3 would be seven
  // innings written wrong, and guessing which is the error is worse than
  // refusing the value.
  assert.equal(inningsToOuts(6.3), null);
  assert.equal(inningsToOuts(6.5), null);
  assert.equal(inningsToOuts(null), null);
  assert.equal(inningsToOuts(''), null);
  assert.equal(inningsToOuts('x'), null);
  assert.equal(inningsToOuts(-1), null);
});

test('THE SEASON RATES ARE DROPPED, and the counting stats are not', () => {
  const b = shapeMlbStatLine(BATTER);
  // avg/obp/slg/era are SEASON-TO-DATE on a per-game row. Storing them makes
  // an April box score show the numbers the player finished September with.
  for (const k of DROPPED_SEASON_RATES) {
    assert.equal(k in b, false, `${k} is a season rate and must not be on a game row`);
  }
  assert.equal(Object.values(b).includes(0.236), false, 'the season average is nowhere in the shape');
  // The counting stats ARE the game's and are kept.
  assert.equal(b.atBats, 4);
  assert.equal(b.strikeouts, 2);
  assert.equal(b.plateAppearances, 4);
  assert.deepEqual([b.putouts, b.assists, b.errors, b.fieldingChances], [1, 2, 0, 3]);
  assert.equal(b.bdlPlayerId, '511');
  assert.equal(b.playerName, 'Kody Clemens');
  assert.equal(b.position, '2B');
  assert.equal(b.bdlTeamId, '17');
  // A POSITION PLAYER'S PITCHING IS NULL, not zero - he did not pitch.
  assert.equal(b.outsRecorded, null);
  assert.equal(b.earnedRuns, null);
});

test('A PITCHER\'S LINE carries outs and the pitch count, and no era', () => {
  const p = shapeMlbStatLine(PITCHER);
  assert.equal(p.outsRecorded, 20, '6.2 innings');
  assert.equal(p.battersFaced, 26);
  assert.equal(p.pitchesThrown, 98);
  assert.equal(p.pitchStrikes, 64);
  assert.deepEqual([p.hitsAllowed, p.runsAllowed, p.earnedRuns], [5, 1, 1]);
  assert.deepEqual([p.walksAllowed, p.strikeoutsPitched, p.homeRunsAllowed], [2, 7, 1]);
  assert.equal(p.wins, 1);
  assert.equal('era' in p, false);
  // THE FALLBACK: where ip is missing the provider also sends pitching_outs,
  // which is already the number we want.
  const noIp = shapeMlbStatLine({ ...PITCHER, ip: null, pitching_outs: 20 });
  assert.equal(noIp.outsRecorded, 20);
  // And an unusable ip does not silently become the fallback's value either -
  // it falls through to pitching_outs, which is the provider's own answer.
  assert.equal(shapeMlbStatLine({ ...PITCHER, ip: 6.3, pitching_outs: 20 }).outsRecorded, 20);
});

test('A ROW WITH NO PLAYER IS NOT A BOX LINE', () => {
  assert.equal(shapeMlbStatLine({ team: { id: 17 } }), null);
  assert.equal(shapeMlbStatLine({ player: {} }), null);
  assert.equal(shapeMlbStatLine({ player: { id: 1, full_name: '   ' } }), null,
    'a nameless row would print as a blank line in a box score');
  // A name assembled from the halves when full_name is missing.
  assert.equal(shapeMlbStatLine({ player: { id: 9, first_name: 'Cal', last_name: 'Raleigh' } }).playerName,
    'Cal Raleigh');
});
