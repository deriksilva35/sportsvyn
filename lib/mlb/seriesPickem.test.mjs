// lib/mlb/seriesPickem.test.mjs - the round board: the scorer, the gate, the
// lock, and the settle against the database.
//
// THE POINTS LADDER IS THE WHOLE POINT of this file. The football scorer
// counts one per correct pick because every CFB game is worth the same; a
// World Series pick made eleven days earlier is not worth a Wild Card pick,
// and a scorer that quietly fell back to counting would look perfectly
// healthy - every entry would just be wrong by a factor nobody notices.

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
const {
  isSeriesBoard, boardFromSeries, scoreSeriesLineup, maxPoints,
  weekForStage, stageForWeek, saveSeriesPick, seriesResultsFor,
} = await import('./seriesPickem.js');
const { shapeSeries } = await import('./series.js');
const { settleDuePickem } = await import('../pickem/settle.js');

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/postseason2025.json', import.meta.url), 'utf8'));
const SERIES = shapeSeries(ROWS);
const wcBoard = () => boardFromSeries(SERIES.filter((s) => s.stage === 'wild_card'));

// ---------------------------------------------------------------- pure

test('a round is a week key, 1 through 4, in bracket order', () => {
  assert.deepEqual(['wild_card', 'division', 'championship', 'world_series'].map(weekForStage), [1, 2, 3, 4]);
  assert.equal(stageForWeek(1), 'wild_card');
  assert.equal(stageForWeek(4), 'world_series');
  assert.equal(stageForWeek(5), null);
  assert.equal(weekForStage('group'), null, 'a World Cup stage is not a round of this bracket');
});

test('IS THIS A SERIES BOARD is asked of the BOARD, not of the sport', () => {
  assert.equal(isSeriesBoard(wcBoard()), true);
  // A football board - the settle path must not mistake one for the other.
  assert.equal(isSeriesBoard([{ match_id: 1, slug: 'x', kickoff_at: 'z' }]), false);
  assert.equal(isSeriesBoard([]), false);
  assert.equal(isSeriesBoard(null), false);
});

test('THE BOARD IS THE ROUND, with the round\'s points on every entry', () => {
  const wc = wcBoard();
  assert.equal(wc.length, 4);
  assert.ok(wc.every((b) => b.points === 1));
  assert.ok(wc.every((b) => b.best_of === 3));
  assert.equal(maxPoints(wc), 4);
  // In first-pitch order, so the board reads the way the round is played.
  assert.deepEqual([...wc].map((b) => b.first_pitch).sort(), wc.map((b) => b.first_pitch));

  const ws = boardFromSeries(SERIES.filter((s) => s.stage === 'world_series'));
  assert.equal(ws.length, 1);
  assert.equal(ws[0].points, 4);
  assert.equal(ws[0].best_of, 7);
  assert.equal(maxPoints(ws), 4, 'one series worth four is the same total as four worth one');

  // THE KEY IS THE SERIES KEY, never a match id - a match_id would have keyed
  // the pick to ONE GAME of a best-of-seven.
  assert.ok(wc.every((b) => /^wild_card:[A-Z]+-[A-Z]+$/.test(b.series_key)));
  assert.ok(wc.every((b) => b.match_id === undefined));
});

test('POINTS BY ROUND, not one per pick', () => {
  const div = boardFromSeries(SERIES.filter((s) => s.stage === 'division'));
  const results = {};
  for (const b of div) results[b.series_key] = b.teams[0].team_id;
  // All four right in the Division round is EIGHT, not four.
  assert.deepEqual(scoreSeriesLineup(results, results, div), { points: 8, correct: 4 });
  assert.equal(maxPoints(div), 8);

  // One right, three wrong.
  const one = { [div[0].series_key]: div[0].teams[0].team_id };
  assert.deepEqual(scoreSeriesLineup(one, results, div), { points: 2, correct: 1 });

  // A wrong pick scores nothing, and a no-pick scores nothing by absence.
  const wrong = { [div[0].series_key]: div[0].teams[1].team_id };
  assert.deepEqual(scoreSeriesLineup(wrong, results, div), { points: 0, correct: 0 });
  assert.deepEqual(scoreSeriesLineup({}, results, div), { points: 0, correct: 0 });
});

test('THE COMPARISON IS ON STRINGS, or every postseason pick grades as a loss', () => {
  // A lineup comes back out of jsonb and a winner out of an integer column.
  // 6979 === "6979" is false, and nothing about the board would look broken.
  const board = [{ series_key: 'k', points: 3, teams: [{ team_id: 6979 }, { team_id: 6984 }] }];
  assert.deepEqual(scoreSeriesLineup({ k: '6979' }, { k: 6979 }, board), { points: 3, correct: 1 });
  assert.deepEqual(scoreSeriesLineup({ k: 6979 }, { k: '6979' }, board), { points: 3, correct: 1 });
  assert.deepEqual(scoreSeriesLineup({ k: null }, { k: 6979 }, board), { points: 0, correct: 0 });
  assert.deepEqual(scoreSeriesLineup({ k: 6979 }, { k: null }, board), { points: 0, correct: 0 });
});

test('A SERIES WITH A SIDE MISSING IS NOT ON THE BOARD', () => {
  // It cannot be rendered as two sides and cannot be picked, and a board
  // entry nobody can answer is a silent points cap rather than a game.
  const broken = [{ ...SERIES[0], teams: [{ id: null, abbreviation: null }, SERIES[0].teams[1]] }];
  assert.deepEqual(boardFromSeries(broken), []);
});

