// lib/winprob/display.test.mjs - THE PIN on the per-sport display registry
// (relay sat-1). Flipping CFB's tag when the Mac's blind re-score passes is a
// one-line edit to display.js AND a one-line edit here - deliberate, never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAYED, CALIBRATING, PHONE, WINPROB_METHOD_NOTE, winProbDisplayed, winProbCalibrating, winProbOnPhone } from './display.js';
import { winProbForPhone, stateFromMatch, contentState } from '../push/liveActivityState.js';
import { DISPLAYED as LIVE_DISPLAYED } from './live.js';

test('DISPLAYED: NFL and CFB (sat-1)', () => {
  assert.deepEqual(DISPLAYED, { nfl: true, cfb: true });
  assert.equal(LIVE_DISPLAYED, DISPLAYED, 'the poller reads the same object');
});

test('CALIBRATING: CFB only - NFL\'s tag is gone (sat-1)', () => {
  assert.deepEqual(CALIBRATING, { nfl: false, cfb: true });
  assert.equal(winProbCalibrating('nfl'), false);
  assert.equal(winProbCalibrating('cfb'), true);
  assert.equal(winProbCalibrating('mlb'), false);
  assert.equal(winProbDisplayed('mlb'), false);
  assert.ok(Object.isFrozen(DISPLAYED) && Object.isFrozen(CALIBRATING));
});

test('the method note, exactly', () => {
  assert.equal(WINPROB_METHOD_NOTE, 'Sportsvyn model · market prior + game state');
});

// THE PHONE (sun-23): NFL on, CFB off until its sealed re-score passes. One map
// feeds both phone surfaces - the Live Activity here, and the widget feed
// (lib/widget, which imports winProbForPhone). Flipping CFB is `cfb: true` in
// display.js AND here.
test('PHONE: NFL on, CFB off, everything else off', () => {
  assert.deepEqual(PHONE, { nfl: true, cfb: false });
  assert.ok(Object.isFrozen(PHONE));
  assert.equal(winProbOnPhone('nfl'), true);
  assert.equal(winProbOnPhone('cfb'), false);
  assert.equal(winProbOnPhone('mlb'), false);
  assert.equal(winProbForPhone('nfl'), true);
  assert.equal(winProbForPhone('NFL'), true);
  assert.equal(winProbForPhone('cfb'), false);
  assert.equal(winProbForPhone(undefined), false);
  assert.equal(winProbForPhone({ WINPROB_PHONE: 'on' }), false, 'the old env-object call shape is off, not an error');
});

test('PHONE: the Live Activity state follows the map, per league', () => {
  const ls = { period: 3, clock: '7:22', win_prob: 64, win_prob_at: new Date().toISOString() };
  const g = (leagueSlug) => ({ leagueSlug, liveState: ls, homeScore: 10, awayScore: 3, away: { abbreviation: 'A' }, home: { abbreviation: 'H' } });
  assert.equal(stateFromMatch(g('nfl')).winProb, 64);
  assert.equal('winProb' in stateFromMatch(g('cfb')), false);
  assert.equal('winProb' in stateFromMatch(g('nba')), false);
  // contentState checks the shape only; the league gate is stateFromMatch's.
  assert.equal(contentState({ winProb: 101 }).winProb, undefined);
});
