// lib/draftGame/nightly.test.mjs - THE NBA NIGHTLY DRAFT (tue-6): the room's
// shape (G · F · UTIL, four seats, three rounds), the pool check, the creator
// and the slate-aware settle, against a fake database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotFits, assignSlots, shapeOf, roomState, completeRoom, advanceBots, DEFAULT_SHAPE, TOTAL_PICKS } from './rules.js';
import { nightlyShape, poolFits, tagRows, ensureNightlyNba, nightlyEnabled, MIN_GAMES } from './nightly.js';
import { settleGameBoard, roomResult } from './settle.js';
import { nightlyDraftItem } from '../games/playRegistry.js';

const SHAPE = nightlyShape(2);
const POS = ['G', 'F', 'C', 'G-F', 'F-C', 'G', 'F', 'G', 'F', 'C'];
const pool = (n = 40) => Array.from({ length: n }, (_, i) => ({
  id: 1000 + i, name: `P${i}`, pos: POS[i % POS.length], team: i % 2 ? 'NYK' : 'PHI', team_id: 1, proj: 60 - i,
}));

test('the shape: two games -> four drafters, three picks, G · F · UTIL, all count; meta round-trips', () => {
  assert.deepEqual(SHAPE, { seats: 4, rounds: 3, slots: ['G', 'F', 'UTIL'], count: 3 });
  assert.deepEqual(shapeOf({ ...SHAPE }), SHAPE);
  assert.deepEqual(shapeOf({}), { ...DEFAULT_SHAPE }, 'a per-game board keeps the old room');
  assert.equal(MIN_GAMES, 2);
});

test('slots: BDL letters, G-F fits both, C only UTIL; assignment is a real matching', () => {
  assert.ok(slotFits('G', 'G') && slotFits('G-F', 'G') && slotFits('G-F', 'F') && slotFits('F-C', 'F'));
  assert.ok(!slotFits('C', 'G') && !slotFits('C', 'F') && slotFits('C', 'UTIL'));
  assert.deepEqual(assignSlots(['G', 'G-F', 'C'], ['G', 'F', 'UTIL']), ['G', 'F', 'UTIL'], 'the swing man takes F so the centre fits UTIL');
  assert.deepEqual(assignSlots(['G-F', 'G', 'C'], ['G', 'F', 'UTIL']), ['F', 'G', 'UTIL'], 'a search, not first-fit: G-F moves off G');
  assert.equal(assignSlots(['C', 'C'], ['G', 'F', 'UTIL']), null, 'two centres cannot both fit');
  assert.equal(assignSlots(['G', 'G', 'G'], ['G', 'F', 'UTIL']), null);
});

test('a positional room only offers legal players, and every seat ends G · F · UTIL', () => {
  const board = pool();
  const all = completeRoom(board, [], { contestId: 7, userSeat: 2, shape: SHAPE });
  assert.equal(all.length, 12, '4 seats x 3 picks');
  const st = roomState(board, all, SHAPE);
  assert.ok(st.done);
  for (const s of [1, 2, 3, 4]) {
    assert.equal(st.rosters[s].length, 3);
    assert.deepEqual(st.rosters[s].map((p) => p.slot).sort(), ['F', 'G', 'UTIL'], `seat ${s} fills its slots`);
  }
  // A seat holding a C (UTIL used) and a G may now take only an F-eligible player.
  const c = board.find((p) => p.pos === 'C'); const g = board.find((p) => p.pos === 'G');
  const mid = roomState(board, [], SHAPE);
  assert.equal(mid.onClock, 1);
  const legal = roomState(board, [{ n: 1, seat: 1, id: c.id }, ...Array.from({ length: 6 }, (_, i) => ({ n: i + 2, seat: [2, 3, 4, 4, 3, 2][i], id: board.filter((p) => p.id !== c.id && p.id !== g.id)[i].id })), { n: 8, seat: 1, id: g.id }].slice(0, 8), SHAPE);
  assert.ok(legal.onClock === 1 && legal.available.length > 0);
  assert.ok(legal.available.every((p) => slotFits(p.pos, 'F')), 'only F-eligible players are offered');
});

test('the bots never stall and the old 4x4 room is unchanged', () => {
  const made = advanceBots(pool(), [], { contestId: 3, userSeat: 4, shape: SHAPE });
  assert.equal(made.length, 3, 'seats 1-3 pick before seat 4');
  const old = completeRoom(pool(30), [], { contestId: 3, userSeat: 1 });
  assert.equal(old.length, TOTAL_PICKS);
});

