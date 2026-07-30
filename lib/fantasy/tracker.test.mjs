// lib/fantasy/tracker.test.mjs — pure tracker helpers. NO DATABASE.
// Run: node --test lib/fantasy/tracker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_SIM, MODE_TRACKER, isTracker, cleanLabel, normalizeTeamLabels,
  seatLabel, seatLabelShort, nextUserOverall, picksUntilUserTurn, MAX_LABEL_LEN,
} from './tracker.js';

test('isTracker accepts a mode string or a draft row', () => {
  assert.equal(isTracker(MODE_TRACKER), true);
  assert.equal(isTracker(MODE_SIM), false);
  assert.equal(isTracker({ mode: 'tracker' }), true);
  assert.equal(isTracker({ mode: 'sim' }), false);
  assert.equal(isTracker(null), false);
  assert.equal(isTracker({}), false); // a pre-migration row read as sim, never tracker
});

test('cleanLabel bounds untrusted free text', () => {
  assert.equal(cleanLabel('  Dave  '), 'Dave');
  assert.equal(cleanLabel('Big   Mike'), 'Big Mike');   // collapsed whitespace
  assert.equal(cleanLabel('a'.repeat(50)).length, MAX_LABEL_LEN);
  assert.equal(cleanLabel(''), null);
  assert.equal(cleanLabel('   '), null);
  assert.equal(cleanLabel(null), null);
  assert.equal(cleanLabel(undefined), null);
});

test('normalizeTeamLabels: null is fine, wrong length is an error', () => {
  assert.deepEqual(normalizeTeamLabels(null, 12), { ok: true, labels: null });
  assert.deepEqual(normalizeTeamLabels(undefined, 12), { ok: true, labels: null });

  // A wrong-length array means the client and the config disagree about league
  // size. Padding would put the wrong name on the clock, so it is refused.
  const short = normalizeTeamLabels(['a', 'b'], 12);
  assert.equal(short.ok, false);
  assert.equal(short.reason, 'labels_length');
  assert.match(short.detail, /2 labels for 12 teams/);

  assert.equal(normalizeTeamLabels('Dave', 12).ok, false);
  assert.equal(normalizeTeamLabels('Dave', 12).reason, 'labels_not_array');
});

test('normalizeTeamLabels: all-blank collapses to null, partial is kept', () => {
  assert.deepEqual(normalizeTeamLabels(['', '  ', null], 3), { ok: true, labels: null });
  const partial = normalizeTeamLabels(['Dave', '', 'Sam'], 3);
  assert.deepEqual(partial.labels, ['Dave', null, 'Sam']);
});

test('seatLabel: your own seat always reads You', () => {
  const labels = ['Dave', 'Sam', 'Kim'];
  assert.equal(seatLabel(labels, 0, 1), 'Dave');
  assert.equal(seatLabel(labels, 2, 1), 'Kim');
  // Own seat: the one thing a live drafter must never misread.
  assert.equal(seatLabel(labels, 1, 1), 'You (Sam)');
  assert.equal(seatLabel(['Dave', null, 'Kim'], 1, 1), 'You');
  // Unlabelled draft falls back to Team N (1-based).
  assert.equal(seatLabel(null, 0, 1), 'Team 1');
  assert.equal(seatLabel(null, 6, 1), 'Team 7');
  // No user seat given (a spectator/board render) — no "You" anywhere.
  assert.equal(seatLabel(labels, 1, null), 'Sam');
});

test('seatLabelShort truncates for dense surfaces', () => {
  assert.equal(seatLabelShort(['Dave'], 0, 1), 'Dave');
  assert.equal(seatLabelShort(null, 10, 1), '11');
  assert.equal(seatLabelShort(['x'], 0, 0), 'YOU');
  assert.equal(seatLabelShort(['Bartholomew'], 0, 1, 10), 'Bartholom…');
});

// 4-team snake: R1 0,1,2,3  R2 3,2,1,0  R3 0,1,2,3
const ORDER4 = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3];

test('nextUserOverall finds the next turn under snake order', () => {
  // Seat index 1 picks at overall 2, 7, 10.
  assert.equal(nextUserOverall(ORDER4, 1, 0), 2);
  assert.equal(nextUserOverall(ORDER4, 1, 2), 7);   // from just after pick 2
  assert.equal(nextUserOverall(ORDER4, 1, 7), 10);
  assert.equal(nextUserOverall(ORDER4, 1, 10), null); // no turns left
  // The back-to-back turn at the snake corner: seat 3 picks 4 then 5.
  assert.equal(nextUserOverall(ORDER4, 3, 0), 4);
  assert.equal(nextUserOverall(ORDER4, 3, 4), 5);
});

test('picksUntilUserTurn: 0 when it is your pick right now', () => {
  // currentOverall 2 IS seat 1's pick -> the wait is zero, not "next time".
  assert.equal(picksUntilUserTurn(ORDER4, 1, 2), 0);
  assert.equal(picksUntilUserTurn(ORDER4, 1, 3), 4);  // picks 3,4,5,6 then 7
  assert.equal(picksUntilUserTurn(ORDER4, 3, 5), 0);  // corner: back-to-back
  assert.equal(picksUntilUserTurn(ORDER4, 1, 11), null); // none left
});
