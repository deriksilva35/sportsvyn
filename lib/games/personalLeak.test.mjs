// lib/games/personalLeak.test.mjs - the personal-history leak law, at the query.
//
// ============================================================================
// THE ASSERTION THIS FILE EXISTS FOR
// ============================================================================
// The same reader, with and without a LOCKED entry on an OPEN day, must
// serialize BYTE-IDENTICALLY. Not "no other player's score leaks" - stronger:
// the reader's OWN in-flight result contributes nothing to their record until
// the day closes.
//
// Everywhere else on the site, your own open-day score is yours to see - the
// Daily's receipt shows it to you before midnight. Here it must not appear,
// because these are STANDINGS. An average that moved when you locked at 9am, a
// streak that already counted today, a "played 12/11" - each would disagree
// with the leaderboard one pane away, and a reader who spots that stops
// trusting every number on the page rather than just the wrong one.
//
// A byte comparison is used deliberately over a field-by-field check. A new
// field carrying today's entry would slip past a list of names somebody thought
// of in advance; it cannot slip past two strings that must match exactly.
//
// ============================================================================
// TWO GUARDS, AND EITHER ONE ALONE IS ENOUGH - VERIFIED, NOT ASSUMED
// ============================================================================
// read.js protects this twice over:
//   1. the entry query JOINs `AND pd.revealed`, so an open day's entry never
//      enters the map at all;
//   2. the history rows return early on `!r.revealed` (a sealed row is built
//      before youCell is reached) and yourStats is handed
//      `days.filter(r => r.revealed)`.
//
// Breaking EITHER ONE ALONE leaves these tests green, because the other still
// filters - which is the correct behaviour for defence in depth and a trap for
// anyone verifying it. Removing the `pd.revealed` join looks like it should
// fail this file and does not. Breaking BOTH fails test 1 by name, and
// attaching a YOU cell to sealed rows fails test 2. Those are the controls that
// mean something; a green run after a single-guard edit proves nothing.

import { test, before, after } from 'node:test';
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
const { gamesLobby } = await import('./read.js');

// SCOPED TO THIS FILE'S OWN ADDRESS. node --test runs files in parallel, and a
// teardown that owns a namespace it did not create reaches into another suite.
const EMAIL = 'personalleak@example.invalid';
// Dates far enough out that no real board can collide with them.
const REVEALED = ['2031-03-03', '2031-03-04', '2031-03-05'];
const OPEN = '2031-03-06';
let uid = null;

// THE HISTORY PANE READS THE SEASON BOARD NOW (the Daily has a yesterday):
// daily_boards + daily_board_runs. Three CLOSED editions and one OPEN one,
// dated where no real edition can collide, closed by closes_at, not by date.
// The v1 puzzle_days fixture below stays: the STATS module still reads v1,
// deliberately, and tests 3 pins that.
const V2_CLOSED = ['2001-03-03', '2001-03-04', '2001-03-05'];
const V2_OPEN = '2001-03-06';
const SLOTS8 = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
const BEST = SLOTS8.map((slot, i) => ({ slot, teamKey: `T${i}`, abbr: `T${i}`, name: `Best ${i}`, points: 12.5, meta: '', position: slot === 'FLEX' ? 'WR' : slot === 'K' ? 'PK' : slot }));
const EMPTY_PICKS = SLOTS8.map((_, i) => ({ slotIndex: i, teamKey: null, playerName: null }));
const v2Ids = {};

const board = [
  { id: 1, name: 'A', pos: 'QB', points: 30 }, { id: 2, name: 'B', pos: 'RB', points: 20 },
  { id: 3, name: 'C', pos: 'WR', points: 20 }, { id: 4, name: 'D', pos: 'TE', points: 10 },
  { id: 5, name: 'E', pos: 'RB', points: 10 }, { id: 6, name: 'F', pos: 'WR', points: 10 },
];
const lineup = { QB: 1, RB: 2, WR: 3, TE: 4, FLEX: 5, FLEX2: 6 };

