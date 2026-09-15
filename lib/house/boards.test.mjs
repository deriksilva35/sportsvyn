// lib/house/boards.test.mjs - the house files every open board, and the draft
// room shows what it drafted before anything has scored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickPickem } from './pickPickem.js';
import { playsGame } from './personas.js';

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Two boards, two sports, two season-week numbers that do not agree - which is
// the real shape: on 15 Sep the NFL board was week 2 and the CFB board beside
// it was week 38.
const NFL = { id: 9, sport: 'nfl', week: 2, board: [
  { match_id: 1, home_team_id: 10, away_team_id: 20 },
  { match_id: 2, home_team_id: 30, away_team_id: 40 },
  { match_id: 3, home_team_id: 50, away_team_id: 60 },
] };
const CFB = { id: 8, sport: 'cfb', week: 38, board: [
  { match_id: 101, home_team_id: 70, away_team_id: 80 },
  { match_id: 102, home_team_id: 90, away_team_id: 95 },
  { match_id: 103, home_team_id: 96, away_team_id: 97 },
] };
const NFL_SPREADS = new Map([[1, -3], [2, 10], [3, -6]]);
// CFB: a line on two of three, which is roughly its measured 73% coverage.
const CFB_SPREADS = new Map([[101, -4], [102, 12]]);

const rng = (v) => () => v;

// ---------------------------------------------------------------------------
// TWO BOARDS FILE INDEPENDENTLY
// ---------------------------------------------------------------------------
test('EACH BOARD IS FILED ON ITS OWN, by the same method', () => {
  const nfl = pickPickem('chalk', NFL.board, { spreads: NFL_SPREADS });
  const cfb = pickPickem('chalk', CFB.board, { spreads: CFB_SPREADS });
  assert.equal(nfl.length, 3, 'every NFL game is priced');
  assert.equal(cfb.length, 2, 'two of three CFB games are');
  // Different match ids entirely - neither board can pick the other's games.
  assert.deepEqual(nfl.map((p) => p.matchId), [1, 2, 3]);
  assert.deepEqual(cfb.map((p) => p.matchId), [101, 102]);
});

test('A BOARD WITH NO LINE ON SOME GAMES STILL FILES THE OTHERS', () => {
  // The unpriced game is simply absent from the entry; it is not a refusal and
  // it does not stop the priced ones.
  const picks = pickPickem('chalk', CFB.board, { spreads: CFB_SPREADS });
  assert.equal(picks.some((p) => p.matchId === 103), false, '103 has no line');
  assert.equal(picks.length, 2);
});

test('THE FADE SKIPS MORE ON CFB, and that is its method working', () => {
  const nfl = pickPickem('fade', NFL.board, { spreads: NFL_SPREADS });
  const cfb = pickPickem('fade', CFB.board, { spreads: CFB_SPREADS });
  assert.deepEqual(nfl.map((p) => p.matchId), [1, 3], '+10 is outside the number');
  assert.deepEqual(cfb.map((p) => p.matchId), [101], 'and 102 is, and 103 has no line at all');
});

test('THE HOMER HAS NO TEAMS ON A CFB BOARD, so it picks nothing there', () => {
  const nfl = pickPickem('homer', NFL.board, { homerTeamIds: [10, 40] });
  const cfb = pickPickem('homer', CFB.board, { homerTeamIds: [] });
  assert.equal(nfl.length, 2);
  assert.deepEqual(cfb, [], 'a homer with no dog in the fight has no opinion');
});

test('A PERSONA THAT DOES NOT PLAY A GAME TYPE STILL DOES NOT, board or no board', () => {
  // The Fade plays pickem, so it files on both. Nobody gains a game type by
  // there being two boards of it.
  assert.equal(playsGame('fade', 'pickem'), true);
  assert.equal(playsGame('fade', 'daily'), false);
  assert.equal(playsGame('fade', 'weekly'), false);
  assert.equal(pickPickem('book', NFL.board, { spreads: NFL_SPREADS }), null);
});

