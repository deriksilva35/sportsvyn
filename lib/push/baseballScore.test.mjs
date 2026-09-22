// lib/push/baseballScore.test.mjs - the fold and the label take a sport.
//
// THE TWO DEFECTS THIS CLOSES WERE TRACED, NOT IMAGINED (22 Sep 2026, against
// the shipped code):
//   · a 6-run inning HELD for ninety seconds and then emitted labelled
//     "touchdown", timedOut true;
//   · a 6-run inning followed by a 1-run single FOLDED INTO ONE - seven runs,
//     one notification, called a touchdown, because the run was taken as the
//     touchdown's extra point.
// Neither file took a league or a sport, so there was no seam to switch on.
//
// AND THE FOOTBALL HALF IS PINNED FIRST, because both functions are on the
// live push path for every NFL and CFB game.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onScore, onTick, sportFolds, FOLD_WINDOW_MS } from './scoreFold.js';
import { scoreKindLabel } from './payload.js';

const st = (h, a) => ({ homeScore: h, awayScore: a });

// ------------------------------------------------------- football unchanged

test('FOOTBALL FOLDS EXACTLY AS BEFORE, with the sport omitted or explicit', () => {
  for (const sport of [undefined, 'football']) {
    const opts = sport ? { sport } : {};
    // A bare six holds.
    const six = onScore(null, { delta: 6, state: st(6, 0), now: 0, ...opts });
    assert.ok(six.pending, 'a bare six still holds');
    assert.equal(six.emit.length, 0);
    // The try folds into it.
    const tried = onScore(six.pending, { delta: 1, state: st(7, 0), now: 1000, ...opts });
    assert.equal(tried.emit.length, 1);
    assert.equal(tried.emit[0].kind, 'touchdown');
    assert.equal(tried.emit[0].folded, true);
    // 7 and 8 are already post-try and go at once.
    assert.equal(onScore(null, { delta: 7, state: st(7, 0), ...opts }).emit[0].kind, 'touchdown');
    // A field goal never held and still does not.
    assert.equal(onScore(null, { delta: 3, state: st(3, 0), ...opts }).pending, null);
  }
  assert.equal(sportFolds('football'), true);
  assert.equal(sportFolds(undefined), true, 'the default is football');
  assert.equal(scoreKindLabel(6, { teamAbbr: 'KC' }), 'KC touchdown');
  assert.equal(scoreKindLabel(3, { teamAbbr: 'KC' }), 'KC field goal');
  assert.equal(scoreKindLabel(1, { teamAbbr: 'KC' }), 'KC extra point');
  assert.equal(scoreKindLabel(2, { teamAbbr: 'KC' }), 'KC safety');
  assert.equal(scoreKindLabel(2, { teamAbbr: 'KC', priorWasTouchdown: true }), 'KC two-point');
});

// ----------------------------------------------------------------- baseball

test('BASEBALL NEVER HOLDS A DELTA - not six, not seven, not any of them', () => {
  for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
    const r = onScore(null, { delta: d, state: st(d, 0), sport: 'baseball', now: 0 });
    assert.equal(r.pending, null, `delta ${d} must not open a hold`);
    assert.equal(r.emit.length, 1, `delta ${d} must emit once, immediately`);
    assert.equal(r.emit[0].folded, false);
    assert.equal(r.emit[0].timedOut, false);
    // AND IT IS NEVER LABELLED FROM THE FOOTBALL TABLE.
    assert.equal(r.emit[0].kind, null, `delta ${d} must not be called a touchdown`);
  }
  assert.equal(sportFolds('baseball'), false);
});

test('THE SIX-THEN-ONE FOLD CANNOT HAPPEN IN BASEBALL', () => {
  // The exact trace from 22 Sep, re-run with a sport: a 6-run inning and then
  // a run. Two events happened, so two notifications go out - and neither is
  // a touchdown.
  const six = onScore(null, { delta: 6, state: st(6, 0), sport: 'baseball', now: 0 });
  assert.equal(six.pending, null);
  const run = onScore(six.pending, { delta: 1, state: st(7, 0), sport: 'baseball', now: 20_000 });
  assert.equal(run.emit.length, 1);
  assert.equal(run.emit[0].kind, null);
  assert.equal(run.emit[0].folded, false);
  assert.deepEqual(run.emit[0].state, st(7, 0));
});

test('AN INHERITED HOLD IS FLUSHED, NOT STRANDED', () => {
  // Defensive, and the reason is real: the hold map is keyed by match and side
  // and lives in the poller process. If a sport ever changes under a live hold
  // - a mis-registered league corrected mid-run - the held score must still be
  // announced. A hold is never a drop, in any sport.
  const held = onScore(null, { delta: 6, state: st(6, 0), now: 0 }).pending;
  assert.ok(held);
  const r = onScore(held, { delta: 2, state: st(8, 0), sport: 'baseball', now: 1000 });
  assert.equal(r.pending, null);
  assert.equal(r.emit.length, 2, 'the stranded hold and the new score');
  assert.equal(r.emit[0].timedOut, true);
  assert.deepEqual(r.emit[0].state, st(6, 0), 'the hold emits the score it was holding');
  assert.deepEqual(r.emit[1].state, st(8, 0));
});

test('THE LABEL COUNTS RUNS, and says "homers" only when the play says so', () => {
  assert.equal(scoreKindLabel(1, { sport: 'baseball', teamAbbr: 'NYY' }), 'NYY 1 run');
  assert.equal(scoreKindLabel(2, { sport: 'baseball', teamAbbr: 'NYY' }), 'NYY 2 runs');
  assert.equal(scoreKindLabel(4, { sport: 'baseball', teamAbbr: 'NYY' }), 'NYY 4 runs');
  assert.equal(scoreKindLabel(7, { sport: 'baseball', teamAbbr: 'NYY' }), 'NYY 7 runs');
  // NOT ONE OF THE FOOTBALL WORDS IS REACHABLE.
  for (const d of [1, 2, 3, 6, 7, 8]) {
    const label = scoreKindLabel(d, { sport: 'baseball', teamAbbr: 'NYY' });
    assert.equal(/touchdown|field goal|extra point|safety|two-point/.test(label), false, `delta ${d}: ${label}`);
  }
  // THE PLAY IS THE ONLY WITNESS TO A HOME RUN. A 4-run change is usually a
  // grand slam and sometimes four singles, and the delta cannot tell them
  // apart - so it is not asked to.
  const hr = 'Alonso homered to left (400 feet), Franklin scored.';
  assert.equal(scoreKindLabel(2, { sport: 'baseball', teamAbbr: 'BAL', scoringPlay: hr }), 'BAL homers');
  assert.equal(scoreKindLabel(4, { sport: 'baseball', teamAbbr: 'BAL', scoringPlay: 'Smith hit a home run' }), 'BAL homers');
  const single = 'B. Harris singled to center, Gilbert scored and Davidson scored.';
  assert.equal(scoreKindLabel(2, { sport: 'baseball', teamAbbr: 'SF', scoringPlay: single }), 'SF 2 runs');
  assert.equal(scoreKindLabel(4, { sport: 'baseball', teamAbbr: 'SF', scoringPlay: null }), 'SF 4 runs');
  // No team, no prefix - the same contract the football branch has.
  assert.equal(scoreKindLabel(1, { sport: 'baseball' }), '1 run');
  // A non-positive delta names nothing, in either sport.
  assert.equal(scoreKindLabel(0, { sport: 'baseball', teamAbbr: 'NYY' }), null);
  assert.equal(scoreKindLabel(-2, { sport: 'baseball', teamAbbr: 'NYY' }), null);
});
