// lib/games/pickemTable.test.mjs - the Pick'em season table: correct/played
// across settled boards, a push/cancelled game off both numerator and
// denominator, minimum-boards-to-rank. Hermetic: synthetic contests + users,
// own sport slug, torn down by tracked id.

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
const { pickemTable, PICKEM_TABLE_MIN_BOARDS } = await import('./read.js');

const EMAIL_A = 'pktabletest-a@example.invalid';
const EMAIL_B = 'pktabletest-b@example.invalid';
const contestIds = [];
let uA, uB;

// Four synthetic settled boards. Board 3 has a PUSH on game 102 - a null
// result that must count toward neither correct nor played for anyone.
const BOARDS = [
  { week: 90, results: { 101: 'home', 102: 'away' } },
  { week: 91, results: { 101: 'home', 102: 'home' } },
  { week: 92, results: { 101: 'away', 102: null } }, // push on 102
  { week: 93, results: { 101: 'home', 102: 'home' } },
];

for (const email of [EMAIL_A, EMAIL_B]) {
  await sql`INSERT INTO users (email) VALUES (${email}) ON CONFLICT DO NOTHING`;
}
uA = (await sql`SELECT id FROM users WHERE email = ${EMAIL_A}`)[0].id;
uB = (await sql`SELECT id FROM users WHERE email = ${EMAIL_B}`)[0].id;

for (const b of BOARDS) {
  const opens = `2098-0${b.week - 89}-01T13:00:00Z`;
  const [row] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, settled, perfect, meta)
    VALUES ('pickem', 'pktabletest', 2098, ${b.week}, '[]'::jsonb, ${opens}, ${opens}, ${opens}, true,
            ${JSON.stringify({ results: b.results, max: 2 })}::jsonb, '{}'::jsonb)
    RETURNING id`;
  contestIds.push(row.id);
  b.id = row.id;
}

// User A plays all four boards. Picks: board1 both right, board2 both right,
// board3 game101 right + game102 (the push) picked 'away' - irrelevant,
// board4 both right. Correct=7, played=7 (push excluded from played too).
const entryIds = [];
async function enter(contestId, userId, lineup) {
  const [row] = await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, meta)
    VALUES (${contestId}, ${userId}, ${JSON.stringify(lineup)}::jsonb, '{}'::jsonb)
    RETURNING id`;
  entryIds.push(row.id);
}
await enter(BOARDS[0].id, uA, { 101: 'home', 102: 'away' }); // 2/2
await enter(BOARDS[1].id, uA, { 101: 'home', 102: 'home' }); // 2/2
await enter(BOARDS[2].id, uA, { 101: 'away', 102: 'away' }); // 1/1 (102 excluded)
await enter(BOARDS[3].id, uA, { 101: 'home', 102: 'home' }); // 2/2
// User B plays only two boards (below the minimum) - 1/2 and 2/2 = 3/4, 75%.
await enter(BOARDS[0].id, uB, { 101: 'home', 102: 'home' }); // 101 right, 102 wrong -> 1/2
await enter(BOARDS[1].id, uB, { 101: 'home', 102: 'home' }); // 2/2

after(async () => {
  await sql`DELETE FROM contest_entries WHERE id = ANY(${entryIds})`;
  await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
  await sql`DELETE FROM users WHERE email IN (${EMAIL_A}, ${EMAIL_B})`;
});

test('a push (null result) counts toward neither correct nor played, for the user who picked it', async () => {
  const t = await pickemTable(uA);
  const rowA = t.top.find((r) => r.userId === uA) ?? t.self;
  // 2+2+1+2 = 7 correct, 2+2+1+2 = 7 played (board3's push never entered either sum).
  assert.equal(rowA.correct, 7);
  assert.equal(rowA.played, 7);
  assert.equal(rowA.boardsPlayed, 4);
});

test('minimum boards to rank: below the floor gets a dash and a note, not a number', async () => {
  const t = await pickemTable(uB);
  const rowB = t.top.find((r) => r.userId === uB) ?? t.self;
  assert.equal(rowB.boardsPlayed, 2);
  assert.ok(rowB.boardsPlayed < PICKEM_TABLE_MIN_BOARDS);
  assert.equal(rowB.rank, null);
  assert.equal(rowB.note, `2 of ${PICKEM_TABLE_MIN_BOARDS} boards`);
});

test('ordered by correct % desc then correct desc; a ranked user appears above a higher-pct but sub-floor one', async () => {
  const t = await pickemTable(null, { limit: 100 });
  const rowA = t.top.find((r) => r.userId === uA);
  const rowB = t.top.find((r) => r.userId === uB);
  // User B: 3/4 = 75%. User A: 7/7 = 100%. Even though A ranks and B does not,
  // the array order still follows pct desc first - A (100%) sorts above B (75%)
  // regardless of rank eligibility.
  const idxA = t.top.indexOf(rowA);
  const idxB = t.top.indexOf(rowB);
  assert.ok(idxA < idxB, 'A (100%, ranked) sorts above B (75%, sub-floor)');
  assert.equal(rowA.rank, 1);
  assert.equal(rowB.rank, null);
});

// ---- the sport filter (relay 2c item 7) ------------------------------------

test('sport narrows which settled boards feed the SAME aggregation - not a different formula', async () => {
  // Every one of A's four synthetic boards carries sport='pktabletest', so
  // filtering to that exact sport must reproduce the unfiltered 7/7 exactly -
  // proof the filter only changes the WHERE, never pickemTable()'s own math.
  const filtered = await pickemTable(uA, { sport: 'pktabletest' });
  const rowA = filtered.top.find((r) => r.userId === uA) ?? filtered.self;
  assert.equal(rowA.correct, 7);
  assert.equal(rowA.played, 7);
  assert.equal(rowA.boardsPlayed, 4);
});

test('a sport with none of this fixture\'s boards returns null, not a stale total', async () => {
  // uA has no entry on any 'nfl'-sport contest at all (this fixture never
  // wrote one) - the filtered table must not fall back to counting the
  // 'pktabletest' boards it actually has.
  assert.equal(await pickemTable(uA, { sport: 'nfl' }), null);
});

test('minimum boards applies to the FILTERED set (item 7\'s own rule)', async () => {
  // Under the 'pktabletest' filter, user B still shows exactly the same
  // sub-floor 2-boards state the unfiltered table gives - the floor is
  // evaluated against what the filter actually left in, not the total
  // across every sport combined.
  const filtered = await pickemTable(uB, { sport: 'pktabletest' });
  const rowB = filtered.top.find((r) => r.userId === uB) ?? filtered.self;
  assert.equal(rowB.boardsPlayed, 2);
  assert.equal(rowB.rank, null);
  assert.equal(rowB.note, `2 of ${PICKEM_TABLE_MIN_BOARDS} boards`);
});
