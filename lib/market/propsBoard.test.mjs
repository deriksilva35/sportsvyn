// lib/market/propsBoard.test.mjs — the board's own decisions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortName, MARKET_GROUPS, MARKET_LABELS, chartSeries, TABLE_COLUMNS, SCORER_SUFFIX, HIT_RATE_MARKETS } from './propsBoard.js';
import { MARKET_STATS } from './propStats.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('SHORT NAMES survive a narrow column', () => {
  assert.equal(shortName('Francisco Evanilson de Lima Barbosa'), 'F. Barbosa');
  assert.equal(shortName('Patrick Mahomes'), 'P. Mahomes');
  // A single token is already short; "Rodri" is not improved by becoming "Rodri".
  assert.equal(shortName('Rodri'), 'Rodri');
  // A generational suffix stays attached to the surname it belongs to.
  assert.equal(shortName('DeAngelo Irvin Jr.'), 'D. Irvin Jr.');
  assert.equal(shortName(''), '');
  assert.equal(shortName(null), '');
});

test('every market group names real vendor keys, and every key has a label', () => {
  const grouped = new Set(MARKET_GROUPS.flatMap((g) => g.markets));
  for (const k of grouped) {
    assert.ok(MARKET_STATS[k], `${k} is grouped but has no stat mapping`);
    assert.ok(MARKET_LABELS[k], `${k} is grouped but has no display label`);
  }
  // And nothing mapped is left ungroupable - a market with no chip cannot be
  // filtered to, which would hide rows a reader cannot reach.
  for (const k of Object.keys(MARKET_STATS)) {
    assert.ok(grouped.has(k), `${k} has stats but no filter chip`);
  }
});

test('THE THRESHOLD LINE lives on the board, never on the player page', () => {
  // A dashed line compares production to a PRICE. The board is the only
  // surface where a price exists; the player page charts pure production.
  const BOARD = strip(src('components/market/PropsBoard.js'));
  const PLAYER = strip(src('components/player/GameCharts.js'));
  assert.match(BOARD, /pb-thline/, 'the board draws the line');
  assert.ok(!/thline/.test(PLAYER), 'the player page must never draw one');
  // .over is a property of a line, so it goes where the line goes.
  assert.match(BOARD, /pb-bar\$\{chart\.points\[i\]\.value > chart\.line \? ' over' : ''\}/);
  assert.ok(!/\.over/.test(PLAYER));
});

test('the chart takes the last ten of the CHARTED season only', () => {
  const logs = [];
  for (let i = 0; i < 14; i += 1) logs.push({ season: 2025, week: 14 - i, pass_td: i % 3 });
  logs.push({ season: 2024, week: 1, pass_td: 9 });
  const c = chartSeries(logs, 'player_pass_tds', { season: 2025, line: 1.5 });
  assert.equal(c.points.length, 10);
  assert.ok(!c.points.some((p) => p.value === 9), 'a prior season must not leak in');
  assert.equal(c.line, 1.5);
});

test('a chart with no measured games is no chart', () => {
  assert.equal(chartSeries([{ season: 2025, pass_td: null }], 'player_pass_tds', { season: 2025, line: 1.5 }), null);
  assert.equal(chartSeries([], 'player_pass_tds', { season: 2025, line: 1.5 }), null);
  assert.equal(chartSeries([{ season: 2025, pass_td: 1 }], 'player_pass_tds', null), null);
});

test('UNLINKED ROWS ARE NOT DEMOTED - the sort never sees linking', () => {
  // A missing chart is our gap, not the player's; ranking on it would
  // editorialize our own coverage.
  const BOARD = strip(src('lib/market/propsBoard.js'));
  const sorter = BOARD.slice(BOARD.indexOf('function sorter'), BOARD.indexOf('async function boardMatchIdSet'));
  for (const forbidden of ['playerId', 'context', 'chart', 'link']) {
    assert.ok(!new RegExp(forbidden).test(sorter), `sorting must not consider ${forbidden}`);
  }
});

test('a NULL 24h move sorts last and is not a zero', () => {
  // The default board order lives in absMove now that every column sorts; the
  // rule is unchanged - an unobserved move is not a small one.
  const BOARD = strip(src('lib/market/propsBoard.js'));
  assert.match(BOARD, /const absMove = \(r\) => \(r\.moveProb == null \? -1 : Math\.abs\(r\.moveProb\)\)/);
  assert.match(BOARD, /if \(!col\) return \(a, b\) => absMove\(b\) - absMove\(a\)/);
});

test('OBSERVATION VOICE in the board copy', () => {
  const BOARD = strip(src('components/market/PropsBoard.js'));
  // The only permitted appearance of an advice word is inside the stance that
  // disclaims it - "Not a pick" - which lives in the page, not the board.
  for (const w of ['\\bplay\\b', '\\btake\\b', '\\bbet\\b', '\\blean\\b']) {
    assert.ok(!new RegExp(w, 'i').test(BOARD), `${w} must not appear in board copy`);
  }
});

