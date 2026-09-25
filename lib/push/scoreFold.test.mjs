// lib/push/scoreFold.test.mjs - one touchdown, one notification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onScore, onTick, flush, FOLD_WINDOW_MS } from './scoreFold.js';
import { pushPayload } from './payload.js';

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

test('THE TRY FOLDS IN: +1 on that team emits ONE push, post-try', () => {
  const held = onScore(null, { delta: 6, state: state(20, 14), play: TD_BARE, now: 0 }).pending;
  const r = onScore(held, { delta: 1, state: state(21, 14), play: null, now: 20_000 });
  assert.equal(r.pending, null);
  assert.equal(r.emit.length, 1, 'one notification for one play');
  assert.equal(r.emit[0].state.homeScore, 21);
  assert.equal(r.emit[0].kind, 'touchdown');
  assert.equal(r.emit[0].scorer, 'D.Henry', "the held play's scorer survives the fold");
  assert.equal(r.emit[0].folded, true);
});

test('A REVERT CANCELS THE HOLD, SILENTLY - the score it held did not happen', () => {
  // 15 Sep, Mahomes' first touchdown: the provider went 0 -> 6, back to 0,
  // then 0 -> 7. The old fold took the revert as the try and sent
  // "DEN 0, KC 0 · KC touchdown" - a touchdown on a nil-nil scoreline - and
  // then the real seventh point sent a second push.
  const held = onScore(null, { delta: 6, state: state(6, 0), play: null, now: 0 }).pending;
  const r = onScore(held, { delta: -6, state: state(0, 0), play: null, now: 62_000 });
  assert.equal(r.pending, null, 'the hold is gone');
  assert.deepEqual(r.emit, [], 'and NOTHING is announced');
});

test('ANY revert cancels, not only one that undoes the whole six', () => {
  const held = () => onScore(null, { delta: 6, state: state(6, 0), play: null, now: 0 }).pending;
  for (const d of [-1, -3, -6, -7]) {
    assert.deepEqual(onScore(held(), { delta: d, state: state(0, 0), now: 1 }).emit, [], `delta ${d}`);
  }
});

test('ANYTHING ELSE LEAVES THE HOLD STANDING', () => {
  // The hold survives a delta that is not a try. What happens to that delta is
  // the caller's business and not the hold's - and it is deliberately NOT
  // described as "sends its own" here, because a bare six holds rather than
  // sends, and a test name that said otherwise would contradict the rule
  // directly above it.
  const held = onScore(null, { delta: 6, state: state(6, 0), play: null, now: 0 }).pending;
  const r = onScore(held, { delta: 6, state: state(12, 0), play: null, now: 10_000 });
  assert.ok(r.pending, 'the hold survives');
  assert.equal(r.pending.at, 0, 'and keeps its own window');
  assert.equal(r.pending.state.homeScore, 6, 'still holding the six it was holding');
});

test('THE HOLD IS PER TEAM: the other side gets its own, independent', () => {
  // Structural, not conditional: the poller keys pendingScore by
  // `${matchId}:${team}`, so the other side is a different slot with its own
  // null pending. Asserted against the source because that is where it lives.
  const t = readFileSync(new URL('../../services/live-poller/poll.mjs', import.meta.url), 'utf8');
  assert.match(t, /const key = `\$\{m\.id\}:\$\{team\}`/);
  assert.match(t, /for \(const side of \['home', 'away'\]\)/, 'and both sides flush independently');
  // The other team's slot being empty, its six holds on its own merits.
  // A +6 on the other team CREATES ITS OWN HOLD and does not disturb the
  // first: two slots, two pendings, and neither announces anything yet.
  const mine = onScore(null, { delta: 6, state: state(6, 0), play: null, now: 0 });
  const theirs = onScore(null, { delta: 6, state: state(6, 6), play: null, now: 0 });
  assert.ok(mine.pending && theirs.pending, 'two independent holds');
  assert.equal(mine.pending.state.homeScore, 6);
  assert.equal(theirs.pending.state.awayScore, 6);
  assert.deepEqual(mine.emit, [], 'a bare six holds, it does not send');
  assert.deepEqual(theirs.emit, []);
});

