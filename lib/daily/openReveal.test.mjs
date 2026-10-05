// lib/daily/openReveal.test.mjs - the Daily while the day is open (1b, 27 Sep).
//
// THE RULING UNDER TEST: before closes_at a finished run sees its own slots,
// its total, its rank among finished runs, "you beat X%", its streak and a
// board of finished runs - and NOTHING that names the answer: no best roster,
// no ceiling, no pct, no matched, no hit marks, nobody else's picks. The
// /results/daily reader is null until close. The cards themselves reach the
// client only after a start is recorded.
//
// A REAL EDITION ON DEV: ensureBoardForDate draws one for a far-future date
// (so it is open, and no real edition can collide), two sentinel players
// start and submit through the real startRun/submitRun, a third starts and
// never submits. Everything is deleted by id; the teardown verifies itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../testing/nextResolve.mjs';
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
})(path.resolve(REPO, '.env.local'));
install();

const { sql } = await import('../db.js');
const { ownRows, beatPct, openBoardRows, sealedTeams, openRevealFor } = await import('./openReveal.js');
const { ensureBoardForDate } = await import('./seasonBoardEditions.js');
const { startRun, submitRun } = await import('./seasonBoardRuns.js');
const { dailyResults } = await import('../results/daily.js');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every key anywhere in a value, so "no best roster on the wire" is checked, not assumed. */
function keysOf(v, out = new Set()) {
  if (Array.isArray(v)) { for (const x of v) keysOf(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}
const FORBIDDEN = ['best', 'ceiling', 'perfect', 'pct', 'matched', 'matchedCount', 'hit', 'glyph', 'best_roster', 'picks', 'bestRosterAbbrs', 'pointsLeft'];

// ---------------------------------------------------------------------------
// the pure core
// ---------------------------------------------------------------------------

test('ownRows keeps the run\'s own side of each grade row and drops the best side', () => {
  const grade = { rows: [{ hit: true, you: { slot: 'QB', name: 'A', abbr: 'CAR', points: 329.54 }, best: { name: 'A', points: 329.54 } }] };
  assert.deepEqual(ownRows(grade), [{ slot: 'QB', name: 'A', team: 'CAR', points: 329.5 }]);
});

test('beat-%: strictly below among the OTHER finished runs, rounded down; nobody else is null', () => {
  assert.equal(beatPct([100], 100), null, 'first to finish: no field yet');
  assert.equal(beatPct([100, 90, 80, 100], 100), 66, 'a tie is not a win: 2 of 3 others');
  assert.equal(beatPct([100, 200], 100), 0);
});

test('the open board breaks a tied score by finish time, never by matched', () => {
  const rows = openBoardRows([
    { userId: 1, handle: '@late', primary: 50, rank: '1', secondary: 8, completedAt: '2097-01-01T10:00:00Z' },
    { userId: 2, handle: '@early', primary: 50, rank: '1', secondary: 2, completedAt: '2097-01-01T09:00:00Z' },
  ]);
  assert.deepEqual(rows.map((r) => r.userId), [2, 1]);
  assert.equal(keysOf(rows).has('secondary'), false, 'matched (secondary) is not carried');
});

test('sealed teams carry keys and no card - nothing to solve before Start', () => {
  const t = sealedTeams([{ key: 'CAR', abbr: 'CAR', card: [{ name: 'X', points: 300, meta: '3869 yds' }] }]);
  assert.deepEqual(t, [{ key: 'CAR', abbr: 'CAR', record: null, card: [] }]);
});

// ---------------------------------------------------------------------------
// the composition on DEV
// ---------------------------------------------------------------------------

const MARK = fixtureMark('openreveal');
const EDITION = `2095-${String(1 + (process.pid % 12)).padStart(2, '0')}-${String(1 + (process.pid % 28)).padStart(2, '0')}`;
const ids = { board: null, users: [] };
let board = null;

before(async () => {
  for (const b of await sql`SELECT id FROM daily_boards WHERE edition_date = ${EDITION}`) {
    await sql`DELETE FROM daily_board_runs WHERE board_id = ${b.id}`;
    await sql`DELETE FROM daily_boards WHERE id = ${b.id}`;
  }
  board = await ensureBoardForDate(sql, EDITION);
  ids.board = board.id;
  for (const k of ['perfect', 'partial', 'dnf']) {
    await sql`DELETE FROM users WHERE email = ${MARK.email(k)}`;
    ids.users.push((await sql`INSERT INTO users (email, handle) VALUES (${MARK.email(k)}, ${MARK.handle(k)}) RETURNING id`)[0].id);
  }
  const best = board.best_roster.map((b, slotIndex) => ({ slotIndex, teamKey: b.teamKey, playerName: b.name }));
  const partial = best.map((p, i) => (i < 4 ? p : { slotIndex: i, teamKey: null, playerName: null }));
  for (const [i, picks] of [[0, best], [1, partial]]) {
    assert.equal((await startRun(sql, { boardId: board.id, userId: ids.users[i] })).ok, true);
    const r = await submitRun(sql, { boardId: board.id, userId: ids.users[i], picks, elapsedS: 60 });
    assert.equal(r.ok, true, `submit ${i}: ${r.reason ?? ''}`);
  }
  assert.equal((await startRun(sql, { boardId: board.id, userId: ids.users[2] })).ok, true);
});

after(async () => {
  await sql`DELETE FROM daily_board_runs WHERE board_id = ${ids.board}`;
  await sql`DELETE FROM daily_boards WHERE id = ${ids.board}`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM daily_boards WHERE id = ${ids.board})
         + (SELECT count(*)::int FROM users WHERE id = ANY(${ids.users})) AS n`;
  assert.equal(left.n, 0, 'the sentinels are gone');
});

const runOf = async (uid) => (await sql`SELECT * FROM daily_board_runs WHERE board_id = ${ids.board} AND user_id = ${uid}`)[0];

test('OPEN DAY: the finished run gets its slots, total, rank, beat-% - and no key that names the answer', async () => {
  const [perfect, partial] = ids.users;
  const r = await openRevealFor(sql, { board, run: await runOf(partial), userId: partial, editionDate: EDITION });
  assert.equal(r.rows.length, board.slots.length, 'all eight slots, empties included');
  assert.equal(r.rows.filter((x) => x.name != null).length, 4);
  assert.equal(r.rank, 2); assert.equal(r.of, 2, 'the unsubmitted run is not on the board');
  assert.equal(r.beatPct, 0);
  const leaked = FORBIDDEN.filter((k) => keysOf(r).has(k));
  assert.deepEqual(leaked, [], `answer-bearing keys on the wire: ${leaked.join(', ')}`);
  assert.deepEqual([...keysOf(r.board.head)].sort(), ['house', 'name', 'points', 'rank', 'userId'], 'board rows: handle, score, rank');
  const top = await openRevealFor(sql, { board, run: await runOf(perfect), userId: perfect, editionDate: EDITION });
  assert.equal(top.rank, 1); assert.equal(top.beatPct, 100);
});

test('/results/daily is NULL while the edition is open - best roster and ?who= included - and whole at close', async () => {
  const [perfect, partial] = ids.users;
  assert.equal(await dailyResults(ids.board, partial), null, 'open: nothing, for the reader');
  assert.equal(await dailyResults(ids.board, perfect), null, 'nor for ?who=<another user>');
  assert.equal(await dailyResults(ids.board, null), null, 'nor signed out');
  await sql`UPDATE daily_boards SET closes_at = now() - interval '1 minute' WHERE id = ${ids.board}`;
  const closed = await dailyResults(ids.board, partial);
  assert.ok(closed && closed.ceiling.length === board.slots.length, 'closed: the perfect roster, as before');
  await sql`UPDATE daily_boards SET closes_at = ${board.closes_at} WHERE id = ${ids.board}`;
});

test('THE SCREEN: the reveal draws the rank, the beat line, eight slots and the pinned row', async () => {
  const [, partial] = ids.users;
  const reveal = await openRevealFor(sql, { board, run: await runOf(partial), userId: partial, editionDate: EDITION });
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { JSDOM } = await import('jsdom');
  const OpenReveal = (await import('../../components/daily/season/OpenReveal.js')).default;
  const html = renderToStaticMarkup(React.createElement(OpenReveal, { edition: `The Daily · ${EDITION}`, reveal, refreshMs: null }));
  const d = new JSDOM(`<div id="r">${html}</div>`).window.document;
  const t = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  assert.equal(t(d.querySelector('.lb-you-rk b')), '#2');
  assert.equal(t(d.querySelector('.lb-you-rk span')), "you beat 0% of today's players");
  assert.equal(d.querySelectorAll('.dr-slot').length, board.slots.length);
  const rows = [...d.querySelectorAll('.dr-table .lb-row:not(.hd)')];
  assert.equal(rows.length, 2);
  assert.equal(rows[1].classList.contains('you'), true);
  assert.doesNotMatch(html, /perfect roster was|🟩|⬛/, 'no grade language, no hit glyph');
});

// ---------------------------------------------------------------------------
// the wiring
// ---------------------------------------------------------------------------

test('the page seals the cards on every pre-start branch and serves the reveal, not the grade, while open', () => {
  const p = stripComments(src('app/daily/board/page.js'));
  const sealed = (p.match(/teams=\{sealedTeams\(board\.board\)\}/g) ?? []).length;
  assert.equal(sealed, 3, 'signed out, never started, and the open reveal');
  // AND NO SEASON YEAR on the same three branches (27 Sep): a year narrows the
  // board to one real season, which is what the card points are.
  assert.equal((p.match(/year=\{null\} teams=\{sealedTeams\(board\.board\)\}/g) ?? []).length, 3, 'no year before Start');
  const full = (p.match(/teams=\{board\.board\}/g) ?? []).length;
  assert.equal(full, 2, 'only a resumed run and a closed receipt carry the cards');
  const open = p.indexOf('existing.picks != null && !closed');
  assert.ok(open > 0 && p.indexOf('openRevealFor(', open) > open, 'the open branch reads the reveal');
  assert.ok(p.slice(open, p.indexOf('if (existing && existing.picks != null) {', open)).includes('openReveal={reveal}'));
  assert.ok(!p.slice(open, p.indexOf('if (existing && existing.picks != null) {', open)).includes('initialGrade'), 'and no grade');
  assert.match(p, /closed \? todayLeaderboard\(sql, board\.id\) : Promise\.resolve\(null\)/, 'the DNF branch sees the board only after close');
});

test('start hands over the cards; submit answers with the reveal before it would with a grade', () => {
  const s = stripComments(src('app/api/daily/board/start/route.js'));
  assert.match(s, /teams: board\.board/);
  assert.match(s, /year: String\(board\.season_year\)/, 'the season arrives with the cards');
  const r = stripComments(src('app/api/daily/board/run/route.js'));
  const already = r.indexOf("r.reason === 'already ran this board'");
  assert.ok(r.indexOf('openResponse(boardId', already) > already, 'already-ran: the reveal first');
  const fresh = r.lastIndexOf('openResponse(boardId');
  assert.ok(fresh < r.indexOf('grade: r.grade'), 'fresh submit: the reveal before the grade');
  const b = stripComments(src('components/daily/season/SeasonBoard.js'));
  assert.match(b, /setTeams\(body\.teams\)/, 'the client swaps in the cards from the start response');
  assert.match(b, /if \(body\.year\) setYear\(String\(body\.year\)\)/, 'and the season');
  assert.match(b, /<h2>\{year \?\? '\?\?\?\?'\}<\/h2>/, 'the rules card shows no year until then');
  // The share prop (relay mon-12) rides along; the refresh stays the default.
  const mount = /<OpenReveal\s+edition=\{edition\} reveal=\{openReveal \?\? revealState\}[^>]*\/>/.exec(b);
  assert.ok(mount, 'OpenReveal is mounted with the page\'s reveal, else the submit\'s');
  assert.doesNotMatch(mount[0], /refreshMs/, 'mounted with its default refresh (the screen test turns it off)');
  assert.ok(b.indexOf('body?.open && body?.reveal') < b.indexOf('!body?.grade'), 'and reads an open response before looking for a grade');
});
