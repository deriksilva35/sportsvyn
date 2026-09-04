// scripts/daily-board-run-sentinel.mjs — prove the v2 run-submission path
// end to end (ensureBoardForDate -> submitRun -> UNIQUE-constraint refusal),
// then leave no trace. Committed because every future change to grading or
// to daily_board_runs wants exactly this run before it ships.
//
// A SENTINEL USER AND A SENTINEL EDITION, NEVER A REAL ONE. Seeding a real
// account's row to prove a write path is how a real player ends up with a
// fake score on their own history. The edition date is a synthetic far-
// future one (matching weeklyDb.test.mjs's 2097-2099 convention) so this can
// never collide with, or be mistaken for, a real board. Everything here is
// created by this script and deleted by it.
//
// Usage: set -a && . ./.env.local && set +a && node scripts/daily-board-run-sentinel.mjs
// DEV by default (DATABASE_URL); never point this at PROD_DATABASE_URL.

import { neon } from '@neondatabase/serverless';
import { ensureBoardForDate } from '../lib/daily/seasonBoardEditions.js';
import { submitRun } from '../lib/daily/seasonBoardRuns.js';
import { SLOTS } from '../lib/daily/boardShape.js';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set.'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
console.log('DB target:', new URL(process.env.DATABASE_URL).host);

const EDITION_DATE = '2098-04-01'; // synthetic, never a real edition
const EMAIL = `sentinel-daily-run-${Date.now()}@example.invalid`;
let userId = null;
let boardId = null;

async function teardown() {
  console.log('\n--- teardown ---');
  if (boardId) {
    const r = await sql`DELETE FROM daily_board_runs WHERE board_id = ${boardId} RETURNING id`;
    console.log(`  daily_board_runs deleted: ${r.length}`);
    await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
    console.log('  daily_boards deleted: 1');
  }
  if (userId) {
    await sql`DELETE FROM users WHERE id = ${userId}`;
    console.log('  users deleted: 1');
  }
}

try {
  const u = await sql`INSERT INTO users (email) VALUES (${EMAIL}) RETURNING id`;
  userId = u[0].id;
  console.log(`sentinel user id=${userId} (${EMAIL})`);

  const board = await ensureBoardForDate(sql, EDITION_DATE);
  boardId = board.id;
  console.log(`board id=${boardId} season=${board.season_year} ceiling=${board.ceiling}`);

  // Build a legal picks[] straight off the board's own frozen card - the
  // FIRST eligible player for each slot, in order, skipping a team already
  // used. Not meant to be a good roster, only a LEGAL one.
  const used = new Set();
  const picks = SLOTS.map((slot, slotIndex) => {
    for (const team of board.board) {
      if (used.has(team.key)) continue;
      const player = team.card.find((p) => {
        const alias = slot === 'K' ? 'PK' : slot;
        if (slot === 'FLEX') return ['RB', 'WR', 'TE'].includes(p.position);
        return p.position === alias;
      });
      if (player) { used.add(team.key); return { slotIndex, teamKey: team.key, playerName: player.name }; }
    }
    throw new Error(`sentinel could not fill slot ${slotIndex} (${slot}) - board has no legal player left`);
  });

  const first = await submitRun(sql, { boardId, userId, picks, elapsedS: 137, slots: SLOTS });
  console.log('\nfirst submit:', JSON.stringify(first.ok ? { ok: true, run: first.run } : first, null, 2));
  if (!first.ok) throw new Error(`sentinel run should have succeeded: ${first.reason}`);

  const second = await submitRun(sql, { boardId, userId, picks, elapsedS: 90, slots: SLOTS });
  console.log('\nsecond submit (must be refused, 409):', JSON.stringify(second, null, 2));
  if (second.ok || second.status !== 409) throw new Error('second submit for the same (board, user) must be refused with 409');

  console.log('\nSENTINEL PASSED: insert, grade, and one-run-per-user-per-board all verified.');
} finally {
  await teardown();
}
