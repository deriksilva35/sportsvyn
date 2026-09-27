// lib/boards/live.test.mjs - the always-on public boards, COMPOSED.
//
// THE PATH UNDER TEST is the one a live Sunday takes: a box score lands stat
// rows -> the poller's snapshotLiveBoards() (the exact call services/
// live-poller/index.mjs makes after a box score that changed something) ->
// the page's read, gameBoard() -> boardView() -> the rendered LiveBoard. Every
// hop is the real module against DEV; only the clock is given.
//
// SENTINELS, NOT THE LIVE WEEK. The contest's sport is a sentinel string and
// its week is season 1999 (no NFL rows exist there), so neither the poller's
// own 'nfl' pass nor any other suite's "current contest" can ever pick it up,
// and this suite never touches a real board. Everything is created and deleted
// here; the teardown verifies itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { install } from '../testing/nextResolve.mjs';

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
const { rankRows, withMovement, boardView, gameBoard, snapshotLiveBoards, standingsAt } = await import('./live.js');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// the pure core
// ---------------------------------------------------------------------------

test('COMPETITION RANK: equal totals share a place, the next one skips', () => {
  const r = rankRows([{ userId: 3, points: 5 }, { userId: 1, points: 9 }, { userId: 2, points: 5 }, { userId: 4, points: 1 }]);
  assert.deepEqual(r.map((x) => [x.userId, x.rank]), [[1, 1], [2, 2], [3, 2], [4, 4]]);
});

test('MOVEMENT: points gained and places climbed; no standing then is null, never a zero', () => {
  const rows = rankRows([{ userId: 1, points: 20 }, { userId: 2, points: 12 }, { userId: 3, points: 8 }]);
  const m = withMovement(rows, new Map([[1, { points: 2, rank: 3 }], [2, { points: 12, rank: 1 }]]));
  assert.deepEqual(m.map((x) => [x.userId, x.dPoints, x.dRank]), [[1, 18, 2], [2, 0, -1], [3, null, null]]);
});

test('THE VIEW: top ten, then the reader with a neighbour either side, and the top-10% line', () => {
  const rows = rankRows(Array.from({ length: 40 }, (_, i) => ({ userId: i + 1, points: 100 - i })));
  const v = boardView(rows, 25, { top: 10 });
  assert.equal(v.head.length, 10);
  assert.deepEqual(v.around.map((r) => r.userId), [24, 25, 26], 'one either side of the reader');
  assert.equal(v.gap, true, 'rows 11-23 are elided, and the view says so');
  assert.equal(v.me.rank, 25);
  assert.equal(v.topTenCut, 97, 'the 4th place of 40 is the top-10% line');
  const top = boardView(rows, 3);
  assert.deepEqual(top.around, [], 'a reader already in the top ten gets no second copy');
  const out = boardView(rows, 999);
  assert.equal(out.me, null, 'not entered is not a row');
  assert.equal(boardView(rows.slice(0, 9), 1).topTenCut, null, 'under ten entries there is no top-10% line');
  const eleven = boardView(rows, 11);
  assert.equal(eleven.gap, false, 'rank 11 follows the top ten directly: no dots');
});

// ---------------------------------------------------------------------------
// the composition: stat rows -> poller snapshot -> page read -> screen
// ---------------------------------------------------------------------------

