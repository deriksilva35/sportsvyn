// lib/settle/voidRulings2.test.mjs - ruling sun-12, PURE.
// (a) Six, EPL Weekly 5 and NBA day boards whose every game is void close as
//     VOID (the gates say so); (b) a Run pick in a voided game is released.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleGate as sixGate } from '../six/settle.js';
import { settleGate as epl5Gate } from '../eplWeekly5/settle.js';
import { dayResults } from '../nba/dayPickem.js';
import { burnedFrom } from '../run/pool.js';
import { VOID_ALL_LABEL } from './voidRule.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('SIX: every game void -> allVoid with every id; one final game -> not allVoid', () => {
  const board = [{ match_id: 1 }, { match_id: 2 }];
  const byId = new Map([['1', { status: 'postponed' }], ['2', { status: 'cancelled' }]]);
  const g = sixGate(board, byId, new Map());
  assert.deepEqual([g.ready, g.allVoid, g.voided], [true, true, [1, 2]]);
  const mixed = sixGate(board, new Map([['1', { status: 'postponed' }], ['2', { status: 'final' }]]), new Map([['2:9', {}]]));
  assert.deepEqual([mixed.ready, mixed.allVoid], [true, false]);
  assert.equal(sixGate([], new Map(), new Map()).allVoid, false, 'an empty board is not all-void');
});

test('EPL WEEKLY 5: every fixture off -> allVoid; a final one -> not', () => {
  const board = [{ match_id: 1, slug: 'a' }, { match_id: 2, slug: 'b' }];
  const g = epl5Gate(board, new Map([['1', { status: 'postponed' }], ['2', { status: 'moved' }]]), new Date());
  assert.deepEqual([g.ready, g.allVoid, g.voided], [true, true, [1, 2]]);
  const m = epl5Gate(board, new Map([['1', { status: 'postponed' }], ['2', { status: 'final', resync_at: 'x' }]]), new Date());
  assert.deepEqual([m.ready, m.allVoid], [true, false]);
});

test('NBA DAY: every game void is complete with every id voided, which settleDayBoard closes as VOID', () => {
  const r = dayResults([{ match_id: 1 }, { match_id: 2 }], new Map([[1, { status: 'postponed' }], [2, { status: 'cancelled' }]]));
  assert.deepEqual([r.complete, r.voided], [true, [1, 2]]);
  const s = src('../nba/dayPickem.js');
  const fn = s.slice(s.indexOf('export async function settleDayBoard'), s.indexOf('export async function refreshDayBoardLocks'));
  assert.match(fn, /r\.voided\.length === board\.length/);
  assert.match(fn, /closeVoidAll\(sql, contest\.id, r\.voided\)/);
});

test('every closer routes through closeVoidAll, and the Six re-grade skips void_all', () => {
  assert.match(src('../six/settle.js'), /if \(gate\.allVoid\) \{[\s\S]{0,400}closeVoidAll\(sql, contest\.id, gate\.voided\)/);
  assert.match(src('../six/settle.js'), /AND settled\s+-- AN ALL-VOID[^\n]*\n\s+AND NOT COALESCE\(\(meta->>'void_all'\)::boolean, false\)/);
  assert.match(src('../eplWeekly5/settle.js'), /if \(gate\.allVoid && !contest\.settled\) \{[\s\S]{0,400}closeVoidAll\(sql, contest\.id, gate\.voided\)/);
  assert.match(src('../eplWeekly5/settle.js'), /contest\.meta\?\.void_all === true\) return \{ contestId: contest\.id, settled: true, skipped: 'void_all' \}/);
  assert.equal(VOID_ALL_LABEL, 'Void - no games were played');
});

// ---------------------------------------------------------------------------
// (b) THE RUN: a pick in a voided game is released
// ---------------------------------------------------------------------------
const teamsOf = new Map([[100, [1, 2]], [101, [3, 4]], [102, [3, 5]]]);
const round = (over) => ({ round: 'world_series', lineup: {}, settled: true, void_ids: [], match_ids: [100, 101], void_all: false, ...over });

test('a pick whose club played ONLY void games in a settled round is released; the rest of the roster stays burned', () => {
  const r = round({
    void_ids: [101],
    lineup: { bat1: { playerId: '10', teamId: 1 }, bat2: { playerId: '30', teamId: 3 }, bat3: { playerId: '40', teamId: 4 } },
  });
  const used = burnedFrom([r], teamsOf);
  assert.deepEqual([...used.keys()].sort(), ['10'], 'club 1 played a counted game; clubs 3 and 4 played only the void one');
});

test('a club with a void game AND a counted game in the round stays burned', () => {
  const r = round({ match_ids: [100, 101, 102], void_ids: [101], lineup: { bat1: { playerId: '30', teamId: 3 } } });
  assert.deepEqual([...burnedFrom([r], teamsOf).keys()], ['30']);
});

test('a void_all round releases its whole roster; an unsettled round burns as before', () => {
  const lineup = { bat1: { playerId: '10', teamId: 1 }, bat2: { playerId: '30', teamId: 3 } };
  assert.equal(burnedFrom([round({ void_all: true, void_ids: [100, 101], lineup })], teamsOf).size, 0);
  const open = round({ settled: false, void_ids: [101], lineup });
  assert.deepEqual([...burnedFrom([open], teamsOf).keys()].sort(), ['10', '30'], 'a void is decided at settle, never guessed');
  // Released in one round, spent in a later one: burned, by the later round.
  const later = { ...round({ round: 'later', void_ids: [], lineup: { bat1: { playerId: '30', teamId: 3 } } }) };
  const used = burnedFrom([round({ void_ids: [101], lineup: { bat2: { playerId: '30', teamId: 3 } } }), later], teamsOf);
  assert.equal(used.get('30'), 'later');
});