test('the board is fully server-rendered - no client fetch on day one', () => {
  const BOARD = src('components/market/PropsBoard.js');
  assert.ok(!/'use client'/.test(BOARD));
  assert.ok(!/useState|useEffect|fetch\(/.test(BOARD),
    'FULL SEASON links to the player page rather than expanding in place');
  assert.match(strip(BOARD), /pb-full/);
});

// ---------------------------------------------------------------------------
// THE TABLE VIEW (mock v0.7)
// ---------------------------------------------------------------------------

test('every table column declares the value it sorts on', () => {
  // One definition, so a header cannot advertise a sort the sorter does not
  // implement.
  const keys = TABLE_COLUMNS.map((c) => c.key);
  assert.deepEqual(keys, ['player', 'game', 'market', 'line', 'price', 'implied', 'move', 'hit', 'avg']);
  for (const c of TABLE_COLUMNS) assert.equal(typeof c.get, 'function', `${c.key} has no getter`);
});

test('SORTING STAYS LINK-BLIND, and now also stat-blind except by request', () => {
  // Extended from M3b: the sorter reads a column's getter and nothing else.
  // It cannot see playerId, and it only sees a hit rate through the column a
  // reader explicitly chose.
  const BOARD = strip(src('lib/market/propsBoard.js'));
  const fn = BOARD.slice(BOARD.indexOf('function sorter('), BOARD.indexOf('const absMove'));
  for (const forbidden of ['playerId', 'context', 'chart', 'link', 'onBoard']) {
    assert.ok(!new RegExp(forbidden).test(fn), `sorting must not consider ${forbidden}`);
  }
});

test('A DASH IS NOT A SMALL NUMBER: nulls sort last in BOTH directions', () => {
  const BOARD = strip(src('lib/market/propsBoard.js'));
  const fn = BOARD.slice(BOARD.indexOf('function sorter('), BOARD.indexOf('const absMove'));
  assert.match(fn, /if \(an\) return 1;/);
  assert.match(fn, /if \(bn\) return -1;/);
  // Neither arm is inverted by `desc`, so flipping the arrow cannot march the
  // unmeasured rows to the top.
  const i = fn.indexOf('if (an) return 1;');
  const j = fn.indexOf('return desc ? -cmp : cmp;');
  assert.ok(i < j, 'the null arms return before direction is applied');
});

test('SCORER is three markets under one chip, distinguished per row', () => {
  assert.deepEqual(Object.keys(SCORER_SUFFIX).sort(), [
    'player_first_goal_scorer', 'player_goal_scorer_anytime', 'player_last_goal_scorer',
  ]);
  const scorerChip = MARKET_GROUPS.find((g) => g.key === 'scorer');
  assert.deepEqual(scorerChip.markets.sort(), Object.keys(SCORER_SUFFIX).sort(),
    'the chip covers exactly the three the row labels distinguish');
});

test('HIT/AVG on anytime only - our logs cannot answer "scored FIRST"', () => {
  // player_match_stats has goal_minutes and goal_types columns and BOTH ARE
  // EMPTY: 282 scoring rows, zero with a minute. Without a minute there is no
  // way to know which goal was first, so a hit rate there would be invented.
  assert.ok(HIT_RATE_MARKETS.has('player_goal_scorer_anytime'));
  assert.ok(!HIT_RATE_MARKETS.has('player_first_goal_scorer'));
  assert.ok(!HIT_RATE_MARKETS.has('player_last_goal_scorer'));
  // And the exclusion is by market, not by league - EPL's other markets keep
  // their stats.
  assert.ok(HIT_RATE_MARKETS.has('player_shots'));
  assert.ok(HIT_RATE_MARKETS.has('player_assists'));
});

test('STATS ARE ATTACHED BEFORE THE SLICE, so a sort sees the whole board', () => {
  // Sorting by HIT over the loaded page would return the best of forty
  // arbitrary rows and call it the top of the board.
  const BOARD = strip(src('lib/market/propsBoard.js'));
  const statsAt = BOARD.indexOf('const logs = await loadLogs(ids)');
  const sortAt = BOARD.indexOf('rows.sort(sorter(');
  const sliceAt = BOARD.indexOf('rows = rows.slice(0, limit)');
  assert.ok(statsAt > 0 && sortAt > statsAt, 'stats load before the sort');
  assert.ok(sliceAt > sortAt, 'the slice happens after the sort');
});

test('ZERO CLIENT COMPONENTS on the props surface', () => {
  // Comments stripped: PropsTable's own header says "still no 'use client'",
  // and a raw scan would read the sentence as the directive it forbids.
  for (const f of ['components/market/PropsTable.js', 'components/market/PropsFilters.js',
    'components/market/PropsBoard.js']) {
    const code = strip(src(f));
    assert.ok(!/'use client'/.test(code), `${f} must stay a server component`);
    assert.ok(!/useState|useEffect|onChange=/.test(code), `${f} must not carry client handlers`);
  }
});

test('the game dropdown is a GET form, not a handler', () => {
  const F = strip(src('components/market/PropsFilters.js'));
  assert.match(F, /<form action="\/market" method="get" className="pb-gameform">/);
  assert.match(F, /<select name="game"/);
});
