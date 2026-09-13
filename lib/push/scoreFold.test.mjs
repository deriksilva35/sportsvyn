// lib/push/scoreFold.test.mjs - one touchdown, one notification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onScore, onTick, flush, FOLD_WINDOW_MS } from './scoreFold.js';

const state = (home, away, extra = {}) => ({ homeScore: home, awayScore: away, period: 2, clock: '7:14', ...extra });
const TD_RESOLVED = { kind: 'touchdown', scorer: 'D.Henry', tryResolved: true, tryKind: 'kick-good', tryPoints: 1, homeScore: 21, awayScore: 14 };
const TD_BARE = { kind: 'touchdown', scorer: 'D.Henry', tryResolved: false, tryKind: null, tryPoints: null, homeScore: 20, awayScore: 14 };
const FG = { kind: 'field goal', scorer: 'J.Slye', tryResolved: false, tryKind: null, tryPoints: null, homeScore: 17, awayScore: 14 };

// ---------------------------------------------------------------------------
// THE FAST PATH: the play resolved the try, so nothing waits
// ---------------------------------------------------------------------------
test('a touchdown whose play names its extra point sends ONCE, immediately', () => {
  const r = onScore(null, { delta: 6, state: state(20, 14), play: TD_RESOLVED, now: 0 });
  assert.equal(r.pending, null, 'nothing is held');
  assert.equal(r.emit.length, 1);
  assert.equal(r.emit[0].kind, 'touchdown');
  assert.equal(r.emit[0].scorer, 'D.Henry');
  assert.equal(r.emit[0].folded, true);
});

test("and it prints the play's POST-TRY score, not the board's six", () => {
  // This is also what makes the dedupe work: eventKey is score:<match>:21:14,
  // so the extra point's own delta a tick later claims the same key and is
  // skipped by the INSERT ... ON CONFLICT DO NOTHING that already ran.
  const r = onScore(null, { delta: 6, state: state(20, 14), play: TD_RESOLVED, now: 0 });
  assert.equal(r.emit[0].state.homeScore, 21, 'the seventh point is already in the title');
  assert.equal(r.emit[0].state.awayScore, 14);
  assert.equal(r.emit[0].state.clock, '7:14', 'and the rest of the state is untouched');
});

test('a MISSED extra point in the play text is also resolved - nothing is coming', () => {
  const missed = { ...TD_RESOLVED, tryKind: 'kick-missed', tryPoints: 0, homeScore: 20 };
  const r = onScore(null, { delta: 6, state: state(20, 14), play: missed, now: 0 });
  assert.equal(r.pending, null, 'a missed try must not hold for ninety seconds');
  assert.equal(r.emit[0].state.homeScore, 20);
});

// ---------------------------------------------------------------------------
// THE WINDOW: a bare six with no play to read
// ---------------------------------------------------------------------------
test('a bare six with NO play row HOLDS, and emits nothing yet', () => {
  const r = onScore(null, { delta: 6, state: state(20, 14), play: null, now: 1000 });
  assert.equal(r.emit.length, 0);
  assert.ok(r.pending);
  assert.equal(r.pending.at, 1000);
});

test('a bare six whose play has not resolved the try also holds', () => {
  const r = onScore(null, { delta: 6, state: state(20, 14), play: TD_BARE, now: 0 });
  assert.equal(r.emit.length, 0);
  assert.equal(r.pending.play.scorer, 'D.Henry', 'the scorer is kept for when it does go');
});

test('THE TRY FOLDS IN: the next delta on that team emits ONE push, post-try', () => {
  const held = onScore(null, { delta: 6, state: state(20, 14), play: TD_BARE, now: 0 }).pending;
  const r = onScore(held, { delta: 1, state: state(21, 14), play: null, now: 20_000 });
  assert.equal(r.pending, null);
  assert.equal(r.emit.length, 1, 'one notification for one play');
  assert.equal(r.emit[0].state.homeScore, 21);
  assert.equal(r.emit[0].kind, 'touchdown');
  assert.equal(r.emit[0].scorer, 'D.Henry', "the held play's scorer survives the fold");
  assert.equal(r.emit[0].folded, true);
});

test('A TWO-POINT TRY FOLDS THE SAME WAY', () => {
  const held = onScore(null, { delta: 6, state: state(20, 14), play: TD_BARE, now: 0 }).pending;
  const r = onScore(held, { delta: 2, state: state(22, 14), play: null, now: 5_000 });
  assert.equal(r.emit.length, 1);
  assert.equal(r.emit[0].state.homeScore, 22);
  assert.equal(r.emit[0].kind, 'touchdown', 'not "two-point" - the play was the touchdown');
});

