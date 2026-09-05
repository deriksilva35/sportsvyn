// lib/pickem/boardNumber.test.mjs - the board number embarrassment fix.
//
// Board number is 1 + the count of pickem contests whose opens_at is earlier
// than this one's - computed once in currentPickemBoard(), never typed
// downstream. Hermetic: three synthetic pickem contests, far-future dates so
// they can never collide with a real board's ordering, torn down by id.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { currentPickemBoard, pickemCardData } = await import('./entry.js');

const createdIds = [];

// Three boards, far-future so they never collide with any real ordering.
// EMPTY board jsonb: currentPickemBoard() itself never touches board.length.
// week is part of contests' own (game_type, sport, season_year, week) unique
// key - one distinct week per synthetic board, same as three real weekly
// pickem boards would be.
const BOARDS = [
  { week: 1, opens: '2099-01-01T13:00:00Z', locks: '2099-01-04T00:00:00Z' },
  { week: 2, opens: '2099-01-08T13:00:00Z', locks: '2099-01-11T00:00:00Z' },
  { week: 3, opens: '2099-01-15T13:00:00Z', locks: '2099-01-18T00:00:00Z' },
];

for (const b of BOARDS) {
  const [row] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, settled, meta)
    VALUES ('pickem', 'boardnumtest', 2099, ${b.week}, '[]'::jsonb, ${b.opens}, ${b.locks}, ${b.locks}, false, '{}'::jsonb)
    RETURNING id`;
  createdIds.push(row.id);
  b.id = row.id;
}

after(async () => {
  await sql`DELETE FROM contests WHERE id = ANY(${createdIds})`;
});

test('the first synthetic board (earliest opens_at among ALL pickem contests) is Board 1', async () => {
  // now = just after board A opens, before B exists yet.
  const c = await currentPickemBoard({ now: new Date('2099-01-02T00:00:00Z') });
  assert.equal(c.id, BOARDS[0].id);
  assert.equal(c.board_number, 1);
});

test('the second board is Board 2 - one earlier pickem contest counted', async () => {
  const c = await currentPickemBoard({ now: new Date('2099-01-09T00:00:00Z') });
  assert.equal(c.id, BOARDS[1].id);
  assert.equal(c.board_number, 2);
});

test('the third board is Board 3', async () => {
  const c = await currentPickemBoard({ now: new Date('2099-01-16T00:00:00Z') });
  assert.equal(c.id, BOARDS[2].id);
  assert.equal(c.board_number, 3);
});

test('pickemCardData carries the same boardNumber - one computation, not two', async () => {
  const card = await pickemCardData(null, { now: new Date('2099-01-09T00:00:00Z') });
  assert.equal(card.boardNumber, 2);
});
