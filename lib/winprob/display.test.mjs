// lib/winprob/display.test.mjs - THE PIN on the per-sport display registry
// (relay sat-1). Flipping CFB's tag when the Mac's blind re-score passes is a
// one-line edit to display.js AND a one-line edit here - deliberate, never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAYED, CALIBRATING, WINPROB_METHOD_NOTE, winProbDisplayed, winProbCalibrating } from './display.js';
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