const NS = `sentinel-lb-${process.pid}-${Date.now()}`;
const SPORT = NS.slice(0, 40);
const ids = { users: [], match: null, contest: null };
let P = [];

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
  const t = await sql`SELECT id FROM teams WHERE league_id = ${lg.id} ORDER BY id LIMIT 2`;
  P = (await sql`SELECT id, position AS pos, full_name AS name FROM nfl_players WHERE position IN ('RB', 'WR') ORDER BY id LIMIT 3`)
    .map((p) => ({ id: p.id, pos: p.pos, name: p.name, team: 'SEN' }));
  assert.equal(P.length, 3, 'three real players to put on the sentinel board');
  const t0 = new Date(Date.now() - 3600e3);
  [{ id: ids.match }] = await sql`
    INSERT INTO matches (league_id, slug, status, home_team_id, away_team_id, kickoff_at, season_year, season_phase, week, external_ids, metadata)
    VALUES (${lg.id}, ${NS}, 'live', ${t[0].id}, ${t[1].id}, ${t0.toISOString()}, 1999, 'REG', 1, '{}'::jsonb, '{}'::jsonb) RETURNING id`;
  [{ id: ids.contest }] = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled, meta)
    VALUES ('weekly', ${SPORT}, 1999, 1, ${JSON.stringify(P)}::jsonb, ${new Date(Date.now() - 86400e3).toISOString()},
            ${new Date(Date.now() + 86400e3).toISOString()}, false, '{}'::jsonb) RETURNING id`;
  for (const k of ['a', 'b', 'c']) {
    const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}-${k}@example.invalid`}) RETURNING id`;
    ids.users.push(u.id);
  }
  // one player each: A the first RB/WR, B the second, C the third
  const slot = (p) => (p.pos === 'RB' ? 'RB' : 'WR');
  for (let i = 0; i < 3; i++) {
    await sql`INSERT INTO contest_entries (contest_id, user_id, lineup, locked_at)
              VALUES (${ids.contest}, ${ids.users[i]}, ${JSON.stringify({ [slot(P[i])]: P[i].id })}::jsonb, now())`;
  }
});

after(async () => {
  await sql`DELETE FROM contests WHERE id = ${ids.contest}`;
  await sql`DELETE FROM matches WHERE id = ${ids.match}`;
  await sql`DELETE FROM users WHERE id = ANY(${ids.users})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM contests WHERE sport = ${SPORT})
         + (SELECT count(*)::int FROM matches WHERE slug = ${NS})
         + (SELECT count(*)::int FROM users WHERE email LIKE ${`${NS}%`})
         + (SELECT count(*)::int FROM live_board_snapshots WHERE contest_id = ${ids.contest}) AS n`;
  assert.equal(left.n, 0, 'the sentinels are gone');
});

const stat = (pid, cols) => sql`
  INSERT INTO nfl_player_game_stats (match_id, nfl_player_id, rush_yds, rush_td, rec, rec_yds)
  VALUES (${ids.match}, ${pid}, ${cols.rush_yds ?? 0}, ${cols.rush_td ?? 0}, ${cols.rec ?? 0}, ${cols.rec_yds ?? 0})
  ON CONFLICT (match_id, nfl_player_id) DO UPDATE
     SET rush_yds = EXCLUDED.rush_yds, rush_td = EXCLUDED.rush_td, rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds`;

test('THROUGH THE POLLER TO THE PAGE: a box score moves the board, and ten minutes later the board says by how much', async () => {
  const [A, B, C] = ids.users;
  const t0 = new Date(Date.now() - 11 * 60_000);
  const t1 = new Date();

  // t0: A 5.0 (50 rush yds), B 5.0 (2 rec, 30 yds = 2 + 3), C nothing yet
  await stat(P[0].id, { rush_yds: 50 });
  await stat(P[1].id, { rec: 2, rec_yds: 30 });
  const s0 = await snapshotLiveBoards({ sport: SPORT, now: t0 });
  assert.deepEqual(s0, { contests: 1, written: 3 }, 'first snapshot: every entry has a first standing');
  const again = await snapshotLiveBoards({ sport: SPORT, now: new Date(t0.getTime() + 1000) });
  assert.equal(again.written, 0, 'nothing moved, nothing written - one row per CHANGE, not per poll');
  const at0 = await standingsAt(ids.contest, t0.getTime());
  assert.equal(at0.get(A).rank, 1); assert.equal(at0.get(B).rank, 1, 'A and B tie on 5.0 and share first');
  assert.equal(at0.get(C).rank, 3);

  // t1: C's back goes for 120 and a score -> 12 + 6 = 18
  await stat(P[2].id, { rush_yds: 120, rush_td: 1 });
  const b = await gameBoard('weekly', { sport: SPORT, now: t1 });
  assert.equal(b.state, 'live');
  const byUser = new Map(b.rows.map((r) => [r.userId, r]));
  assert.deepEqual([byUser.get(C).rank, byUser.get(C).points, byUser.get(C).dPoints, byUser.get(C).dRank], [1, 18, 18, 2],
    'C: first on 18.0, +18.0 and up two places since ten minutes ago');
  assert.deepEqual([byUser.get(A).rank, byUser.get(A).dPoints, byUser.get(A).dRank], [2, 0, -1], 'A: still 5.0, down one');
  for (const r of b.rows) assert.equal(Object.keys(r).some((k) => /lineup|roster|meta/i.test(k)), false, 'no lineup ever reaches a board row');

  // A LEAGUE OF TWO (A and C): the same board, its members only, ranked among
  // themselves - and moving in points only, since the snapshots hold national ranks.
  const lg = await gameBoard('weekly', { sport: SPORT, now: t1, memberIds: [A, C] });
  assert.deepEqual(lg.rows.map((r) => [r.userId, r.rank, r.dRank]), [[C, 1, null], [A, 2, null]]);
  assert.equal(lg.rows[0].dPoints, 18, 'points movement still reads');
  const none = await gameBoard('weekly', { sport: SPORT, now: t1, memberIds: [] });
  assert.deepEqual(none.rows, [], 'an empty league is an empty board, never the nation');

  const s1 = await snapshotLiveBoards({ sport: SPORT, now: t1 });
  assert.equal(s1.written, 3, 'C moved on points, A and B on rank');

  // the screen, as BoardPage draws it for C
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/weekly/board' });
  global.window = dom.window; global.document = dom.window.document;
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const LiveBoard = (await import('../../components/boards/LiveBoard.js')).default;
  const html = renderToStaticMarkup(React.createElement(LiveBoard, {
    title: 'The Weekly', state: b.state, view: boardView(b.rows, String(C)), week: 1, homeHref: '/weekly', signedIn: true,
  }));
  document.getElementById('root').innerHTML = html;
  const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const card = document.querySelector('.lb-you');
  assert.equal(txt(card.querySelector('.lb-you-rk b')), '#1');
  assert.equal(txt(card.querySelector('.lb-you-rk span')), 'up 2 in the last 10 min');
  assert.match(txt(card.querySelector('.lb-you-pts b')), /^18\.0$/);
  const rows = [...document.querySelectorAll('.lb-table .lb-row:not(.hd)')];
  assert.deepEqual(rows.map((r) => r.getAttribute('data-rank')), ['1', '2', '2'], 'the tie is drawn as a tie');
  assert.equal(rows[0].classList.contains('you'), true, 'the reader is pinned in the table too');
  assert.equal(txt(rows[0].querySelector('.lb-d')), '+18.0');
  assert.equal(txt(rows[1].querySelector('.lb-d')), '–', 'no points moved: a dash, not +0.0');
  assert.match(txt(document.querySelector('.lb-pill')), /Live · Week 1/);
});

test('NO BOARD OF ZEROS: before the first kickoff the page says when it opens', async () => {
  const b = await gameBoard('weekly', { sport: SPORT, now: new Date(Date.now() - 2 * 3600e3) });
  assert.equal(b.state, 'prekick');
  assert.deepEqual(b.rows, []);
});

// ---------------------------------------------------------------------------
// the wiring: the poller makes this call, the page makes these
// ---------------------------------------------------------------------------

test('the poller snapshots the boards after a box score that changed something - NFL only, failure contained', () => {
  const t = stripComments(src('services/live-poller/index.mjs'));
  assert.match(t, /import \{ snapshotLiveBoards \} from '\.\.\/\.\.\/lib\/boards\/live\.js'/);
  const box = t.indexOf('const g = await syncBox(d.id)');
  const flag = t.indexOf("if (g.changed > 0 || d.why === 'final') boardsDue = true", box);
  const call = t.indexOf("snapshotLiveBoards({ sport: 'nfl'", flag);
  assert.ok(box > 0 && flag > box && call > flag, 'box score -> flag -> one snapshot call, in that order');
  const guard = t.lastIndexOf("if (boardsDue && lg.slug === 'nfl')", call);
  assert.ok(guard > flag, 'the call is gated on the flag and the league');
  assert.ok(t.slice(guard, call + 200).includes('try {') && t.slice(call, call + 400).includes('catch (e)'), 'its failure is its own');
});

test('both routes render the shared page, which reads gameBoard, picks the reader with boardView, draws LiveBoard', () => {
  for (const g of ['weekly', 'draft']) {
    const p = stripComments(src(`app/${g}/board/page.js`));
    assert.match(p, new RegExp(`<BoardPage game="${g}" searchParams=\\{searchParams\\} />`));
  }
  const bp = stripComments(src('components/boards/BoardPage.js'));
  for (const s of ['gameBoard(game', 'boardView(', '<LiveBoard', "b.state === 'live' ? <LiveRefresh />"]) assert.ok(bp.includes(s), `BoardPage lost ${s}`);
});

test('the lobby opens the whole board from the Weekly and Draft tabs', () => {
  const l = stripComments(src('components/games/LobbyV3.js'));
  assert.match(l, /const FULL_BOARD = \{ weekly: '\/weekly\/board', draft: '\/draft\/board'/);
  assert.match(l, /<Link className="gv-full" href=\{FULL_BOARD\[boardKey\]\}>/);
  const b = stripComments(src('components/boards/BoardPage.js'));
  assert.match(b, /myLeagues\(Number\(uid\)\)/, 'the chips are the reader\'s own leagues');
  assert.match(b, /String\(l\.id\) === String\(q\.league/, 'and ?league= only ever picks one of them');
});
