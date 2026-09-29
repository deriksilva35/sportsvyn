// lib/october/create.test.mjs - the card's frozen starters reach its evening
// games (tue-4). Pure: the BDL day lookup is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardFor, probablesForRows } from './create.js';
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
