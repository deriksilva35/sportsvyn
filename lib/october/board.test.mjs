// lib/october/board.test.mjs - the standing, and the member scope that makes a
// league board a league board.
//
// AGAINST DEV, with sentinel rows. The mount test at
// app/october/board/octoberBoard.test.mjs stubs this reader, so nothing there can
// see the SQL - and a first draft of the filter was deleted as a mutation check
// and the whole suite stayed green. This file is what catches that.

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
const { octoberBoard } = await import('./board.js');

const MARK = fixtureMark('octboard');
const DAY = '2097-10-11';
const PREVIEW_DAY = '2097-09-11';
const SEASON = 2097;
let contestId = null;
let previewContestId = null;
const users = [];

before(async () => {
  // A run that died before its teardown leaves the sentinel day behind, and
  // (game_type, sport, puzzle_date) is UNIQUE.
  for (const c of await sql`SELECT id FROM contests WHERE game_type = 'october' AND sport = 'mlb' AND puzzle_date = ANY(${[DAY, PREVIEW_DAY]})`) {
    await sql`DELETE FROM contest_entries WHERE contest_id = ${c.id}`;
    await sql`DELETE FROM contests WHERE id = ${c.id}`;
  }
  await sql`DELETE FROM users WHERE email LIKE ${MARK.like}`;
  for (const tag of ['a', 'b', 'c']) {
    const [u] = await sql`
      INSERT INTO users (email, handle) VALUES (${MARK.email(tag)}, ${MARK.handle(tag)}) RETURNING id, handle`;
    users.push(u);
  }
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board, opens_at, locks_at, settles_at,
                          settled, settled_at, meta)
    VALUES ('october', 'mlb', ${SEASON}, ${DAY}, '[]'::jsonb,
            now() - interval '2 days', now() - interval '1 day', now() - interval '1 day',
            true, now() - interval '1 day', '{"stage":"wild_card"}'::jsonb)
    RETURNING id`;
  contestId = c.id;
  // THREE SETTLED CARDS, three different scores, so a filtered board is visibly
  // a subset rather than coincidentally the same rows.
  const scores = [30, 20, 10];
  for (let i = 0; i < users.length; i += 1) {
    await sql`
      INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, created_at, updated_at)
      VALUES (${contestId}, ${users[i].id}, '{}'::jsonb, ${scores[i]}, ${scores[i]},
              ${JSON.stringify({ october: { state: 'complete' } })}::jsonb, now(), now())`;
  }
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
  assert.equal(left.contests, 0, 'both sentinel days are removed');
  assert.equal(left.users, 0, 'the sentinel users are removed');
});

const mine = (rows) => rows.filter((r) => users.some((u) => u.id === r.userId));

test('EVERYONE: a null memberIds is the whole field', async () => {
  const rows = await octoberBoard(SEASON, { memberIds: null });
  const ours = mine(rows);
  assert.equal(ours.length, 3, 'all three sentinels are on the unfiltered board');
  assert.deepEqual(ours.map((r) => r.total).sort((a, b) => b - a), [30, 20, 10]);
});

test('A LEAGUE: memberIds scopes the board to its members, and excludes the rest', async () => {
  const two = [users[0].id, users[1].id];
  const rows = await octoberBoard(SEASON, { memberIds: two });
  const ours = mine(rows);
  assert.equal(ours.length, 2, 'two members, two rows');
  assert.deepEqual(ours.map((r) => r.userId).sort(), [...two].sort());
  // THE THIRD IS GONE - the assertion the mount test cannot make, because it
  // stubs this reader entirely.
  assert.equal(rows.some((r) => r.userId === users[2].id), false, 'a non-member is absent');
});

test('ONE ENTRY, ANY NUMBER OF LEAGUES: the same card, the same number, on every board', async () => {
  // THE RULING. A league holds MEMBERS, not entries, so user[0] reads identically
  // from two different memberships - there is one entry and nothing to keep in
  // step. Rank is relative to the board, which is the point of a league board;
  // the SCORE is the reader's own and must not move.
  const alone = await octoberBoard(SEASON, { memberIds: [users[0].id] });
  const withB = await octoberBoard(SEASON, { memberIds: [users[0].id, users[1].id] });
  const a1 = alone.find((r) => r.userId === users[0].id);
  const a2 = withB.find((r) => r.userId === users[0].id);
  assert.ok(a1 && a2);
  assert.equal(a1.total, a2.total, 'one entry, one total');
  assert.equal(a1.days, a2.days);
  assert.equal(a1.todayPoints, a2.todayPoints);
  // AND THE RANK IS THE BOARD'S, not the entry's: first of one, first of two.
  assert.equal(a1.rank, 1);
  assert.equal(a2.rank, 1);
});

test('A PREVIEW DAY AND A REAL DAY NEVER SUM', async () => {
  // THE SAME SEASON_YEAR, TWO TOURNAMENTS. September's preview and October's
  // postseason share a season, so without the meta.preview scope a reader's
  // preview cards would be added to their wild-card total and the board would
  // report a number nobody played for. The clause is runBoard's own.
  //
  // A SECOND SENTINEL DAY, this one flagged preview, with a DIFFERENT score for
  // the same reader - so a board that summed the two would be visibly wrong
  // rather than coincidentally right.
  const [pc] = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board, opens_at, locks_at, settles_at,
                          settled, settled_at, meta)
    VALUES ('october', 'mlb', ${SEASON}, ${PREVIEW_DAY}, '[]'::jsonb,
            now() - interval '4 days', now() - interval '3 days', now() - interval '3 days',
            true, now() - interval '3 days', '{"stage":"wild_card","preview":true}'::jsonb)
    RETURNING id`;
  previewContestId = pc.id;
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, score, base_score, meta, created_at, updated_at)
    VALUES (${pc.id}, ${users[0].id}, '{}'::jsonb, 111, 111,
            ${JSON.stringify({ october: { state: 'complete' } })}::jsonb, now(), now())`;

  const post = await octoberBoard(SEASON, { memberIds: null });               // preview defaults false
  const prev = await octoberBoard(SEASON, { memberIds: null, preview: true });
  const a = (rows) => rows.find((r) => r.userId === users[0].id) ?? null;

  assert.equal(a(post).total, 30, "the postseason board is the postseason's 30");
  assert.equal(a(prev).total, 111, "the preview board is the preview's 111");
  assert.notEqual(a(post).total, 141, 'and never the two added together');
  // THE OTHER TWO ARE ONLY ON THE POSTSEASON BOARD - the preview day has one card.
  assert.equal(post.filter((r) => users.some((u) => u.id === r.userId)).length, 3);
  assert.equal(prev.filter((r) => users.some((u) => u.id === r.userId)).length, 1);
  // AND THE SCOPES COMPOSE: a league inside the preview is still the preview.
  const both = await octoberBoard(SEASON, { memberIds: [users[0].id], preview: true });
  assert.equal(a(both).total, 111);
});

test('AN EMPTY LEAGUE IS AN EMPTY BOARD, not the world', async () => {
  // `[]` is truthy in JS, so a `memberIds ? ...` test happens to be right while
  // reading as though it were not. The reader uses `!= null`, and this is the
  // behaviour that rule protects: a league nobody has joined shows nobody.
  const rows = await octoberBoard(SEASON, { memberIds: [] });
  assert.deepEqual(rows, [], 'no rows at all');
});
