// lib/daily/shareCardData.test.mjs - the share card from real DEV rows: an
// OPEN board's card carries no pick at all; a CLOSED board's card carries every
// pick with its star; a reader with no submitted run gets no card. Sentinel
// boards far from any real edition, sentinel players, all removed in after().

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMark } from '../testing/fixtureMark.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.join(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { ensureBoardForDate } = await import('./seasonBoardEditions.js');
const { startRun, submitRun } = await import('./seasonBoardRuns.js');
const { shareCardFor, consecutiveDays } = await import('./shareCardData.js');

const MARK = fixtureMark('sharecard');
const mmdd = `${String(1 + (process.pid % 12)).padStart(2, '0')}-${String(1 + (process.pid % 28)).padStart(2, '0')}`;
const OPEN_DATE = `2093-${mmdd}`;   // closes in 2093: open
const CLOSED_DATE = `2019-${mmdd}`; // closed long ago - written with startRun/submitRun's own `now`
const ids = { boards: [], users: [] };
const boards = {};

async function play(board, userId, picks, now = null) {
  const at = now ? new Date(new Date(board.closes_at).getTime() - 3600_000).toISOString() : null;
  assert.equal((await startRun(sql, { boardId: board.id, userId, now: at })).ok, true);
  const r = await submitRun(sql, { boardId: board.id, userId, picks, elapsedS: 60, now: at });
  assert.equal(r.ok, true, r.reason ?? '');
}

before(async () => {
  for (const d of [OPEN_DATE, CLOSED_DATE]) {
    for (const b of await sql`SELECT id FROM daily_boards WHERE edition_date = ${d}`) {
      await sql`DELETE FROM daily_board_runs WHERE board_id = ${b.id}`;
      await sql`DELETE FROM daily_boards WHERE id = ${b.id}`;
    }
    boards[d] = await ensureBoardForDate(sql, d);
    ids.boards.push(boards[d].id);
  }
  for (const k of ['reader', 'stranger']) {
    await sql`DELETE FROM users WHERE email = ${MARK.email(k)}`;
    ids.users.push((await sql`INSERT INTO users (email, handle) VALUES (${MARK.email(k)}, ${MARK.handle(k)}) RETURNING id`)[0].id);
  }
  const [reader] = ids.users;
  for (const d of [OPEN_DATE, CLOSED_DATE]) {
    const b = boards[d];
    const best = b.best_roster.map((x, slotIndex) => ({ slotIndex, teamKey: x.teamKey, playerName: x.name }));
    // half the perfect roster, half empty: four stars after close
    const half = best.map((p, i) => (i % 2 === 0 ? p : { slotIndex: i, teamKey: null, playerName: null }));
    await play(b, reader, half, d === CLOSED_DATE);
  }
});

after(async () => {
  await sql`DELETE FROM daily_board_runs WHERE board_id = ANY(${ids.boards})`;
  await sql`DELETE FROM daily_boards WHERE id = ANY(${ids.boards})`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM daily_boards WHERE id = ANY(${ids.boards}))
         + (SELECT count(*)::int FROM users WHERE id = ANY(${ids.users})) AS n`;
  assert.equal(left.n, 0, 'the sentinels are gone');
});

test('OPEN board: the card is the hidden one - no player, team or slot points from the run', async () => {
  const m = await shareCardFor(sql, { date: OPEN_DATE, userId: ids.users[0] });
  assert.equal(m.phase, 'open');
  assert.equal(m.season, String(boards[OPEN_DATE].season_year));
  assert.equal(m.slots.length, boards[OPEN_DATE].slots.length);
  const wire = JSON.stringify(m);
  for (const p of boards[OPEN_DATE].best_roster) {
    assert.ok(!wire.includes(p.name), `a perfect-lineup name reached the open card: ${p.name}`);
    const last = String(p.name).split(' ').slice(1).join(' ');
    if (last.length > 3) assert.ok(!wire.includes(last), `a surname reached the open card: ${last}`);
  }
  assert.equal(m.rankLine, null, 'one finisher is no field');
  assert.equal(m.streak, 1);
});

test('CLOSED board: every pick, a star on each one in the perfect lineup, % of perfect', async () => {
  const m = await shareCardFor(sql, { date: CLOSED_DATE, userId: ids.users[0] });
  assert.equal(m.phase, 'closed');
  assert.equal(m.rows.length, 8);
  assert.equal(m.starCount, 4);
  assert.deepEqual(m.rows.map((r) => r.star), [true, false, true, false, true, false, true, false]);
  assert.ok(m.rows.filter((r) => r.star).every((r) => r.name && r.points));
  assert.ok(/^\d{1,3}%$/.test(m.pctLabel), m.pctLabel);
  assert.equal(m.streak, 1, 'the streak as of THAT edition');
});

test('no submitted run, no card; a malformed date, no card', async () => {
  assert.equal(await shareCardFor(sql, { date: OPEN_DATE, userId: ids.users[1] }), null);
  assert.equal(await shareCardFor(sql, { date: '2026-1-1', userId: ids.users[0] }), null);
  assert.equal(await shareCardFor(sql, { date: OPEN_DATE, userId: null }), null);
});

test('consecutiveDays counts back from the edition, across a month end, and stops at a gap', () => {
  assert.equal(consecutiveDays(['2026-10-01', '2026-09-30', '2026-09-29', '2026-09-27'], '2026-10-01'), 3);
  assert.equal(consecutiveDays(['2026-10-02'], '2026-10-01'), 0, 'a later run does not count');
  assert.equal(consecutiveDays([], '2026-10-01'), 0);
});
