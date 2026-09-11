// lib/contests/rollingLock.test.mjs - THE GAME LOCKS, NOT THE CONTEST.
// Three instants against Week 1: before the first kickoff, between NE-SEA
// (Wed) and SF-LAR (Thu), after the last game (Mon night).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotVerdict, mergeSlotWrites, saveVerdict, SLOTS } from '../weekly/rules.js';
import { confirmVerdict, lastKickoffOf } from '../games/confirmRules.js';
import { rowKickoff } from './slateBounds.js';
import { scoreLineup } from '../pickem/settle.js';
import { gameRows } from '../pickem/view.js';

const KO = { NE: '2026-09-10T00:20:00Z', SEA: '2026-09-10T00:20:00Z', SF: '2026-09-11T00:35:00Z', LAR: '2026-09-11T00:35:00Z', NYG: '2026-09-13T17:00:00Z', DAL: '2026-09-15T00:15:00Z' };
const LAST = '2026-09-15T00:15:00Z';
const BEFORE = new Date('2026-09-09T20:00:00Z'); const BETWEEN = new Date('2026-09-10T12:00:00Z'); const AFTER = new Date('2026-09-15T01:00:00Z');
const POOL = [
  { id: 1, pos: 'QB', name: 'D.Maye', team: 'NE' }, { id: 2, pos: 'RB', name: 'K.Walker', team: 'SEA' },
  { id: 3, pos: 'WR', name: 'B.Aiyuk', team: 'SF' }, { id: 4, pos: 'TE', name: 'T.Higbee', team: 'LAR' },
  { id: 5, pos: 'RB', name: 'D.Singletary', team: 'NYG' }, { id: 6, pos: 'WR', name: 'C.Lamb', team: 'DAL' },
  { id: 7, pos: 'WR', name: 'J.Smith-Njigba', team: 'SEA' }, { id: 8, pos: 'QB', name: 'B.Purdy', team: 'SF' },
  { id: 9, pos: 'TE', name: 'D.Kincaid', team: 'BYE' },
];
const kmap = new Map(Object.entries(KO));
const byId = new Map(POOL.map((p) => [p.id, p]));
const kickoffOf = (id) => rowKickoff(byId.get(id), kmap, LAST);

test('a pool row locks at its team kickoff; a bye locks at the window close', () => {
  assert.equal(kickoffOf(1), KO.NE); assert.equal(kickoffOf(5), KO.NYG); assert.equal(kickoffOf(9), LAST);
  assert.equal(slotVerdict(1, kickoffOf, BEFORE).ok, true);
  assert.deepEqual(slotVerdict(1, kickoffOf, BETWEEN), { ok: false, reason: 'slot_locked', kickoffAt: KO.NE });
  assert.equal(slotVerdict(3, kickoffOf, BETWEEN).ok, true, 'SF has not kicked on Thursday morning');
  assert.equal(slotVerdict(null, kickoffOf, AFTER).ok, true, 'an empty slot is not a locked slot');
});

