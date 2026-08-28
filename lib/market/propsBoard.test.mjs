// lib/market/propsBoard.test.mjs — the board's own decisions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortName, MARKET_GROUPS, MARKET_LABELS, chartSeries } from './propsBoard.js';
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
  const BOARD = strip(src('lib/market/propsBoard.js'));
  assert.match(BOARD, /a\.moveProb == null \? -1 : Math\.abs\(a\.moveProb\)/);
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
