// lib/run/board.test.mjs - the standing, and the member scope that makes a league
// board a league board.
//
// WHY IT EXISTS. app/run/board/runBoard.test.mjs stubs this reader
// ('export async function runBoard(){return rows;}'), so nothing there can see the
// SQL: deleting the member clause left the whole suite green. October's twin
// (lib/october/board.test.mjs) was written first and found exactly that; this is
// the same four cases against the game it was copied from.
//
// Sentinel rounds and sentinel users against DEV, deleted in after(), teardown
// asserting itself.

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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.join(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { runBoard } = await import('./board.js');
const { ROUNDS } = await import('./rules.js');

const MARK = fixtureMark('runboard');
const SEASON = 2096;                       // a season of its own, so nothing real is in frame
// WEEK IS THE ROUND INDEX, not a sentinel number. runBoard reads
// COALESCE(week, meta.roundIndex) and looks it up in ROUNDS, so week 91 resolves
// to no round at all and the row is skipped - which is how the first draft of this
// file reported every total as 0. idx_contests_week is unique on
// (game_type, sport, season_year, week) WHERE puzzle_date IS NULL, so the two
// sentinel rounds take two different weeks.
const WEEK = 1;                            // wild_card
const PREVIEW_WEEK = 2;                    // division, flagged preview
let contestId = null;
let previewContestId = null;
const users = [];

/** Nine filled slots - what makes an unsettled round read "set" rather than a dash. */
const NINE = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`slot${i + 1}`, { playerId: String(i + 1) }]));

before(async () => {
  for (const c of await sql`
    SELECT id FROM contests WHERE game_type = 'run' AND sport = 'mlb' AND season_year = ${SEASON}`) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${c.id}`;
    await sql`DELETE FROM contests WHERE id = ${c.id}`;
  }
  await sql`DELETE FROM users WHERE email LIKE ${MARK.like}`;
  for (const tag of ['a', 'b', 'c']) {
    const [u] = await sql`
      INSERT INTO users (email, handle) VALUES (${MARK.email(tag)}, ${MARK.handle(tag)}) RETURNING id, handle`;
    users.push(u);
  }
  const mk = async (week, meta) => (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at,
                          settled, settled_at, meta)
    VALUES ('run', 'mlb', ${SEASON}, ${week}, '[]'::jsonb,
            now() - interval '9 days', now() - interval '8 days', now() - interval '7 days',
            true, now() - interval '7 days', ${JSON.stringify(meta)}::jsonb)
    RETURNING id`)[0].id;
  contestId = await mk(WEEK, { round: 'wild_card' });

  // THREE SETTLED NINES, three different scores, so a filtered board is visibly a
  // subset rather than coincidentally the same rows.
  const scores = [45, 30, 15];
  for (let i = 0; i < users.length; i += 1) {
    await sql`
      INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, created_at, updated_at)
      VALUES (${contestId}, ${users[i].id}, ${JSON.stringify(NINE)}::jsonb, ${scores[i]}, ${scores[i]},
              ${JSON.stringify({ run: { state: 'complete' } })}::jsonb, now(), now())`;
  }
  previewContestId = await mk(PREVIEW_WEEK, { round: 'division', preview: true });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, created_at, updated_at)
    VALUES (${previewContestId}, ${users[0].id}, ${JSON.stringify(NINE)}::jsonb, 222, 222,
            ${JSON.stringify({ run: { state: 'complete' } })}::jsonb, now(), now())`;
});

after(async () => {
  const ids = users.map((u) => u.id);
  for (const id of [contestId, previewContestId].filter(Boolean)) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${id}`;
    await sql`DELETE FROM contests WHERE id = ${id}`;
  }
  await sql`DELETE FROM users WHERE id = ANY(${ids})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE id = ANY(${[contestId, previewContestId].filter(Boolean)})) AS contests,
           (SELECT count(*)::int FROM users WHERE id = ANY(${ids})) AS users`;
  assert.equal(left.contests, 0, 'both sentinel rounds are removed');
  assert.equal(left.users, 0, 'the sentinel users are removed');
});

const mine = (rows) => rows.filter((r) => users.some((u) => u.id === r.userId));
const who = (rows, i) => rows.find((r) => r.userId === users[i].id) ?? null;

test('EVERYONE: a null memberIds is the whole field', async () => {
  const rows = await runBoard(SEASON, { memberIds: null });
  const ours = mine(rows);
  assert.equal(ours.length, 3, 'all three sentinels are on the unfiltered board');
  assert.deepEqual(ours.map((r) => r.total).sort((a, b) => b - a), [45, 30, 15]);
  // AND THE ROUND CELL IS THE SETTLED POINTS, in its own column.
  assert.deepEqual(who(rows, 0).rounds[ROUNDS[0]], { kind: 'points', points: 45 });
});

test('A LEAGUE: memberIds scopes the board to its members, and excludes the rest', async () => {
  const two = [users[0].id, users[1].id];
  const rows = await runBoard(SEASON, { memberIds: two });
  const ours = mine(rows);
  assert.equal(ours.length, 2, 'two members, two rows');
  assert.deepEqual(ours.map((r) => r.userId).sort(), [...two].sort());
  // THE THIRD IS GONE - the assertion the mount test cannot make, because it
  // stubs this reader entirely.
  assert.equal(rows.some((r) => r.userId === users[2].id), false, 'a non-member is absent');
});

test('AN EMPTY LEAGUE IS AN EMPTY BOARD, not the world', async () => {
  // `[]` is truthy in JS, so a `memberIds ? ...` test happens to be right while
  // reading as though it were not. The reader uses `!= null`, and this is the
  // behaviour that rule protects: a league nobody has joined shows nobody.
  assert.deepEqual(await runBoard(SEASON, { memberIds: [] }), [], 'no rows at all');
});

test('ONE ENTRY, ANY NUMBER OF LEAGUES: the same nine, the same total, on every board', async () => {
  // A league holds MEMBERS, not entries, so the same row appears on every board
  // its owner belongs to. Rank is the BOARD's - first of one, first of two - which
  // is the point of a league board.
  const alone = await runBoard(SEASON, { memberIds: [users[0].id] });
  const withB = await runBoard(SEASON, { memberIds: [users[0].id, users[1].id] });
  assert.equal(who(alone, 0).total, who(withB, 0).total, 'one entry, one total');
  assert.deepEqual(who(alone, 0).rounds, who(withB, 0).rounds, 'and one set of round cells');
  assert.equal(who(alone, 0).rank, 1);
  assert.equal(who(withB, 0).rank, 1);
  assert.equal(who(withB, 1).rank, 2, 'the second member ranks against the first');
});

test('A PREVIEW ROUND AND A REAL ROUND NEVER SUM', async () => {
  const post = await runBoard(SEASON, { memberIds: null });                   // preview defaults false
  const prev = await runBoard(SEASON, { memberIds: null, preview: true });
  assert.equal(who(post, 0).total, 45, "the postseason board is the postseason's 45");
  assert.equal(who(prev, 0).total, 222, "the preview board is the preview's 222");
  assert.notEqual(who(post, 0).total, 267, 'and never the two added together');
  assert.equal(mine(post).length, 3);
  assert.equal(mine(prev).length, 1, 'the preview round has one nine in it');
  // AND IT LANDS IN ITS OWN COLUMN - week 2 is the division round.
  assert.deepEqual(who(prev, 0).rounds[ROUNDS[1]], { kind: 'points', points: 222 });
});