before(async () => {
  const u = await sql`INSERT INTO users (email) VALUES (${EMAIL})
    ON CONFLICT DO NOTHING RETURNING id`;
  uid = u[0]?.id ?? (await sql`SELECT id FROM users WHERE email = ${EMAIL}`)[0].id;

  for (const [i, d] of REVEALED.entries()) {
    await sql`
      INSERT INTO puzzle_days (puzzle_date, season_year, week, seed, board, perfect,
                               opens_at, closes_at, revealed)
      VALUES (${d}, ${2018 + i}, ${i + 1}, ${`leak-${d}`}, ${JSON.stringify(board)}::jsonb,
              ${JSON.stringify({ total: 100 })}::jsonb,
              ${`${d}T04:00:00Z`}, ${`${d}T04:00:00Z`}, true)
      ON CONFLICT (puzzle_date) DO UPDATE SET revealed = true`;
    await sql`
      INSERT INTO puzzle_entries (user_id, puzzle_date, lineup, score, locked_at, guess_season, guess_week)
      VALUES (${uid}, ${d}, ${JSON.stringify(lineup)}::jsonb, ${70 + i * 5},
              now(), ${2018 + i}, ${i + 1})
      ON CONFLICT (user_id, puzzle_date) DO UPDATE SET score = EXCLUDED.score`;
  }
  // The open day itself. NOT revealed - this is the day whose entry must vanish.
  await sql`
    INSERT INTO puzzle_days (puzzle_date, season_year, week, seed, board, perfect,
                             opens_at, closes_at, revealed)
    VALUES (${OPEN}, 1999, 17, ${`leak-${OPEN}`}, ${JSON.stringify(board)}::jsonb,
            ${JSON.stringify({ total: 100 })}::jsonb,
            ${`${OPEN}T04:00:00Z`}, ${`${OPEN}T04:00:00Z`}, false)
    ON CONFLICT (puzzle_date) DO UPDATE SET revealed = false`;

  // v2 seeding lives in THIS hook, after uid is resolved - a second before()
  // is not guaranteed to run after the first, and once ran before it.
  for (const [i, d] of [...V2_CLOSED, V2_OPEN].entries()) {
    const closesAt = d === V2_OPEN ? '2099-01-01T05:00:00Z' : `${d}T05:00:00Z`;
    const [b] = await sql`
      INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, opens_at, closes_at)
      VALUES (${d}, ${1990 + i}, ${`leak-v2-${d}`}, '[]'::jsonb, 100, ${JSON.stringify(BEST)}::jsonb, ${`${d}T04:00:00Z`}, ${closesAt})
      ON CONFLICT (edition_date) DO UPDATE SET closes_at = EXCLUDED.closes_at RETURNING id`;
    v2Ids[d] = b.id;
    if (d !== V2_OPEN) {
      await sql`
        INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s, started_at, completed_at)
        VALUES (${b.id}, ${uid}, ${JSON.stringify(EMPTY_PICKS)}::jsonb, ${70 + i * 5}, ${(70 + i * 5) / 100}, 0, 60, now(), now())
        ON CONFLICT (board_id, user_id) DO UPDATE SET score = EXCLUDED.score, picks = EXCLUDED.picks`;
    }
  }
});


after(async () => {
  await sql`DELETE FROM daily_board_runs WHERE user_id = ${uid}`;
  await sql`DELETE FROM daily_boards WHERE edition_date = ANY(${[...V2_CLOSED, V2_OPEN]})`;
  await sql`DELETE FROM puzzle_entries WHERE user_id = ${uid}`;
  await sql`DELETE FROM puzzle_days WHERE puzzle_date = ANY(${[...REVEALED, OPEN]})`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
});

// The open-day entry, on BOTH systems: v1 for the stats module, v2 for history.
const withoutOpenEntry = async () => {
  await sql`DELETE FROM puzzle_entries WHERE user_id = ${uid} AND puzzle_date = ${OPEN}`;
  await sql`DELETE FROM daily_board_runs WHERE user_id = ${uid} AND board_id = ${v2Ids[V2_OPEN]}`;
};
const withOpenEntry = async (score) => {
  await sql`
    INSERT INTO puzzle_entries (user_id, puzzle_date, lineup, score, locked_at, guess_season, guess_week)
    VALUES (${uid}, ${OPEN}, ${JSON.stringify(lineup)}::jsonb, ${score}, now(), 1999, 17)
    ON CONFLICT (user_id, puzzle_date) DO UPDATE SET score = EXCLUDED.score, locked_at = now()`;
  await sql`
    INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s, started_at, completed_at)
    VALUES (${v2Ids[V2_OPEN]}, ${uid}, ${JSON.stringify(EMPTY_PICKS)}::jsonb, ${score}, ${score / 100}, 0, 60, now(), now())
    ON CONFLICT (board_id, user_id) DO UPDATE SET score = EXCLUDED.score, picks = EXCLUDED.picks`;
};

