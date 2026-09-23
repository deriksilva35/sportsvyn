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

// --- THE RUN WORDS ON THE LOCK SCREEN --------------------------------------

test('a baseball score push says where it is in baseball\'s words', async () => {
  const { pushPayload, halfShort } = await import('./payload.js');
  const base = {
    leagueSlug: 'mlb', slug: 'mlb-2026-09-22-mil-phi',
    awayAbbr: 'MIL', homeAbbr: 'PHI', awayScore: 3, homeScore: 3,
    period: 8, half: 'Bottom', clock: null,
  };
  // THE SHAPE B1 ITEM 5 ASKED FOR: score, the run word, the half-inning.
  const p = pushPayload('score', { ...base, scoreKind: 'PHI homers', credit: 'Marsh' });
  assert.equal(p.title, 'MIL 3, PHI 3 · PHI homers');
  assert.equal(p.body, 'Marsh · Bot 8th');
  assert.equal(p.url, '/mlb/game/mlb-2026-09-22-mil-phi');

  // NO QUARTER AND NO CLOCK EVER REACH IT. Every football branch is a sentence
  // this sport cannot say; before this a baseball push in the 8th said nothing
  // about where it was, because the clock it keyed on is always null.
  assert.doesNotMatch(p.body, /Q\d|\d:\d\d/);

  // THE OTHER FOUR EVENTS, in the same words.
  assert.equal(pushPayload('final', base).body, 'Final');
  assert.equal(pushPayload('close', base).body, 'Within one run, 8th or later');
  assert.doesNotMatch(pushPayload('close', base).body, /five minutes/);
  assert.equal(pushPayload('quarter', base).body, 'End of the 8th');
  assert.equal(pushPayload('kickoff', base).title, 'MIL 3, PHI 3 · Kickoff');

  // AND THE HALF IS THE HALF. Top and Bottom are sides; Mid and End are between
  // them and must not pick one.
  assert.equal(halfShort('Top', 7), 'Top 7th');
  assert.equal(halfShort('Bottom', 8), 'Bot 8th');
  assert.equal(halfShort('Mid', 3), 'Mid 3rd');
  assert.equal(halfShort('End', 11), 'End 11th');
  assert.equal(halfShort(null, 9), '9th', 'the inning alone, never an invented half');
  assert.equal(halfShort('Top', null), null);
});

test('FOOTBALL\'S BODY IS UNTOUCHED by baseball\'s branch', async () => {
  const { pushPayload } = await import('./payload.js');
  const nfl = {
    leagueSlug: 'nfl', slug: 'nfl-2026-09-20-sf-kc',
    awayAbbr: 'SF', homeAbbr: 'KC', awayScore: 14, homeScore: 21,
    period: 4, clock: '1:39',
  };
  assert.equal(pushPayload('score', { ...nfl, scoreKind: 'KC touchdown', credit: 'P.Mahomes to R.Rice' }).body,
    'P.Mahomes to R.Rice · Q4 1:39');
  assert.equal(pushPayload('close', nfl).body, 'One score, under five minutes');
  // A football quarter event WITH a clock still prints the clock - the
  // `period && clock` branch precedes the quarter one and always has. Asserted
  // as it is, not as it reads: baseball's "End of the 8th" is reachable only
  // because that sport never has a clock to print instead.
  assert.equal(pushPayload('quarter', nfl).body, 'Q4 1:39');
  assert.equal(pushPayload('quarter', { ...nfl, clock: null }).body, 'End of Q4');
  // A half on a football row is ignored rather than printed.
  assert.equal(pushPayload('score', { ...nfl, half: 'Bottom', scoreKind: 'KC touchdown' }).body, 'Q4 1:39');
});

test('the half reaches the payload from the row the poller read', async () => {
  const { transitionsFor } = await import('./transitions.js');
  // TWO APART BEFORE, TIED AFTER - the game ENTERS the window on this poll. A
  // before of 2-3 is ALREADY within one run, so close would not fire and the
  // assertion below would be testing nothing.
  const before = { status: 'live', home_score: 1, away_score: 3, league_slug: 'mlb',
    live_state: { period: 8, half: 'Bottom' } };
  const after = { status: 'live', home_score: 3, away_score: 3, league_slug: 'mlb',
    live_state: { period: 8, half: 'Bottom' } };
  const evs = transitionsFor(before, after);
  const score = evs.find((e) => e.event === 'score');
  assert.ok(score, 'the run is a score event');
  assert.equal(score.state.half, 'Bottom', 'without this the body can only say the inning number');
  assert.equal(score.state.period, 8);
  // AND THE CLOSE RULE FIRES ON BASEBALL'S SENTENCE: it was two apart in the
  // 8th and is now tied, so the game ENTERS the window on this poll.
  assert.ok(evs.some((e) => e.event === 'close'), 'within one run, 8th or later');
});