test('THE TIMEOUT: a hold older than the window goes out alone, as a six', () => {
  const held = onScore(null, { delta: 6, state: state(20, 14), play: TD_BARE, now: 0 }).pending;
  assert.deepEqual(onTick(held, { now: FOLD_WINDOW_MS - 1 }).emit, [], 'not yet');
  const r = onTick(held, { now: FOLD_WINDOW_MS });
  assert.equal(r.pending, null);
  assert.equal(r.emit.length, 1);
  assert.equal(r.emit[0].timedOut, true);
  assert.equal(r.emit[0].folded, false);
  assert.equal(r.emit[0].state.homeScore, 20, 'six is the right number for a missed extra point');
  assert.equal(r.emit[0].kind, 'touchdown');
  assert.equal(r.emit[0].scorer, 'D.Henry');
});

test('the window is ninety seconds', () => {
  assert.equal(FOLD_WINDOW_MS, 90_000);
});

test('onTick on nothing is nothing', () => {
  assert.deepEqual(onTick(null, { now: 1 }), { pending: null, emit: [] });
});

// ---------------------------------------------------------------------------
// EVERYTHING ELSE GOES IMMEDIATELY
// ---------------------------------------------------------------------------
test('a field goal does not wait', () => {
  const r = onScore(null, { delta: 3, state: state(17, 14), play: FG, now: 0 });
  assert.equal(r.pending, null);
  assert.equal(r.emit[0].kind, 'field goal');
  assert.equal(r.emit[0].scorer, 'J.Slye');
});

test('a safety does not wait, and names nobody', () => {
  const play = { kind: 'safety', scorer: null, tryResolved: false, homeScore: 16, awayScore: 14 };
  const r = onScore(null, { delta: 2, state: state(16, 14), play, now: 0 });
  assert.equal(r.pending, null);
  assert.equal(r.emit[0].kind, 'safety');
  assert.equal(r.emit[0].scorer, null);
});

test('a delta of 7 or 8 is the board folding the try itself - it does not wait', () => {
  for (const d of [7, 8]) {
    const r = onScore(null, { delta: d, state: state(21, 14), play: null, now: 0 });
    assert.equal(r.pending, null, `${d} must not hold`);
    assert.equal(r.emit.length, 1);
    assert.equal(r.emit[0].kind, 'touchdown');
    assert.equal(r.emit[0].folded, true);
  }
});

test('a score with no play row at all still emits, with no kind and no scorer', () => {
  const r = onScore(null, { delta: 3, state: state(17, 14), play: null, now: 0 });
  assert.equal(r.emit.length, 1, 'the join is the enrichment, never the dependency');
  assert.equal(r.emit[0].kind, null, 'the caller falls back to its delta-derived word');
  assert.equal(r.emit[0].scorer, null);
});

// ---------------------------------------------------------------------------
// ORDERING
// ---------------------------------------------------------------------------
test('FLUSH PUTS THE HELD TOUCHDOWN FIRST, before a quarter, close or final', () => {
  const held = onScore(null, { delta: 6, state: state(20, 14), play: TD_BARE, now: 0 }).pending;
  const r = flush(held);
  assert.equal(r.pending, null);
  assert.equal(r.emit.length, 1);
  assert.equal(r.emit[0].state.homeScore, 20);
  assert.equal(r.emit[0].timedOut, false, 'it was not the clock that sent it, it was the whistle');
  assert.equal(r.emit[0].kind, 'touchdown');
});

test('flushing nothing is nothing', () => {
  assert.deepEqual(flush(null), { pending: null, emit: [] });
});

test('A HOLD IS NEVER A DROP: every path out of the machine emits exactly once', () => {
  const start = () => onScore(null, { delta: 6, state: state(20, 14), play: TD_BARE, now: 0 });
  // three ways the hold can end, and all three send
  assert.equal(onScore(start().pending, { delta: 1, state: state(21, 14), now: 1 }).emit.length, 1);
  assert.equal(onTick(start().pending, { now: FOLD_WINDOW_MS }).emit.length, 1);
  assert.equal(flush(start().pending).emit.length, 1);
});

test('the poller wires the machine, sweeps it every poll, and flushes before other events', () => {
  const t = readFileSync(new URL('../../services/live-poller/poll.mjs', import.meta.url), 'utf8');
  assert.match(t, /import \{ onScore, onTick, flush as flushFold \}/);
  assert.match(t, /if \(t\.event !== 'score'\) \{[\s\S]*?flushFold\(pendingScore\.get\(k\)/,
    'a non-score event flushes the hold before it is sent');
  assert.match(t, /onTick\(p, \{ now: Date\.now\(\) \}\)/, 'and the sweep runs every poll');
  assert.match(t, /scoringPlayFor\(sql, m\.id/, 'the play lookup is wired');
});