test('WEEKLY at three instants: every write accepted before; NE/SEA slots refused between and the others stored; the window refuses after', () => {
  const existing = { QB: 1, RB: 2, WR: 3, TE: 4 };
  // before the first kickoff: change everything
  const b = mergeSlotWrites(existing, { QB: 8, RB: 5, WR: 6, TE: 9, FLEX: 7 }, kickoffOf, BEFORE);
  assert.deepEqual(b.rejected, []); assert.deepEqual(b.lineup, { QB: 8, RB: 5, WR: 6, TE: 9, FLEX: 7 });
  // between NE-SEA and SF-LAR: QB (NE, held) and RB (SEA, held) refuse; WR SF->DAL and FLEX (NYG) accepted
  const m = mergeSlotWrites(existing, { QB: 8, RB: 5, WR: 6, TE: 4, FLEX: 5 }, kickoffOf, BETWEEN);
  assert.deepEqual(m.rejected.map((r) => [r.slot, r.why, r.kickoffAt]), [['QB', 'held', KO.NE], ['RB', 'held', KO.SEA]]);
  assert.deepEqual(m.lineup, { QB: 1, RB: 2, WR: 6, TE: 4, FLEX: 5 }, 'the refused slots keep their players, the rest saved');
  // between: a kicked player cannot be taken into an open slot
  const k = mergeSlotWrites({ QB: 8 }, { QB: 8, FLEX: 7 }, kickoffOf, BETWEEN);
  assert.deepEqual(k.rejected.map((r) => [r.slot, r.why]), [['FLEX', 'kicked']]); assert.deepEqual(k.lineup, { QB: 8 });
  // between: clearing a locked slot is a write to it
  const c = mergeSlotWrites(existing, { RB: 2, WR: 3, TE: 4 }, kickoffOf, BETWEEN);
  assert.deepEqual(c.rejected.map((r) => r.slot), ['QB']); assert.equal(c.lineup.QB, 1);
  // after the last kickoff: the contest gate, before any slot is looked at
  assert.deepEqual(saveVerdict(LAST, AFTER), { ok: false, reason: 'locked' });
  assert.equal(saveVerdict(LAST, BETWEEN).ok, true, 'the window is open between games');
  assert.deepEqual(SLOTS, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'FLEX2']);
});

const BOARD = [
  { match_id: 21539, slug: 'ne-sea', kickoff_at: KO.NE, home: 'Seahawks', away: 'Patriots' },
  { match_id: 21540, slug: 'sf-lar', kickoff_at: KO.SF, home: 'Rams', away: '49ers' },
  { match_id: 21554, slug: 'dal-mon', kickoff_at: KO.DAL, home: 'Cowboys', away: 'Eagles' },
];

test("PICK'EM at three instants: a row is pickable iff now < its kickoff; the board greys kicked rows", () => {
  const at = (now) => gameRows({ board: BOARD, now, picks: {} }).map((g) => [g.slug, g.kicked]);
  assert.deepEqual(at(BEFORE), [['ne-sea', false], ['sf-lar', false], ['dal-mon', false]]);
  assert.deepEqual(at(BETWEEN), [['ne-sea', true], ['sf-lar', false], ['dal-mon', false]]);
  assert.deepEqual(at(AFTER), [['ne-sea', true], ['sf-lar', true], ['dal-mon', true]]);
});

test('JOIN AFTER THE FIRST KICKOFF: confirm is open while any row is unkicked, closed after the last; the Weekly confirms until its window close', () => {
  const pk = { settled: false, board: BOARD, locks_at: LAST };
  assert.equal(lastKickoffOf(BOARD), KO.DAL);
  assert.equal(confirmVerdict('pickem', pk, BEFORE).ok, true);
  assert.equal(confirmVerdict('pickem', pk, BETWEEN).ok, true, 'joined after NE-SEA, still confirms');
  assert.deepEqual(confirmVerdict('pickem', pk, AFTER), { ok: false, reason: 'locked', closeAt: KO.DAL });
  const wk = { settled: false, board: [], locks_at: LAST };
  assert.equal(confirmVerdict('weekly', wk, BETWEEN).ok, true); assert.equal(confirmVerdict('weekly', wk, AFTER).ok, false);
  const dr = { settled: false, board: [], locks_at: KO.NE };
  assert.equal(confirmVerdict('draft', dr, BETWEEN).ok, false, 'the Draft room still locks at the first kickoff');
  assert.equal(confirmVerdict('pickem', { ...pk, settled: true }, BEFORE).reason, 'settled');
});

test('SETTLE ON A PARTIAL ENTRY: unpicked rows score 0, picked rows score as before (no settle change)', () => {
  const results = { 21539: 'home', 21540: 'away', 21554: 'home' };
  assert.equal(scoreLineup({ 21539: 'home', 21540: 'away' }, results), 2, 'two right, the late-joined third row is simply absent');
  assert.equal(scoreLineup({ 21540: 'home' }, results), 0);
  assert.equal(scoreLineup({}, results), 0, 'a late joiner with nothing picked scores 0, not an error');
});
