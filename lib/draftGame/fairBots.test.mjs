// lib/draftGame/fairBots.test.mjs - wed-1: nightly bots choose among the best five
// (35/25/18/13/9, never always #1, slot rules honoured, deterministic), and the
// HUMAN FIELD RANK across tonight's rooms (competition ranking, bots never count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  botPick, botSeed, botWeightsFor, NIGHTLY_BOT_WEIGHTS, BOT_TOP_N, advanceBots, completeRoom, roomState, assignSlots, byProjection,
} from './rules.js';
import { nightlyShape } from './nightly.js';
import { settleGameBoard, fieldRank } from './settle.js';
import { fieldLine } from './nightlyCopy.js';

const POS = ['G', 'F', 'C', 'G-F', 'F-C', 'G', 'F'];
const board = Array.from({ length: 90 }, (_, i) => ({ id: 2000 + i, name: `P${String(i).padStart(2, '0')}`, pos: POS[i % POS.length], team: i % 2 ? 'NYK' : 'PHI', team_id: 1, proj: 90 - i }));
const SHAPE = nightlyShape(9);

test('weights: five wide, sum to 1, best first; per-game keeps the top three', () => {
  assert.deepEqual([...NIGHTLY_BOT_WEIGHTS], [0.35, 0.25, 0.18, 0.13, 0.09]);
  assert.ok(Math.abs(NIGHTLY_BOT_WEIGHTS.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(botWeightsFor(SHAPE), NIGHTLY_BOT_WEIGHTS);
  assert.equal(botWeightsFor({ seats: 4, rounds: 4, slots: null }).length, BOT_TOP_N);
  assert.equal(botWeightsFor(undefined).length, BOT_TOP_N);
});

test('a nightly bot picks from the top five, spreads over all five, and is not always #1', () => {
  const avail = byProjection(board);
  const counts = [0, 0, 0, 0, 0, 0];
  const N = 4000;
  for (let n = 1; n <= N; n += 1) {
    const row = botPick(avail, botSeed({ contestId: n, userSeat: (n % 6) + 1, n }), NIGHTLY_BOT_WEIGHTS);
    const idx = avail.findIndex((r) => r.id === row.id);
    counts[idx > 4 ? 5 : idx] += 1;
  }
  assert.equal(counts[5], 0, 'never below the fifth');
  for (let i = 0; i < 5; i += 1) assert.ok(counts[i] > 0, `rank ${i + 1} gets picked`);
  assert.ok(counts[0] < N * 0.5, 'never always #1');
  const share = counts.slice(0, 5).map((c) => c / N);
  NIGHTLY_BOT_WEIGHTS.forEach((w, i) => assert.ok(Math.abs(share[i] - w) < 0.04, `rank ${i + 1}: ${share[i].toFixed(3)} ~ ${w}`));
  // fewer than five left: still picks, never null
  assert.ok(botPick(avail.slice(0, 2), 5, NIGHTLY_BOT_WEIGHTS));
  assert.equal(botPick([], 5, NIGHTLY_BOT_WEIGHTS), null);
  // the per-game default is unchanged: top three only
  const three = new Set();
  for (let n = 1; n <= 500; n += 1) three.add(avail.findIndex((r) => r.id === botPick(avail, n).id));
  assert.deepEqual([...three].sort(), [0, 1, 2]);
});

test('deterministic: the same (contest, seat, pick) gives the same room', () => {
  const a = advanceBots(board, [], { contestId: 77, userSeat: 5, shape: SHAPE });
  const b = advanceBots(board, [], { contestId: 77, userSeat: 5, shape: SHAPE });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, advanceBots(board, [], { contestId: 78, userSeat: 5, shape: SHAPE }));
});

test('bots only take players that fit a slot their seat still needs', () => {
  for (const contestId of [11, 12, 13, 14]) {
    for (const userSeat of [1, 4, 6]) {
      const made = completeRoom(board, [], { contestId, userSeat, shape: SHAPE });
      const st = roomState(board, made, SHAPE);
      for (let s = 1; s <= 6; s += 1) assert.ok(assignSlots(st.rosters[s].map((x) => x.pos), SHAPE.slots), `seat ${s}`);
    }
  }
  // and a bot is not always the room's #1 available: across rooms the first bot pick varies
  const firsts = new Set();
  for (let c = 1; c <= 40; c += 1) firsts.add(advanceBots(board, [], { contestId: c, userSeat: 6, shape: SHAPE })[0].id);
  assert.ok(firsts.size > 1 && firsts.size <= 5);
});

test('field rank: competition ranking among humans, ties share a place', () => {
  const scores = [120, 100, 100, 80, 50];
  assert.deepEqual(scores.map((s) => fieldRank(s, scores)), [
    { place: 1, of: 5 }, { place: 2, of: 5 }, { place: 2, of: 5 }, { place: 4, of: 5 }, { place: 5, of: 5 },
  ]);
  assert.deepEqual(fieldRank(10, [10]), { place: 1, of: 1 });
  assert.equal(fieldLine({ place: 2, of: 7 }), 'You: 2nd of 7 players');
  assert.equal(fieldLine({ place: 1, of: 2 }), 'You: 1st of 2 players');
  assert.equal(fieldLine({ place: 11, of: 20 }), 'You: 11th of 20 players');
  assert.equal(fieldLine({ place: 22, of: 30 }), 'You: 22nd of 30 players');
  assert.equal(fieldLine(null), null);
});

function fakeSql(handlers) {
  const fn = async (strings, ...vals) => {
    const q = strings.join('?');
    for (const [re, h] of handlers) if (re.test(q)) return h(vals, q);
    return [];
  };
  fn.transaction = async (qs) => Promise.all(qs);
  return fn;
}

test('settle writes result.field on every human entry, separate from the room places, bots never counted', async () => {
  const meta = { nightly: true, slate: [11, 12], ...SHAPE };
  const entries = [1, 2, 3, 4].map((seat, i) => ({
    id: 100 + i, user_id: 900 + i,
    meta: { room: { seat, picks: completeRoom(board, [], { contestId: 50, userSeat: seat, shape: SHAPE }), deadline: null } },
  }));
  const writes = [];
  const sql = fakeSql([
    [/FROM contests c JOIN matches m/, () => [{ id: 50, match_id: 11, sport: 'nba', board, locks_at: '2026-10-20T23:00:00Z', settled: false, meta, status: 'final' }]],
    [/FROM matches WHERE id = ANY/, () => [
      { id: 11, status: 'final', kickoff_at: '2026-10-20T23:00:00Z' }, { id: 12, status: 'final', kickoff_at: '2026-10-21T01:30:00Z' }]],
    [/FROM contest_entries WHERE contest_id/, () => entries],
    [/count\(\*\)::int AS n FROM nba_player_game_stats/, () => [{ n: 20 }]],
    [/FROM nba_player_game_stats/, () => board.map((p, i) => ({ bdl_player_id: String(p.id), dnp: false, seconds: 1000, pts: (i * 7) % 23, reb: 3, ast: 2, stl: 1, blk: 0, turnovers: 1, fg3m: 0, fgm: 3, fga: 6, ftm: 1, fta: 2, oreb: 1, dreb: 2 }))],
    [/UPDATE contest_entries/, (v) => { writes.push(v.map((x) => (typeof x === 'string' && x.startsWith('{') ? JSON.parse(x) : x))); return []; }],
  ]);
  const r = await settleGameBoard(50, { now: new Date('2026-10-21T06:00:00Z'), sql });
  assert.equal(r.settled, true);
  assert.equal(writes.length, 4);
  const results = writes.map((w) => w.find((x) => x && typeof x === 'object' && 'final' in x && 'seats' in x) ?? w.find((x) => x?.field));
  const rooms = results.map((x) => x ?? null);
  assert.ok(rooms.every(Boolean), 'each write carries a result');
  const scores = rooms.map((x) => x.you.score);
  for (const x of rooms) {
    assert.equal(x.field.of, 4, 'four humans, not 4 x 6 seats');
    assert.equal(x.field.place, scores.filter((s) => s > x.you.score).length + 1);
    assert.equal(x.seats.length, 6, 'the room still lists its bots with their own places');
    assert.ok(x.seats.every((s) => s.place >= 1 && s.place <= 6));
  }
});
