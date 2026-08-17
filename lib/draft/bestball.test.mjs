// lib/draft/bestball.test.mjs - roster -> six slots. PURE.
//
// The optimality property is pinned by an EXHAUSTIVE CHECK against brute force,
// not by a handful of examples. The greedy rule is only correct because the
// five non-QB slots draw from one pool under nothing but a minimum of one
// apiece; the moment a real constraint appears that argument dies, and this
// test is what makes that failure loud instead of quiet.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { bestBall, canFieldSix } = await import('./bestball.js');
const { scoreLineup, SLOTS } = await import('../daily/play.js');

const P = (id, pos, points, name = `p${id}`) => ({ id, pos, points, name });
const boardOf = (...ps) => ps;
const rosterOf = (...ps) => ps.map((p) => ({ id: p.id, pos: p.pos }));

// ---------------------------------------------------------------------------
// THE CORE RULE
// ---------------------------------------------------------------------------

test('the best six are fielded, one per mandatory slot then the best two flexes', () => {
  const b = boardOf(
    P(1, 'QB', 30), P(2, 'QB', 10),
    P(3, 'RB', 25), P(4, 'RB', 20),
    P(5, 'WR', 22), P(6, 'WR', 18),
    P(7, 'TE', 8), P(8, 'TE', 3),
  );
  const r = bestBall(rosterOf(...b), b);
  assert.equal(r.lineup.QB, 1);
  assert.equal(r.lineup.RB, 3);
  assert.equal(r.lineup.WR, 5);
  assert.equal(r.lineup.TE, 7);
  // best two remaining from RB/WR/TE: RB 20 and WR 18
  assert.deepEqual([r.lineup.FLEX, r.lineup.FLEX2].sort(), [4, 6]);
  assert.equal(r.bench.some((p) => p.id === 2), true, 'the second QB benches');
});

test('A MANDATORY TE IS FIELDED EVEN WHEN EVERY FLEX WOULD SCORE MORE', () => {
  // The slot exists, so the zero is taken rather than filled with a fourth WR.
  const b = boardOf(P(1,'QB',20), P(2,'RB',18), P(3,'WR',17), P(4,'WR',16), P(5,'WR',15), P(9,'TE',0.5));
  const r = bestBall(rosterOf(...b), b);
  assert.equal(r.lineup.TE, 9);
  // WR 17 takes the WR slot, so the flexes are the next two: WR 16 and WR 15.
  assert.deepEqual([r.lineup.FLEX, r.lineup.FLEX2].sort((x, y) => x - y), [4, 5]);
  assert.equal(r.lineup.WR, 3);
});

test('OPTIMAL vs BRUTE FORCE over randomised rosters', () => {
  // The property, checked exhaustively rather than by example. Deterministic
  // pseudo-random so a failure is reproducible - Math.random is unavailable in
  // this codebase's scripts and is a bad idea in a test regardless.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const POS = ['QB', 'RB', 'WR', 'TE'];

  for (let iter = 0; iter < 300; iter++) {
    const n = 8 + Math.floor(rnd() * 8);
    const board = [];
    for (let i = 1; i <= n; i++) {
      board.push(P(i, POS[Math.floor(rnd() * 4)], Math.round(rnd() * 300) / 10));
    }
    const roster = rosterOf(...board);
    if (!canFieldSix(roster).ok) continue;

    const got = bestBall(roster, board);
    const gotScore = scoreLineup(got.lineup, board).baseScore;

    // BRUTE FORCE: every assignment of distinct players to the six slots.
    const eligible = (slot) => board.filter((p) =>
      slot === 'QB' ? p.pos === 'QB'
        : slot === 'FLEX' || slot === 'FLEX2' ? ['RB','WR','TE'].includes(p.pos)
          : p.pos === slot);
    let best = -Infinity;
    const walk = (i, used, acc) => {
      if (i === SLOTS.length) { best = Math.max(best, scoreLineup(acc, board).baseScore); return; }
      const slot = SLOTS[i];
      const opts = eligible(slot).filter((p) => !used.has(p.id));
      if (!opts.length) { walk(i + 1, used, acc); return; }
      for (const p of opts) {
        used.add(p.id); walk(i + 1, used, { ...acc, [slot]: p.id }); used.delete(p.id);
      }
    };
    walk(0, new Set(), {});
    assert.equal(gotScore, best,
      `iteration ${iter}: greedy scored ${gotScore}, brute force found ${best}`);
  }
});

