// lib/daily/boardsDb.test.mjs - the leak rule, proved against the database.
//
// standings.test.mjs proves the ARITHMETIC cannot move when it is handed only
// revealed rows. This file proves the QUERIES never hand it anything else -
// which is the half that can actually regress, because it is one forgotten
// `AND d.revealed` away.
//
// THE PROOF: insert a rival with a locked, scored entry on an OPEN day, and
// assert the overall standings are byte-identical before and after. If the
// filter is ever dropped, the rival's tier points appear and this fails.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { overall, dayBoard, lastRevealedDate } = await import('./boards.js');
const { seasonKeyFor } = await import('./standings.js');

const RIVAL_EMAIL = 'leaktest-rival@example.invalid';
let rivalId = null;
let openDay = null;

async function cleanup() {
  if (rivalId) {
    await sql`DELETE FROM puzzle_entries WHERE user_id = ${rivalId}`;
    await sql`DELETE FROM handle_history WHERE user_id = ${rivalId}`;
    await sql`DELETE FROM users WHERE id = ${rivalId}`;
    rivalId = null;
  }
}
after(cleanup);

test('SETUP: there is a revealed day and an open day to test against', async () => {
  const revealed = await lastRevealedDate();
  const open = await sql`
    SELECT to_char(puzzle_date, 'YYYY-MM-DD') d FROM puzzle_days
     WHERE NOT revealed ORDER BY puzzle_date LIMIT 1`;
  openDay = open[0]?.d ?? null;
  assert.ok(revealed, 'need at least one revealed day');
  assert.ok(openDay, 'need at least one open day');
});

test('THE LAW: a locked rival entry on an OPEN day does not move the standings', async () => {
  const season = seasonKeyFor(openDay);
  const before = await overall(null, 50, season);

  const ins = await sql`
    INSERT INTO users (email, handle) VALUES (${RIVAL_EMAIL}, 'leaktestrival')
    ON CONFLICT DO NOTHING RETURNING id`;
  rivalId = ins[0]?.id
    ?? (await sql`SELECT id FROM users WHERE email = ${RIVAL_EMAIL}`)[0].id;

  // A locked, scored entry on a day that has NOT been revealed. In tier terms
  // this is a HALL OF FAME - the biggest possible move - so if the filter is
  // missing, the delta is unmissable.
  await sql`
    INSERT INTO puzzle_entries (user_id, puzzle_date, lineup, score, base_score, bonus_pct, locked_at)
    VALUES (${rivalId}, ${openDay}::date, '{}'::jsonb, 9999, 9999, 0, now())
    ON CONFLICT (user_id, puzzle_date) DO UPDATE SET score = 9999, locked_at = now()`;

  const after2 = await overall(null, 50, season);
  assert.deepEqual(after2.top, before.top, 'the top must be byte-identical');
  assert.equal(after2.players, before.players, 'the rival must not even be counted');
  assert.equal(after2.through, before.through, 'and the through-date must not move');
  assert.equal(
    after2.top.some((r) => r.userId === rivalId), false,
    'a rival who has locked an open day is invisible until midnight',
  );
});

test('THE LAW: the day board refuses an OPEN day outright', async () => {
  // Not "returns the rival muted" - the rows never leave the database.
  const b = await dayBoard(openDay, null, 25);
  assert.equal(b, null, 'an open day has no public board at all');
});

test('the rival DOES appear once their day is revealed - the filter is not just "hide everyone"', async () => {
  // The negative control. A test that passes because the board is always empty
  // would prove nothing, so this proves the same query does return the row when
  // the day is legitimately closed.
  const revealed = await lastRevealedDate();
  await sql`
    INSERT INTO puzzle_entries (user_id, puzzle_date, lineup, score, base_score, bonus_pct, locked_at)
    VALUES (${rivalId}, ${revealed}::date, '{}'::jsonb, 1, 1, 0, now())
    ON CONFLICT (user_id, puzzle_date) DO UPDATE SET score = 1, locked_at = now()`;

  const board = await dayBoard(revealed, null, 100);
  assert.ok(board, 'a revealed day has a board');
  assert.ok(
    board.top.concat(board.self ? [board.self] : []).some((r) => r.userId === rivalId)
      || board.entries > 0,
    'the revealed entry is visible',
  );
  // Scoped to the season the revealed day actually belongs to. DEV's oldest
  // board is 2026-08-15, which predates season one's 2026-08-16 start - the
  // PROD epoch - so it lands in the prior season. Asserting the default key
  // here would test the fixture's calendar rather than the filter.
  const after2 = await overall(null, 50, seasonKeyFor(revealed));
  assert.ok(after2.players >= 1, 'and it now counts toward the standings');
  assert.ok(after2.top.some((r) => r.userId === rivalId), 'the rival is in the table');
});

test('handles render on the board, unclaimed accounts render as Player <hex>', async () => {
  const revealed = await lastRevealedDate();
  const board = await dayBoard(revealed, null, 100);
  const rows = board.top.concat(board.self ? [board.self] : []);
  for (const r of rows) {
    assert.ok(r.name, 'every row has a display name');
    assert.ok(
      r.name.startsWith('@') || /^Player [0-9a-f]{4}$/.test(r.name),
      `unexpected display name: ${r.name}`,
    );
    assert.equal(/^Player #?\d+$/.test(r.name), false, 'never a raw user id');
  }
});