test('the pool check: enough of every slot for every seat, plus a margin', () => {
  assert.equal(poolFits(pool(), SHAPE).ok, true);
  const noGuards = pool().filter((p) => !slotFits(p.pos, 'G'));
  assert.match(poolFits([...noGuards, ...noGuards.map((p) => ({ ...p, id: p.id + 500 }))], SHAPE).reason, /^G /);
  assert.match(poolFits(pool(10), SHAPE).reason, /pool 10 < 16/);
});

test('rows know where they play: opponent, home or away, tip', () => {
  const m = { id: 5, home: 'NYK', away: 'PHI', kickoff_at: '2026-10-20T23:00:00Z' };
  const [a, b] = tagRows([{ id: 1, team: 'NYK' }, { id: 2, team: 'PHI' }], m);
  assert.deepEqual([a.opp, a.home, b.opp, b.home, a.match_id, a.tip], ['PHI', true, 'NYK', false, 5, '2026-10-20T23:00:00.000Z']);
});

// A fake sql: answers by the query's text; records inserts.
function fakeSql(handlers) {
  const calls = [];
  const fn = async (strings, ...vals) => {
    const q = strings.join('?');
    calls.push({ q, vals });
    for (const [re, h] of handlers) if (re.test(q)) return h(vals, q);
    return [];
  };
  fn.calls = calls;
  fn.transaction = async (qs) => Promise.all(qs);
  return fn;
}

test('the creator: off unless NBA_NIGHTLY_DRAFT=on; tonight = the untipped games; one room a night', async () => {
  assert.equal(nightlyEnabled({ NBA_NIGHTLY_DRAFT: 'on' }), true);
  assert.equal(nightlyEnabled({ NBA_NIGHTLY_DRAFT: 'yes' }), false);
  assert.equal((await ensureNightlyNba({ env: {} })).reason, 'off');
  const now = new Date('2026-10-20T21:00:00Z');
  const games = [
    { id: 11, slug: 'nba-2026-10-20-phi-nyk', kickoff_at: '2026-10-20T23:00:00Z', status: 'scheduled', season_year: 2026, week: 0, home: 'NYK', away: 'PHI' },
    { id: 12, slug: 'nba-2026-10-20-okc-sas', kickoff_at: '2026-10-21T01:30:00Z', status: 'scheduled', season_year: 2026, week: 0, home: 'SAS', away: 'OKC' },
    { id: 13, slug: 'nba-2026-10-21-x-y', kickoff_at: '2026-10-21T23:00:00Z', status: 'scheduled', season_year: 2026, week: 0, home: 'X', away: 'Y' },
  ];
  let inserted = null;
  const sql = fakeSql([
    [/FROM matches m/, () => games],
    [/meta->>'nightly'/, () => (inserted ? [{ id: 99 }] : [])],
    [/INSERT INTO contests/, (v) => { inserted = v; return [{ id: 99 }]; }],
  ]);
  const buildPool = async (m) => pool(20).map((p) => ({ ...p, id: p.id + m.id * 100, team: p.team === 'NYK' ? m.home : m.away }));
  const r = await ensureNightlyNba({ now, sql, env: { NBA_NIGHTLY_DRAFT: 'on' }, buildPool });
  assert.equal(r.created, true);
  assert.equal(r.games, 2, 'the 21 Oct game (ET tomorrow) is not tonight');
  const meta = JSON.parse(inserted.at(-1));
  assert.deepEqual(meta.slate, [11, 12]);
  assert.equal(meta.day_et, '2026-10-20');
  assert.deepEqual([meta.seats, meta.rounds, meta.count], [4, 3, 3]);
  assert.equal(inserted[3], 11, 'match_id = the first game');
  assert.equal(inserted[6], '2026-10-20T23:00:00.000Z', 'locks at the first tip');
  assert.equal((await ensureNightlyNba({ now, sql, env: { NBA_NIGHTLY_DRAFT: 'on' }, buildPool })).reason, 'exists');

  const one = fakeSql([[/FROM matches m/, () => games.slice(1, 2)]]);
  assert.equal((await ensureNightlyNba({ now, sql: one, env: { NBA_NIGHTLY_DRAFT: 'on' }, buildPool })).reason, 'small_slate');
});

