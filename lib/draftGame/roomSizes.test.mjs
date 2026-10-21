// lib/draftGame/roomSizes.test.mjs - wed-1: the Nightly room's size follows the
// slate (2-3 / 4-6 / 7+), the positional pool check drops a size when thin, a
// full 6x5 room completes legally for every seat, and every string comes from the shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomState, completeRoom, advanceBots, assignSlots, slotFits, shapeOf } from './rules.js';
import { nightlyShape, shapeChain, chooseShape, poolFits, ensureNightlyNba } from './nightly.js';
import {
  startLine, roomSummary, waitingNote, waitingTitle, shareLabel, slotList, finishTitle, lineupLine,
  tomorrowLine, nightlyHeadLines, roundLine, emailTile,
} from './nightlyCopy.js';

/** A pool with `spec` = { pos: count }, projections scattered so positions are spread through the order. */
const mk = (spec) => {
  const rows = [];
  let id = 1;
  for (const [pos, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i += 1) { rows.push({ id, name: `${pos}${id}`, pos, team: id % 2 ? 'NYK' : 'PHI', team_id: 1 }); id += 1; }
  }
  return rows.map((p, i, a) => ({ ...p, proj: 80 - ((i * 37) % a.length) * 0.4 - i * 0.001 }));
};
const RICH = mk({ G: 30, F: 30, C: 20, 'G-F': 10, 'F-C': 10 });

test('shape by slate size: 2,3 -> 4x3; 4,6 -> 6x4; 7,11 -> 6x5', () => {
  for (const n of [2, 3]) assert.deepEqual(nightlyShape(n), { seats: 4, rounds: 3, slots: ['G', 'F', 'UTIL'], count: 3 });
  for (const n of [4, 5, 6]) assert.deepEqual(nightlyShape(n), { seats: 6, rounds: 4, slots: ['G', 'F', 'C', 'UTIL'], count: 4 });
  for (const n of [7, 11]) assert.deepEqual(nightlyShape(n), { seats: 6, rounds: 5, slots: ['G', 'G', 'F', 'F', 'C'], count: 5 });
  assert.deepEqual(shapeChain(11).map((s) => s.rounds), [5, 4, 3]);
  assert.deepEqual(shapeChain(6).map((s) => s.rounds), [4, 3]);
  assert.deepEqual(shapeChain(2).map((s) => s.rounds), [3]);
  nightlyShape(11).slots.push('X');
  assert.equal(nightlyShape(11).slots.length, 5, 'callers get a copy');
});

test('slotFits handles C, and repeated slots assign as a matching', () => {
  assert.ok(slotFits('C', 'C') && slotFits('F-C', 'C') && slotFits('C-F', 'F') && !slotFits('G', 'C') && !slotFits('G-F', 'C'));
  const slots = ['G', 'G', 'F', 'F', 'C'];
  assert.deepEqual(assignSlots(['G', 'G', 'F', 'F', 'C'], slots), ['G', 'G', 'F', 'F', 'C']);
  assert.ok(assignSlots(['G-F', 'G-F', 'F', 'G', 'F-C'], slots));
  assert.equal(assignSlots(['G', 'G', 'G', 'F', 'C'], slots), null, 'three guards, two G slots');
  assert.equal(assignSlots(['F', 'F', 'F', 'G', 'G'], slots), null, 'no centre');
});

test('a thin pool drops a size and says why', () => {
  const enough = chooseShape(RICH, 11);
  assert.equal(enough.shape.rounds, 5);
  assert.equal(enough.note, null);
  // 11 games but only 6 centres: 6x5 and 6x4 both need 8 C -> 4x3
  const fewC = mk({ G: 40, F: 40, C: 6 });
  const r = chooseShape(fewC, 11);
  assert.deepEqual([r.shape.seats, r.shape.rounds], [4, 3]);
  assert.match(r.note, /6x5 refused \(C 6 < 8\)/);
  assert.match(r.note, /6x4 refused/);
  // only 10 guards: 6x5 needs 14 G, 6x4 needs 8 -> 6x4
  const fewG = mk({ G: 10, F: 40, C: 20 });
  const m = chooseShape(fewG, 11);
  assert.deepEqual([m.shape.seats, m.shape.rounds], [6, 4]);
  assert.match(m.note, /6x5 refused \(G 10 < 14\)/);
  assert.equal(chooseShape(fewC, 5).shape.rounds, 3, 'a 4-6 game slate never reaches for 6x5');
  const none = chooseShape(mk({ G: 3, F: 3 }), 2);
  assert.equal(none.shape, null);
  assert.ok(none.detail);
  assert.equal(poolFits(RICH, nightlyShape(11)).ok, true);
});

test('a full 6x5 room: bots + autoPick leave every seat a legal lineup, from every seat, every contest', () => {
  const shape = nightlyShape(11);
  for (const contestId of [1, 2, 3, 4, 5, 6, 7]) {
    for (let userSeat = 1; userSeat <= 6; userSeat += 1) {
      const made = completeRoom(RICH, [], { contestId, userSeat, shape });
      assert.equal(made.length, 30, '6 seats x 5 rounds');
      const st = roomState(RICH, made, shape);
      assert.ok(st.done);
      for (let s = 1; s <= 6; s += 1) {
        assert.equal(st.rosters[s].length, 5);
        const a = assignSlots(st.rosters[s].map((x) => x.pos), shape.slots);
        assert.ok(a, `seat ${s} (room ${contestId}/${userSeat}) holds a legal lineup`);
        assert.deepEqual([...a].sort(), [...shape.slots].sort());
      }
    }
  }
});

