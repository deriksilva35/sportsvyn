import test from 'node:test';
import assert from 'node:assert/strict';
import { cardLine } from './cardLine.js';
import { cardLine as emailCardLine } from '../email/morningModules.js';
import { shapeBestRoster, extrasOf } from './boardShape.js';
import { indexSource, backfillBoard } from './backfillGames.js';
import { gradeFromOptimum } from './seasonBoardGrade.js';

test('the email and the result screen share ONE formatter', () => {
  assert.equal(emailCardLine, cardLine);
});

test('line format: season line, K XP only if stored, /wk only with games', () => {
  assert.equal(cardLine('3224 yds · 25 TD', { position: 'QB', points: 307.1, games: 16 }), '3,224 yds · 25 TD · 19.2/wk');
  assert.equal(cardLine('3224 yds · 25 TD', { position: 'QB', points: 307.1, games: null }), '3,224 yds · 25 TD');
  assert.equal(cardLine('3224 yds · 25 TD', { position: 'QB', points: 307.1, games: 0 }), '3,224 yds · 25 TD');
  assert.equal(cardLine('29/34 FG', { position: 'PK', points: 140, games: 16, xp: 41 }), '29/34 FG · 41 XP · 8.8/wk');
  assert.equal(cardLine('29/34 FG', { position: 'PK', points: 140, games: 16 }), '29/34 FG · 8.8/wk');
  assert.equal(cardLine('29/34 FG', { position: 'PK', points: 140 }), '29/34 FG');
  assert.equal(cardLine(''), null);
});

test('extrasOf keeps games, and xp for kickers only', () => {
  assert.deepEqual(extrasOf({ position: 'QB', games: 16, xp: 3 }), { games: 16 });
  assert.deepEqual(extrasOf({ position: 'PK', games: 16, xp: 41 }), { games: 16, xp: 41 });
  assert.deepEqual(extrasOf({ position: 'PK', games: null, xp: null }), {});
});

test('shapeBestRoster carries games/xp from a raw solver entry and passes a flat one through', () => {
  const raw = [{ slot: 'K', teamKey: 'KC', player: { raw_name: 'A Kicker', position: 'PK', points: 100, fgm: 29, fga: 34, games: 16, xp: 41 } }];
  const [e] = shapeBestRoster(raw);
  assert.equal(e.games, 16); assert.equal(e.xp, 41);
  const flat = { slot: 'K', name: 'A Kicker', games: 16, xp: 41 };
  assert.equal(shapeBestRoster([flat])[0], flat);
});

test('backfill: exactly one match fills games; none or several leaves the entry alone; idempotent', () => {
  const src = indexSource([
    { raw_name: 'Pat Q', team_key: 'KC', position: 'QB', games: 15, xp: null },
    { raw_name: 'Twin', team_key: 'KC', position: 'WR', games: 10, xp: null },
    { raw_name: 'Twin', team_key: 'KC', position: 'WR', games: 12, xp: null },
    { raw_name: 'Kay', team_key: 'KC', position: 'PK', games: 16, xp: 41 },
  ]);
  const board = {
    best_roster: [
      { slot: 'QB', teamKey: 'KC', abbr: 'KC', name: 'Pat Q', points: 300, meta: '4000 yds · 30 TD', position: 'QB' },
      { slot: 'WR', teamKey: 'KC', abbr: 'KC', name: 'Twin', points: 200, meta: '', position: 'WR' },
      { slot: 'K', teamKey: 'KC', abbr: 'KC', name: 'Kay', points: 140, meta: '29/34 FG', position: 'PK' },
    ],
    board: [{ key: 'KC', card: [{ position: 'QB', name: 'Pat Q', meta: 'x', points: 300 }, { position: 'WR', name: 'Twin', meta: 'y', points: 1 }] }],
  };
  const r = backfillBoard(board, src);
  assert.equal(r.best_roster[0].games, 15);
  assert.equal(r.best_roster[1].games, undefined, 'two matches: absent');
  assert.deepEqual([r.best_roster[2].games, r.best_roster[2].xp], [16, 41]);
  assert.equal(r.board[0].card[0].games, 15);
  assert.equal(r.board[0].card[1].games, undefined);
  assert.equal(r.withGames, 2);
  const again = backfillBoard({ best_roster: r.best_roster, board: r.board }, src);
  assert.equal(again.changed, false);
  assert.equal(Array.isArray(r.best_roster), true, 'still an array');
});

test('the grader carries games/xp on both sides so the result screen can print /wk', () => {
  const slots = ['QB', 'K'];
  const play = {
    slots, used: [],
    roster: [
      { pos: 'QB', pick: { teamKey: 'KC', player: { name: 'Pat Q', points: 300, meta: '4000 yds · 30 TD', position: 'QB', games: 15 } } },
      { pos: 'K', pick: { teamKey: 'KC', player: { name: 'Kay', points: 140, meta: '29/34 FG', position: 'PK', games: 16, xp: 41 } } },
    ],
  };
  const optimum = { total: 440, bySlot: [
    { slot: 'QB', teamKey: 'KC', name: 'Pat Q', points: 300, meta: '4000 yds · 30 TD', position: 'QB', games: 15 },
    { slot: 'K', teamKey: 'KC', name: 'Kay', points: 140, meta: '29/34 FG', position: 'PK', games: 16, xp: 41 },
  ] };
  const g = gradeFromOptimum(play, [], optimum, slots);
  assert.equal(cardLine(g.rows[1].best.meta, g.rows[1].best), '29/34 FG · 41 XP · 8.8/wk');
  assert.equal(cardLine(g.rows[0].you.meta, g.rows[0].you), '4,000 yds · 30 TD · 20.0/wk');
});