// ---------------------------------------------------------------------------
// EDGES
// ---------------------------------------------------------------------------

test('a player the board cannot score is UNSCORED, not a zero', () => {
  // Zero and unknown are different facts. An entry full of unknowns is a bridge
  // failure worth surfacing, not a bad week worth reporting.
  const b = boardOf(P(1,'QB',20), P(2,'RB',10));
  const r = bestBall([...rosterOf(...b), { id: 999, pos: 'WR' }], b);
  assert.deepEqual(r.unscored.map((p) => p.id), [999]);
  assert.equal(Object.values(r.lineup).includes(999), false);
});

test('an incomplete roster leaves slots EMPTY, and AN EMPTY SLOT IS THE DROPPED ONE', () => {
  // Worth stating because it is a loophole if it ever reaches settlement: with
  // slots unfilled, drop-worst discards a ZERO rather than a real player, so an
  // incomplete roster keeps everything it has. It scores 30 here, not 20.
  //
  // That is exactly why canFieldSix is asked AT LOCK and a roster that fails it
  // is a DNF. This function must not be the thing that decides; it reports what
  // the roster can field, and the entry never reaches settlement in this state.
  const b = boardOf(P(1, 'QB', 20), P(2, 'RB', 10));
  const r = bestBall(rosterOf(...b), b);
  assert.equal(r.lineup.WR, undefined);
  assert.equal(r.lineup.TE, undefined);
  const s = scoreLineup(r.lineup, b);
  assert.equal(s.baseScore, 30, 'an empty slot is dropped, so nothing real is');
  assert.equal(s.picks.find((p) => p.dropped).id, null, 'the dropped pick is an empty slot');
  assert.equal(canFieldSix(rosterOf(...b)).ok, false, 'and this roster is a DNF at lock');
});

test('TIES ARE BROKEN BY ID so a settle is reproducible', () => {
  // A settle that is not reproducible cannot be replayed, and the replay
  // harness is how a disputed week gets checked.
  const b = boardOf(P(7,'QB',10), P(3,'QB',10), P(1,'RB',5), P(2,'WR',5), P(4,'TE',5), P(5,'RB',5), P(6,'WR',5));
  const a1 = bestBall(rosterOf(...b), b).lineup;
  const a2 = bestBall(rosterOf(...[...b].reverse()), b).lineup;
  assert.deepEqual(a1, a2, 'roster order must not change the lineup');
  assert.equal(a1.QB, 3, 'the lower id wins a tie');
});

test('a negative score is still fielded when the slot has no alternative', () => {
  // Fumble-heavy lines go negative in PPR. A mandatory slot takes it.
  const b = boardOf(P(1,'QB',20), P(2,'RB',10), P(3,'WR',9), P(4,'TE',-2), P(5,'RB',8), P(6,'WR',7));
  const r = bestBall(rosterOf(...b), b);
  assert.equal(r.lineup.TE, 4);
});

test('empty and absent inputs do not throw', () => {
  assert.deepEqual(bestBall([], []).lineup, {});
  assert.deepEqual(bestBall(null, null).lineup, {});
  assert.deepEqual(bestBall(null, null).unscored, []);
});

// ---------------------------------------------------------------------------
// THE LOCK-TIME CHECK
// ---------------------------------------------------------------------------

test('canFieldSix names what is missing, at lock, without needing scores', () => {
  // A player is entitled to know on Wednesday, not to discover it on Tuesday.
  assert.equal(canFieldSix([
    { pos: 'QB' }, { pos: 'RB' }, { pos: 'WR' }, { pos: 'TE' }, { pos: 'RB' }, { pos: 'WR' },
  ]).ok, true);
  const short = canFieldSix([{ pos: 'QB' }, { pos: 'RB' }, { pos: 'WR' }]);
  assert.equal(short.ok, false);
  assert.ok(short.missing.includes('TE'));
  assert.ok(short.missing.some((m) => String(m).includes('more RB/WR/TE')));
});

test('canFieldSix counts FIVE flex-eligible bodies, not four', () => {
  // 1 RB + 1 WR + 1 TE + 2 FLEX all come from RB/WR/TE.
  const four = [{ pos:'QB' }, { pos:'RB' }, { pos:'WR' }, { pos:'TE' }, { pos:'WR' }];
  assert.equal(canFieldSix(four).ok, false);
  assert.equal(canFieldSix([...four, { pos:'RB' }]).ok, true);
});
