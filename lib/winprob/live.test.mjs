// lib/winprob/live.test.mjs - the pure parts of the live path: the feed's
// clock into the model's, the snap into a state, a stored spread into points,
// and the card's fresh / stale / gone rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../testing/nextResolve.mjs';

install();
const { timeState, clockSecs, modelState, spreadPoints, DISPLAYED } = await import('./live.js');
const { liveWinProbView, STALE_SEC, DEAD_SEC } = await import('../../components/gridiron/LiveWinProb.js');

test('the clock: regulation seconds left, seconds left in the half, overtime', () => {
  assert.equal(clockSecs('8:41'), 521); assert.equal(clockSecs('15:00'), 900); assert.equal(clockSecs('x'), null);
  assert.deepEqual(timeState(1, '15:00'), { secs_game: 3600, secs_half: 1800, is_ot: 0 });
  assert.deepEqual(timeState(2, '0:30'), { secs_game: 1830, secs_half: 30, is_ot: 0 });
  assert.deepEqual(timeState(3, '8:41'), { secs_game: 1421, secs_half: 1421, is_ot: 0 });
  assert.deepEqual(timeState(4, '2:00'), { secs_game: 120, secs_half: 120, is_ot: 0 });
  assert.deepEqual(timeState(5, '7:12'), { secs_game: 0, secs_half: 432, is_ot: 1 });
  assert.equal(timeState(null, '8:41'), null); assert.equal(timeState(3, null), null);
});

test('the state: a snap with a down, the live score, whose ball - or null, never a guessed input', () => {
  const play = { down: 3, distance: 4, yards_to_goal: 22, offense_team_id: 9 };
  const s = modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play, homeTeamId: 9, season: 2026 });
  assert.deepEqual(s, { score_diff: -4, secs_game: 70, secs_half: 70, is_ot: 0, posteam_is_home: 1, down_f: 3, ydstogo_f: 4, yards_to_goal: 22, season: 2026 });
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play, homeTeamId: 8 }).posteam_is_home, 0);
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play: { ...play, down: null }, homeTeamId: 9 }), null, 'a kickoff has no down');
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: null, awayScore: 24, play, homeTeamId: 9 }), null);
  assert.equal(modelState({ period: 4, clock: '1:10', homeScore: 20, awayScore: 24, play: null, homeTeamId: 9 }), null);
});

test('a stored spread into points: signs, pick\'em, and nothing that is not one', () => {
  assert.equal(spreadPoints('-3.5'), -3.5); assert.equal(spreadPoints('+2'), 2); assert.equal(spreadPoints('PK'), 0);
  assert.equal(spreadPoints(''), null); assert.equal(spreadPoints(null), null); assert.equal(spreadPoints('off'), null);
});

test('only NFL is displayed; CFB is shadow', () => {
  assert.deepEqual(DISPLAYED, { nfl: true, cfb: false });
});

test('the card: fresh, stale past 90 s, gone past 5 minutes, and nothing without a real number', () => {
  const now = new Date('2026-09-27T18:00:00Z');
  const at = (sec) => new Date(now.getTime() - sec * 1000).toISOString();
  assert.equal(STALE_SEC, 90); assert.equal(DEAD_SEC, 300);
  assert.deepEqual(liveWinProbView({ win_prob: 64, win_prob_at: at(10) }, now), { home: 64, away: 36, stale: false });
  assert.deepEqual(liveWinProbView({ win_prob: 64, win_prob_at: at(91) }, now), { home: 64, away: 36, stale: true });
  assert.equal(liveWinProbView({ win_prob: 64, win_prob_at: at(301) }, now), null);
  assert.equal(liveWinProbView({ win_prob: 64 }, now), null, 'no stamp, no card');
  assert.equal(liveWinProbView({ win_prob: null, win_prob_at: at(1) }, now), null);
  assert.equal(liveWinProbView({ win_prob: 150, win_prob_at: at(1) }, now), null);
  assert.equal(liveWinProbView(null, now), null);
});