test('the Gut is repeatable per board, and the two boards do not share a draw', () => {
  const a = pickPickem('gut', NFL.board, { spreads: NFL_SPREADS, rng: rng(0.1) });
  const b = pickPickem('gut', NFL.board, { spreads: NFL_SPREADS, rng: rng(0.1) });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// THE WIRING
// ---------------------------------------------------------------------------
test('openPickemBoards returns EVERY still-pickable board and keys on no week number', () => {
  const t = stripComments(src('../pickem/sequence.js'));
  const fn = t.slice(t.indexOf('export async function openPickemBoards'));
  assert.match(fn, /game_type = 'pickem'/);
  assert.match(fn, /AND NOT settled/);
  assert.match(fn, /locks_at > \$\{at\}/, 'open means still pickable, not merely unsettled');
  assert.equal(/week =/.test(fn.slice(0, fn.indexOf('ORDER BY'))), false,
    'the two sports number their seasons separately - nothing may key on a week');
  assert.equal(/LIMIT 1/.test(fn.slice(0, fn.indexOf('ORDER BY') + 40)), false, 'and it must not return one');
});

test('the tick loops boards and the cron reads them all', () => {
  const run = stripComments(src('./run.js'));
  assert.match(run, /for \(const board of pickemBoards \?\? \[\]\)/);
  assert.match(run, /each\(`pickem:\$\{board\.sport\}:\$\{board\.id\}`/, 'one summary line per board');
  assert.match(run, /spreadsByBoard\.get\(board\.id\)/, 'and one odds map per board');
  const route = stripComments(src('../../app/api/cron/house-entries/route.js'));
  assert.match(route, /openPickemBoards\(\{ now \}\)/);
  assert.equal(/currentPickemBoard/.test(route), false, 'the single-board reader is gone from the cron');
});

test('the Homer resolves its ids per sport, and CFB comes back empty', () => {
  const route = stripComments(src('../../app/api/cron/house-entries/route.js'));
  assert.match(route, /const out = \{ nfl: \[\], cfb: \[\] \}/);
  assert.match(route, /if \(r\.slug === 'nfl'\) out\.nfl\.push/);
});

// ---------------------------------------------------------------------------
// THE ROOM READS ITS OWN PICKS
// ---------------------------------------------------------------------------
test('picksForRoom reads only a COMPLETED room, and only its own picks', () => {
  const t = stripComments(src('../draft/roomRoster.js'));
  assert.match(t, /p\.picked_by = 'user'/, "the seat's own eight, not the grid's ninety-six");
  assert.match(t, /d\.status = 'completed'/, 'an unfinished room shows nothing');
  assert.match(t, /ORDER BY p\.overall_pick ASC/, 'in draft order');
  assert.equal(/INSERT|UPDATE|DELETE/.test(t), false, 'this is a read and repairs nothing');
});

test('rosterForEntry prefers the bridged roster and says which it returned', () => {
  const t = stripComments(src('../draft/roomRoster.js'));
  assert.match(t, /if \(Array\.isArray\(bridged\) && bridged\.length\) \{\s*return \{ source: 'bridged'/);
  assert.match(t, /return picks\.length \? \{ source: 'picks', rows: picks \} : \{ source: 'none', rows: \[\] \}/);
});

test('THE SURFACE SHOWS NO SCORES AND NO BEST-SIX on the read-back path', () => {
  const page = src('../../app/draft/page.js');
  assert.match(page, /const \{ source, rows: roster \} = await rosterForEntry\(entry\)/);
  assert.match(page, /source === 'picks' \?/, 'the line is conditional on the read-back path');
  assert.match(page, /chosen at settle, from the week&apos;s real scores/);
  // No zeros, no ticks: the waiting card must not render a points column.
  const waiting = page.slice(page.indexOf("state === 'waiting'"), page.indexOf("state === 'drafting'"));
  assert.equal(/points|dr-count|bestBall/.test(waiting), false,
    'neither exists until settlement and neither may be implied');
});
