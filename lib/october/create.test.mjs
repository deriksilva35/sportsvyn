// lib/october/create.test.mjs - the card's frozen starters reach its evening
// games (tue-4). Pure: the BDL day lookup is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardFor, probablesForRows, lateGames } from './create.js';
import { matchKey } from '../mlb/probables.js';

// Day 27 as it was created: one ET day, four games, two of them on the next
// UTC day.
const rows = [
  { match_id: 1, kickoff_at: '2026-09-29T18:00:00Z', away_abbr: 'PHI', home_abbr: 'ATL' },
  { match_id: 2, kickoff_at: '2026-09-29T21:00:00Z', away_abbr: 'CHW', home_abbr: 'HOU' },
  { match_id: 3, kickoff_at: '2026-09-30T00:00:00Z', away_abbr: 'BOS', home_abbr: 'NYY' },
  { match_id: 4, kickoff_at: '2026-09-30T02:00:00Z', away_abbr: 'CHC', home_abbr: 'SD' },
];
const p = (a, h) => [{ bdlGameId: 'x', gameDate: null, probables: { away: { id: '1', name: a }, home: { id: '2', name: h } } }];
const BDL = {
  '2026-09-29': new Map([[matchKey('PHI', 'ATL', '2026-09-29'), p('Jesus Luzardo', 'Chris Sale')],
    [matchKey('CHW', 'HOU', '2026-09-29'), p('Hagen Smith', 'AJ Blubaugh')]]),
  '2026-09-30': new Map([[matchKey('BOS', 'NYY', '2026-09-30'), p('Payton Tolle', 'Cam Schlittler')],
    [matchKey('CHC', 'SD', '2026-09-30'), p('Matthew Boyd', 'Michael King')]]),
};

test('EVERY GAME ON AN ET CARD GETS ITS STARTERS, the evening ones on the next UTC day included', async () => {
  const asked = [];
  const byDay = async (d) => { asked.push(d); return BDL[d] ?? new Map(); };
  const board = boardFor(rows, await probablesForRows(rows, { byDay }));
  assert.deepEqual(asked, ['2026-09-29', '2026-09-30'], 'each UTC day once');
  assert.deepEqual(board.map((g) => g.probables?.away?.name ?? null), ['Jesus Luzardo', 'Hagen Smith', 'Payton Tolle', 'Matthew Boyd'],
    'four of four - day 27 froze two');
});

test('A DAY THAT FAILS TO ANSWER COSTS ITS OWN GAMES ONLY', async () => {
  const byDay = async (d) => { if (d === '2026-09-30') throw new Error('BDL 503'); return BDL[d]; };
  const board = boardFor(rows, await probablesForRows(rows, { byDay }));
  assert.deepEqual(board.map((g) => g.probables != null), [true, true, false, false]);
});

// mon-11: 5 Oct's card held CHW @ CLE alone; NYY @ TB was imported after it.
test('A GAME ADDED AFTER THE CARD OPENED JOINS IT - only if it has not started', () => {
  const board = [{ match_id: 42533, kickoff_at: '2026-10-05T21:00:00.000Z' }];
  const day = [
    { match_id: 42533, kickoff_at: '2026-10-05T21:00:00Z' },
    { match_id: 42538, kickoff_at: '2026-10-06T00:00:00Z' },
  ];
  assert.deepEqual(lateGames(board, day, new Date('2026-10-05T17:30:00Z')).map((r) => r.match_id), [42538]);
  assert.deepEqual(lateGames(board, day, new Date('2026-10-06T00:05:00Z')), [], 'a started game never joins');
  assert.deepEqual(lateGames([...board, { match_id: '42538' }], day, new Date('2026-10-05T17:30:00Z')), [], 'already on: not twice (id types mixed)');
});

test('SOURCE: an existing day runs the late join, and the join drops the pool cache and stretches the lock', () => {
  const src = readFileSync(new URL('./create.js', import.meta.url), 'utf8');
  const exists = src.slice(src.indexOf('if (existing.length) {'), src.indexOf('if (!rows?.length)'));
  assert.match(exists, /joinLateGames\(/);
  const join = src.slice(src.indexOf('export async function joinLateGames'), src.indexOf('/** Every postseason day'));
  assert.match(join, /- 'pool'/, 'the cached pool is rebuilt with the new game');
  assert.match(join, /locks_at = \$\{last\.toISOString\(\)\}/);
  assert.match(join, /WHERE id = \$\{id\} AND board = /, 'guarded on the board it read');
});