test('the settle waits for the LAST game, scores across both boxes, DNP = 0, all three count', async () => {
  const board = pool().map((p, i) => ({ ...p, match_id: i % 2 ? 11 : 12 }));
  const meta = { nightly: true, slate: [11, 12], ...SHAPE };
  const picks = completeRoom(board, [], { contestId: 50, userSeat: 1, shape: SHAPE });
  const entry = { id: 1, user_id: 9, meta: { room: { seat: 1, picks, deadline: null } } };
  const mk = (statuses) => {
    const writes = [];
    const sql = fakeSql([
      [/FROM contests c JOIN matches m/, () => [{ id: 50, match_id: 11, sport: 'nba', board, locks_at: '2026-10-20T23:00:00Z', settled: false, meta, status: statuses[0] }]],
      [/FROM matches WHERE id = ANY/, () => [
        { id: 11, status: statuses[0], kickoff_at: '2026-10-20T23:00:00Z' },
        { id: 12, status: statuses[1], kickoff_at: '2026-10-21T01:30:00Z' }]],
      [/FROM contest_entries WHERE contest_id/, () => [entry]],
      [/count\(\*\)::int AS n FROM nba_player_game_stats/, () => [{ n: 20 }]],
      [/FROM nba_player_game_stats/, () => board.map((p, i) => ({ bdl_player_id: String(p.id), dnp: i === 0, seconds: 1000, pts: 10, reb: 5, ast: 5, stl: 1, blk: 1, turnovers: 1, fg3m: 1, fgm: 4, fga: 8, ftm: 1, fta: 2, oreb: 1, dreb: 4 }))],
      [/UPDATE contest/, (v, q) => { writes.push(q); return []; }],
    ]);
    return { sql, writes };
  };
  const late = new Date('2026-10-21T05:00:00Z');
  assert.equal((await settleGameBoard(50, { now: late, sql: mk(['final', 'live']).sql })).reason, 'not_final', 'second game still on');
  assert.equal((await settleGameBoard(50, { now: new Date('2026-10-21T03:00:00Z'), sql: mk(['final', 'final']).sql })).reason, 'grace', 'grace runs from the LAST tip');
  const done = mk(['final', 'final']);
  const r = await settleGameBoard(50, { now: late, sql: done.sql });
  assert.equal(r.settled, true);
  assert.ok(done.writes.some((q) => /UPDATE contests SET settled = true/.test(q)));

  const stats = new Map(board.map((p, i) => [p.id, i === 0 ? { dnp: true } : { dnp: false, pts: 10, reb: 0, ast: 0, stl: 0, blk: 0, turnovers: 0, fg3m: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 }]));
  const res = roomResult(board, picks, 1, stats, 'nba', SHAPE);
  assert.equal(res.seats.length, 4);
  for (const s of res.seats) assert.equal(s.players.filter((p) => p.counted).length, 3, 'all three count');
  const dnp = res.seats.flatMap((s) => s.players).find((p) => p.id === board[0].id);
  if (dnp) assert.equal(dnp.pts, 0, 'DNP = 0');
});

test('the Play card: "NBA Draft tonight · 2 games · locks 4:00 PM PT", into the room', () => {
  const e = { key: 'nba-nightly-draft', sport: 'nba', game: 'draft_game', name: 'NBA Draft tonight', mark: 'ND', href: '/draft/game' };
  const it = nightlyDraftItem(e, { id: 99, locksAt: '2026-10-20T23:00:00Z', games: 2, rounds: 3, picks: 0, locked: false }, { signedIn: true });
  assert.equal(`${it.title} · ${it.status}`, 'NBA Draft tonight · 2 games · locks 4:00 PM PT');
  assert.equal(it.href, '/draft/game/99');
  assert.deepEqual(it.progress, { done: 0, total: 3 });
  assert.equal(nightlyDraftItem(e, null), null, 'no room tonight, no card');
});

test('ESPN points: the standard table, no bonuses; the nightly board scores with it', async () => {
  const { espnLinePoints, espnFppg, ESPN_POINTS } = await import('../nba/fantasyPoints.js');
  assert.deepEqual({ ...ESPN_POINTS }, { pts: 1, fg3m: 1, fgm: 2, fga: -1, ftm: 1, fta: -1, reb: 1, ast: 2, stl: 4, blk: 4, tov: -2 });
  // 30 pts (10/20 FG, 3 3PM, 7/8 FT), 10 reb, 10 ast, 2 stl, 1 blk, 4 tov
  const row = { pts: 30, fgm: 10, fga: 20, fg3m: 3, ftm: 7, fta: 8, reb: 10, ast: 10, stl: 2, blk: 1, turnovers: 4 };
  assert.equal(espnLinePoints(row), 30 + 3 + 20 - 20 + 7 - 8 + 10 + 20 + 8 + 4 - 8);
  assert.equal(espnFppg({ gp: 0 }), null);
  assert.equal(espnFppg({ gp: 5, ...row, turnover: 4 }), 66);
});