test('a tight pool: nobody is stranded without a centre (the finishable look-ahead)', () => {
  const tight = mk({ G: 24, F: 24, C: 8 });
  const shape = { seats: 6, rounds: 4, slots: ['G', 'F', 'C', 'UTIL'], count: 4 };
  assert.equal(poolFits(tight, shape).ok, true);
  for (const userSeat of [1, 3, 6]) {
    const made = completeRoom(tight, [], { contestId: 9, userSeat, shape });
    const st = roomState(tight, made, shape);
    for (let s = 1; s <= 6; s += 1) assert.ok(assignSlots(st.rosters[s].map((x) => x.pos), shape.slots), `seat ${s}`);
  }
});

test('advanceBots in a 6-seat room stops on the human and honours the snake', () => {
  const shape = nightlyShape(8);
  const made = advanceBots(RICH, [], { contestId: 3, userSeat: 4, shape });
  assert.deepEqual(made.map((p) => p.seat), [1, 2, 3]);
  assert.equal(shapeOf({ ...shape }).seats, 6);
});

test('copy follows the shape', () => {
  const s2 = nightlyShape(2), s5 = nightlyShape(5), s9 = nightlyShape(9);
  assert.equal(slotList(s2.slots), 'G, F and UTIL');
  assert.equal(roomSummary(s2), 'Four drafters, three picks: G, F and UTIL');
  assert.equal(roomSummary(s5), 'Six drafters, four picks: G, F, C and UTIL');
  assert.equal(roomSummary(s9), 'Six drafters, five picks: G, G, F, F and C');
  assert.equal(startLine(s9), "Tonight's NBA games. Six drafters, five picks: G, G, F, F and C. All five score.");
  assert.equal(startLine(s2), "Tonight's NBA games. Four drafters, three picks: G, F and UTIL. All three score.");
  assert.equal(waitingNote(s5), 'All four score. Points start at the first tip.');
  assert.equal(waitingTitle(5), 'Your five are in');
  assert.equal(finishTitle(5), 'YOUR FIVE ARE IN');
  assert.equal(shareLabel([1, 2, 3, 4, 5]), 'Share my five');
  assert.equal(lineupLine(s9), 'G · G · F · F · C · all 5 count');
  assert.equal(lineupLine(s5), 'G · F · C · UTIL · all 4 count');
  assert.equal(roundLine({ round: 2, rounds: 5, yourTurn: true }), 'Round 2 of 5 · your pick');
  assert.match(nightlyHeadLines({ dayEt: '2026-10-21', games: new Array(11), shape: s9, kickoffAt: '2026-10-21T23:00:00Z' }).line2, /^6 drafters · 5 picks · locks /);
  assert.equal(tomorrowLine({ games: new Array(11), seats: 6, rounds: 5 }), 'Tomorrow: 11 games · 6 drafters · 5 picks');
});

test('ensureNightlyNba stores the chosen shape, and the note when it dropped a size', async () => {
  const now = new Date('2026-10-20T14:00:00Z');
  const games = Array.from({ length: 8 }, (_, i) => ({ id: 20 + i, slug: `g${i}`, kickoff_at: `2026-10-20T${i > 3 ? 23 : 22}:${i % 2 ? '30' : '00'}:00Z`, status: 'scheduled', season_year: 2026, week: 0, home: 'NYK', away: 'PHI' }));
  const run = async (spec) => {
    let ins = null;
    const fn = async (strings, ...v) => {
      const q = strings.join('?');
      if (/FROM matches m/.test(q)) return games;
      if (/meta->>'nightly'/.test(q)) return [];
      if (/INSERT INTO contests/.test(q)) { ins = v; return [{ id: 5 }]; }
      return [];
    };
    const buildPool = async (m) => mk(spec).map((p) => ({ ...p, id: p.id + m.id * 1000 }));
    const r = await ensureNightlyNba({ now, sql: fn, env: { NBA_NIGHTLY_DRAFT: 'on' }, buildPool });
    return { r, meta: ins ? JSON.parse(ins.at(-1)) : null };
  };
  const big = await run({ G: 12, F: 12, C: 8 });
  assert.equal(big.r.created, true);
  assert.deepEqual([big.meta.seats, big.meta.rounds, big.meta.slots.length], [6, 5, 5]);
  assert.equal(big.meta.shape_note, undefined);
  const thin = await run({ G: 12, F: 12, C: 0 });
  assert.equal(thin.r.created, true);
  assert.deepEqual([thin.meta.seats, thin.meta.rounds], [4, 3]);
  assert.match(thin.meta.shape_note, /4x3 for 8 games/);
});

test('email tile: label and room shape', () => {
  const t = emailTile({ games: new Array(11), seats: 6, rounds: 5 }, '2026-10-21T23:00:00Z');
  assert.match(t.label, /^NBA Draft tonight · 11 games · locks \d{1,2}:\d{2} [AP]M PT$/);
  assert.equal(t.room, '6 drafters · 5 picks');
  assert.ok(emailTile({ games: new Array(1), seats: 4, rounds: 3 }, '2026-10-21T23:00:00Z').label.includes('1 game ·'));
});
