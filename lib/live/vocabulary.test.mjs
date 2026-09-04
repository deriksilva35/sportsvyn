// lib/live/vocabulary.test.mjs — mapLiveStatus, liveState, and shortOf, the
// one derivation every live_state reader now shares.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLiveStatus, liveState, shortOf, BDL_STATE, CFBD_SCOREBOARD } from './vocabulary.js';

test('mapLiveStatus maps known tokens and records the rest, per provider', () => {
  assert.equal(mapLiveStatus('bdl', 'in_progress'), 'live');
  assert.equal(mapLiveStatus('cfbd', 'completed'), 'final');
  const unmapped = [];
  assert.equal(mapLiveStatus('bdl', 'weird-token', unmapped), null);
  assert.deepEqual(unmapped, ['weird-token']);
  assert.equal(mapLiveStatus('unknown-provider', 'live', unmapped), null);
});

test('mapLiveStatus writes nothing on an empty or missing token', () => {
  const unmapped = [];
  assert.equal(mapLiveStatus('bdl', null, unmapped), null);
  assert.equal(mapLiveStatus('bdl', '', unmapped), null);
  assert.deepEqual(unmapped, ['(empty)', '(empty)']);
});

test('liveState requires BOTH a real period and a real clock, or nothing', () => {
  assert.deepEqual(liveState(1, '05:49'), { period: 1, clock: '05:49' });
  assert.equal(liveState(null, '05:49'), null, 'no period, no state');
  assert.equal(liveState(0, '05:49'), null, 'period must be >= 1');
  assert.equal(liveState(1, null), null, 'no clock - a partial fact is not claimed');
  assert.equal(liveState(1, ''), null, 'an empty clock is not a clock');
});

// ---------------------------------------------------------------------------
// shortOf — the one derivation. THE AUTHORITATIVE WRITER
// (services/live-poller/poll.mjs, via liveState() above) has never produced
// a .short key; the OLDER writer (apiSportsImport.js) always did and some
// stored rows still carry it. shortOf must read both.
// ---------------------------------------------------------------------------
test('shortOf derives Q1..Q4/OT from a {period, clock} row', () => {
  assert.equal(shortOf({ period: 1, clock: '12:00' }), 'Q1');
  assert.equal(shortOf({ period: 4, clock: '12:00' }), 'Q4');
  assert.equal(shortOf({ period: 5, clock: '12:00' }), 'OT');
  assert.equal(shortOf({ period: 8, clock: '12:00' }), 'OT', 'any period past 4 is OT, not a guess at which one');
});

test('shortOf honors an existing .short verbatim - the older shape', () => {
  assert.equal(shortOf({ short: 'Q3', clock: '9:12' }), 'Q3');
  assert.equal(shortOf({ short: 'xx9', clock: '1:00' }), 'XX9', 'uppercased but not otherwise altered');
});

test('shortOf derives HALFTIME only for period 2 with a zeroed clock', () => {
  assert.equal(shortOf({ period: 2, clock: '00:00' }), 'HT');
  assert.equal(shortOf({ period: 2, clock: '0:00' }), 'HT', 'the unpadded form too');
  assert.equal(shortOf({ period: 2, clock: '00:01' }), 'Q2', 'one second running is still Q2');
  assert.equal(shortOf({ period: 4, clock: '00:00' }), 'Q4', 'end of regulation is not halftime');
});

test('shortOf returns null on null, or a row with neither a short nor a valid period', () => {
  assert.equal(shortOf(null), null);
  assert.equal(shortOf({ clock: '12:00' }), null, 'no short, no period - nothing to derive from');
  assert.equal(shortOf({ period: 0, clock: '12:00' }), null, 'period must be >= 1');
});

test('BDL_STATE and CFBD_SCOREBOARD are small and fully observed, not guessed', () => {
  assert.equal(BDL_STATE.in_progress, 'live');
  assert.equal(CFBD_SCOREBOARD.in_progress, 'live');
  assert.equal(BDL_STATE.canceled, 'cancelled');
  assert.equal(CFBD_SCOREBOARD.canceled, 'cancelled');
});