test('THE FLAP SEQUENCE FROM 15 SEP PRODUCES EXACTLY ONE PUSH', () => {
  const MAHOMES = {
    kind: 'touchdown', scorer: 'P.Mahomes', credit: 'P.Mahomes',
    tryResolved: true, tryKind: 'kick-good', tryPoints: 1, homeScore: 7, awayScore: 0,
  };
  const sent = [];
  let pending = null;

  ({ pending } = onScore(pending, { delta: 6, state: state(6, 0, { clock: '8:11', period: 1 }), play: null, now: 0 }));
  assert.ok(pending, 'the six holds - no play row yet');

  let r = onScore(pending, { delta: -6, state: state(0, 0, { clock: '9:47', period: 1 }), play: null, now: 62_000 });
  pending = r.pending; sent.push(...r.emit);
  assert.equal(sent.length, 0, 'the flap announces nothing');

  r = onScore(pending, { delta: 7, state: state(7, 0, { clock: '8:11', period: 1 }), play: MAHOMES, now: 125_000 });
  pending = r.pending; sent.push(...r.emit);

  assert.equal(sent.length, 1, 'ONE push for one touchdown');

  // THE PAYLOAD IS WHAT WENT TO THE PHONE, so the payload is what is asserted.
  // The emit fields are an intermediate; a reader never sees them, and a test
  // that stopped there would pass while the copy said something else.
  const p = pushPayload('score', {
    homeAbbr: 'KC', awayAbbr: 'DEN', leagueSlug: 'nfl', slug: 'den-at-kc', network: 'ESPN',
    ...sent[0].state, scoreKind: `KC ${sent[0].kind}`, credit: sent[0].credit,
  });
  assert.equal(p.title, 'DEN 0, KC 7 · KC touchdown');
  assert.equal(p.body, 'P.Mahomes · Q1 8:11 · ESPN');
});

// ---------------------------------------------------------------------------
// THE LATE PLAY IS THE NORMAL CASE
// ---------------------------------------------------------------------------
test('A SCORER THAT ARRIVES DURING THE HOLD MAKES IT INTO THE PUSH', () => {
  const held = onScore(null, { delta: 6, state: state(6, 0), play: null, now: 0 }).pending;
  assert.equal(held.play, null, 'nothing known at the hold');
  const landed = { kind: 'touchdown', scorer: 'R.Rice', credit: 'P.Mahomes to R.Rice' };
  const r = onScore(held, { delta: 1, state: state(7, 0), play: landed, now: 40_000 });
  assert.equal(r.emit[0].scorer, 'R.Rice');
  assert.equal(r.emit[0].credit, 'P.Mahomes to R.Rice');
});

test('a play that lands before the TIMEOUT also makes it in', () => {
  const held = onScore(null, { delta: 6, state: state(6, 0), play: null, now: 0 }).pending;
  const landed = { kind: 'touchdown', scorer: 'D.Henry', credit: 'D.Henry' };
  const r = onTick(held, { now: FOLD_WINDOW_MS, play: landed });
  assert.equal(r.emit.length, 1);
  assert.equal(r.emit[0].credit, 'D.Henry');
  assert.equal(r.emit[0].timedOut, true);
  assert.equal(r.emit[0].state.homeScore, 6, 'still a six - the try never came');
});

test('NO PLAY EVER: the push goes at the timeout with the delta wording', () => {
  const held = onScore(null, { delta: 6, state: state(6, 0), play: null, now: 0 }).pending;
  const r = onTick(held, { now: FOLD_WINDOW_MS, play: null });
  assert.equal(r.emit.length, 1);
  assert.equal(r.emit[0].credit, null, 'nothing is invented');
  assert.equal(r.emit[0].scorer, null);
  assert.equal(r.emit[0].kind, 'touchdown', 'the delta still names the kind');
});

test('the fresh lookup wins over the stale one at flush too', () => {
  const stale = { kind: 'touchdown', scorer: 'Old.Name', credit: 'Old.Name' };
  const held = onScore(null, { delta: 6, state: state(6, 0), play: stale, now: 0 }).pending;
  assert.equal(flush(held, { play: { kind: 'touchdown', scorer: 'New.Name', credit: 'New.Name' } }).emit[0].credit, 'New.Name');
  assert.equal(flush(held).emit[0].credit, 'Old.Name', 'and the stale one is the fallback');
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
  // onScore is reached THROUGH composeScorePush (lib/push/scoreCompose.js),
  // which carries the league's sport into it - a bare call defaulted to
  // football and held a six-run inning as a touchdown.
  assert.match(t, /import \{ composeScorePush \} from '\.\.\/\.\.\/lib\/push\/scoreCompose\.js'/);
  assert.match(t, /import \{ onTick, flush as flushFold/);
  assert.match(t, /if \(t\.event !== 'score'\) \{[\s\S]*?flushFold\(held0, \{ play: freshPlay \}\)/,
    'a non-score event flushes the hold before it is sent, with a fresh lookup');
  assert.match(t, /onTick\(p, \{ now: Date\.now\(\), play: freshPlay \}\)/,
    'and the sweep runs every poll, re-looking-up a hold that is due');
  assert.match(t, /scoringPlayFor\(sql, m\.id/, 'the play lookup is wired');
  assert.equal((t.match(/scoringPlayFor\(/g) ?? []).length, 3,
    'once per score event, once at flush, once at timeout');
  assert.match(t, /const due0 = Date\.now\(\) - p\.at >= FOLD_WINDOW_MS/,
    'and only for a hold that is due, so a live hold costs no query');
});