// ------------------------------------------------------------ database

const EMAIL = `sentinel-mlbseries-${process.pid}@example.invalid`;
let userId = null; let contestId = null;

before(async () => {
  // users.email carries no unique constraint on this database, so the
  // sentinel is looked up and only inserted when it is genuinely absent -
  // ON CONFLICT (email) names an index that does not exist and throws.
  const [found] = await sql`SELECT id FROM users WHERE email = ${EMAIL} LIMIT 1`;
  userId = found?.id ?? (await sql`
    INSERT INTO users (email, created_at) VALUES (${EMAIL}, now()) RETURNING id`)[0].id;
  // A SENTINEL BOARD WITH A REAL WINDOW. The 2025 fixture's boards open and
  // lock at the same instant - correct for a round already played, useless for
  // proving a save - so this one is the same four series with the clock moved
  // forward. season 2025 so seriesResultsFor finds the real, decided series.
  const board = wcBoard();
  const [c] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', 'mlb', 2025, 91, ${JSON.stringify(board)}::jsonb,
            now() - interval '1 day', now() + interval '1 day', now() + interval '8 days',
            ${JSON.stringify({ stage: 'wild_card', series_board: true, max_points: maxPoints(board) })}::jsonb)
    RETURNING id`;
  contestId = c.id;
});

after(async () => {
  if (contestId) await sql`DELETE FROM contest_entries WHERE contest_id = ${contestId}`;
  if (contestId) await sql`DELETE FROM contests WHERE id = ${contestId}`;
  if (userId) await sql`DELETE FROM contest_entries WHERE user_id = ${userId}`;
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
});

test('THE SAVE IS A DOOR WITH FOUR LOCKS ON IT', async () => {
  const [c] = await sql`SELECT board, locks_at FROM contests WHERE id = ${contestId}`;
  const b = c.board[0];

  const ok = await saveSeriesPick(userId, contestId, b.series_key, b.teams[0].team_id);
  assert.equal(ok.ok, true);

  // A CLUB THAT IS NOT IN THE SERIES. Without this an arbitrary id saves, is
  // never equal to a winner, and grades as a loss the picker cannot explain.
  const alien = await saveSeriesPick(userId, contestId, b.series_key, 999999);
  assert.deepEqual(alien, { ok: false, reason: 'not_in_series' });

  const offBoard = await saveSeriesPick(userId, contestId, 'wild_card:AAA-BBB', b.teams[0].team_id);
  assert.deepEqual(offBoard, { ok: false, reason: 'not_on_board' });

  // THE LOCK IS THE ROUND'S, not the series'. `<=` at the boundary instant.
  const late = await saveSeriesPick(userId, contestId, b.series_key, b.teams[1].team_id,
    { now: new Date(c.locks_at) });
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'round_locked');

  // AND NONE OF THE THREE REFUSALS CHANGED THE STORED PICK.
  const [e] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  assert.deepEqual(e.lineup, { [b.series_key]: b.teams[0].team_id });
});

test('A ROUND SETTLES WHEN EVERY SERIES IS DECIDED, and pays in the round\'s points', async () => {
  const [c] = await sql`SELECT board, season_year FROM contests WHERE id = ${contestId}`;
  // Three right, one wrong - a maximum would not prove the scorer counted.
  const r = await seriesResultsFor(c.board, c.season_year);
  assert.equal(r.complete, true, 'the 2025 wild card is decided');
  for (const [i, b] of c.board.entries()) {
    const right = b.teams.find((t) => String(t.team_id) === String(r.results[b.series_key]));
    const wrong = b.teams.find((t) => String(t.team_id) !== String(r.results[b.series_key]));
    await saveSeriesPick(userId, contestId, b.series_key, (i === 3 ? wrong : right).team_id);
  }

  const res = await settleDuePickem({ now: new Date() });
  const mine = res.results.find((x) => x.contestId === contestId);
  assert.deepEqual(mine, { contestId, settled: true, entries: 1 });

  const [e] = await sql`SELECT score, base_score FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  assert.equal(Number(e.score), 3, 'three wild card series at one point each');
  assert.equal(Number(e.base_score), 3);

  const [after2] = await sql`SELECT settled, perfect FROM contests WHERE id = ${contestId}`;
  assert.equal(after2.settled, true);
  assert.equal(after2.perfect.max, 4);
  assert.deepEqual(after2.perfect.results, r.results, 'the settle stores the map that counted');
});

test('AN UNDECIDED ROUND REFUSES, and a sweep does not hang it', async () => {
  // THE GATE IS "EVERY SERIES DECIDED", NOT "EVERY GAME FINAL" - which is the
  // one rule that could not be reused from the football board. A sweep leaves
  // three scheduled games that will never be played; waiting for them would
  // hang the board forever.
  const nlcs = SERIES.find((s) => s.key === 'championship:LAD-MIL');
  assert.equal(nlcs.gameCount, 4);
  assert.equal(nlcs.bestOf, 7, 'three of its seven were never played');
  assert.equal(nlcs.winner != null, true);

  // A board naming a series we hold no games for cannot complete.
  const r = await seriesResultsFor([{ series_key: 'division:AAA-BBB', stage: 'division', points: 2 }], 2025);
  assert.equal(r.complete, false);
  assert.equal(r.remaining, 1);
  assert.equal(r.results, null);
});