// ---------------------------------------------------------------------------

test('BYTE-IDENTICAL: a locked OPEN-day entry changes nothing in history or stats', async () => {
  await withoutOpenEntry();
  const before2 = await gamesLobby(uid);

  await withOpenEntry(99.9);
  const after2 = await gamesLobby(uid);

  // Compare only the surfaces this ruling governs. The Daily's own card and
  // module SHOULD change - that is the receipt, and it is the reader's to see.
  const slice = (v) => JSON.stringify({ history: v.history, stats: v.stats });
  assert.equal(slice(after2), slice(before2),
    'the reader\'s own open-day entry reached the history rows or the record');
});

test('the open day is present as a SEALED row in both cases, carrying nothing', async () => {
  await withOpenEntry(99.9);
  const v = await gamesLobby(uid);
  const row = v.history.find((h) => h.date === V2_OPEN);
  assert.ok(row, 'the day exists and the row proves it');
  assert.equal(row.sealed, true);
  assert.equal('you' in row, false, 'a sealed row has no YOU cell to fill');
  assert.equal('season' in row, false);
  assert.equal(JSON.stringify(row).includes('99.9'), false, 'the score must not ride along');
});

test('the record counts only revealed days, however many open ones exist', async () => {
  await withOpenEntry(99.9);
  const v = await gamesLobby(uid);
  // Three revealed days were seeded for this user and they played all three.
  // playable counts every revealed day in the database, so assert the
  // relationship rather than a number another suite's fixtures could move.
  assert.ok(v.stats.played >= 3, `expected at least the 3 seeded plays, got ${v.stats.played}`);
  assert.ok(v.stats.played <= v.stats.playable, 'played can never exceed playable');
  assert.equal(v.stats.best.score >= 80, true, 'the seeded 80 is the best of the three');
  assert.notEqual(v.stats.best.score, 99.9, 'today\'s score is not a personal best yet');
});

test('a SIGNED-OUT reader gets no YOU column and no record at all', async () => {
  const v = await gamesLobby(null);
  assert.equal(v.stats, null, 'no reader, no record');
  for (const h of v.history) {
    assert.equal('you' in h, false, `${h.date} carries a YOU cell for nobody`);
  }
  // And the absence must survive serialization - `you: undefined` is still a
  // key in memory, so only the serialized form proves the column is gone.
  //
  // SCOPED TO history AND stats, deliberately. A whole-payload grep for "you"
  // also catches cardState's own `you` field, which is a different thing this
  // ruling does not govern - a leak test that fires on an unrelated field is
  // one somebody eventually loosens.
  assert.equal(JSON.stringify(v.history).includes('"you"'), false);
  assert.equal(JSON.stringify({ stats: v.stats }), '{"stats":null}');
});

test('the YOU column appears for a signed-in reader, on revealed rows only', async () => {
  await withoutOpenEntry();
  const v = await gamesLobby(uid);
  const revealed = v.history.filter((h) => !h.sealed);
  assert.ok(revealed.length >= 3);
  for (const h of revealed) assert.ok('you' in h, `${h.date} is missing its YOU cell`);
  const seeded = v.history.find((h) => h.date === V2_CLOSED[2]);
  assert.ok(seeded, 'the seeded closed edition is in history');
  assert.equal(seeded.you.played, true);
  assert.equal(seeded.you.score, 80);
  assert.equal(seeded.href, `/daily/board/${V2_CLOSED[2]}`, 'the row links to its results');
  // v1 days are OUT of this pane, by ruling.
  assert.equal(v.history.find((h) => h.date === REVEALED[2]), undefined, 'a v1 day must not appear in history');
});
