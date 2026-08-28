// lib/gridiron/gameChart.test.mjs — the game-log section's two decisions:
// which stats a position charts, and how a value becomes a bar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { columnsFor, chartsFor, MAX_CHARTS } from './playerStats.js';
import { cfbColumnsFor } from '../cfb/seasonStats.js';
import { barsFor } from './gameChart.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('each position charts the two numbers it is about', () => {
  const keys = (cols) => chartsFor(cols).map((c) => c.key);
  assert.deepEqual(keys(columnsFor('QB', 'OFF')), ['pass_yds', 'pass_td']);
  assert.deepEqual(keys(columnsFor('RB', 'OFF')), ['rush_yds', 'rec']);
  assert.deepEqual(keys(columnsFor('WR', 'OFF')), ['rec', 'rec_yds']);
  assert.deepEqual(keys(columnsFor('TE', 'OFF')), ['rec', 'rec_yds']);
});

test('THE VOCABULARY LAW: CFB defense charts Tkl, NFL defense cannot', () => {
  // nfl_player_game_stats has never held a tackles column and cfb's does. The
  // same preference list therefore yields different pairs, because it asks the
  // player's OWN columns rather than assuming a shape.
  assert.deepEqual(chartsFor(cfbColumnsFor('LB', 'DEF')).map((c) => c.key), ['tackles_tot', 'sacks']);
  assert.deepEqual(chartsFor(columnsFor('DE', 'DEF')).map((c) => c.key), ['sacks', 'def_int']);
});

test('the family is detected from KEYS, never from set identity', () => {
  // columnSetName() compares by object identity against COLUMN_SETS. Routing
  // chart selection through it worked for NFL and silently returned NOTHING
  // for CFB, whose sets are built in a different module - every college
  // defender got zero charts and nothing threw.
  const PS = strip(src('lib/gridiron/playerStats.js'));
  const fn = PS.slice(PS.indexOf('export function chartsFor'), PS.indexOf('export function columnSetName'));
  assert.ok(!/columnSetName/.test(fn), 'chartsFor must not depend on set identity');
  assert.match(PS, /const pref = CHART_PREFS\.find\(\(p\) => p\.when\.some\(\(k\) => byKey\.has\(k\)\)\)/);
});

test('a position with no counting vocabulary charts nothing', () => {
  assert.deepEqual(chartsFor(columnsFor('OT', 'OFF')), []);
  assert.deepEqual(chartsFor(null), []);
  assert.deepEqual(chartsFor([]), []);
});

test('never more than two charts', () => {
  assert.equal(MAX_CHARTS, 2);
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DE']) {
    assert.ok(chartsFor(columnsFor(pos, pos === 'DE' ? 'DEF' : 'OFF')).length <= 2);
  }
});

// ---------------------------------------------------------------------------
// BARS
// ---------------------------------------------------------------------------

const g = (season, week, v, key = 'rush_yds', opponent = 'vs BUF') => ({ season, week, opponent, [key]: v });
const COL = { key: 'rush_yds', label: 'Yds' };

test('A ZERO IS A FLOOR SLIVER, not a missing bar', () => {
  const bars = barsFor([g(2025, 1, 100), g(2025, 2, 0)], COL);
  assert.equal(bars.length, 2);
  assert.ok(bars[1].height > 0, 'a zero game still draws - it happened');
  assert.equal(bars[1].value, 0);
  assert.ok(bars[0].height > bars[1].height);
});

test('ABSENT IS NOT ZERO: a null stat draws no bar at all', () => {
  const bars = barsFor([g(2025, 1, 50), g(2025, 2, null)], COL);
  assert.equal(bars.length, 1, 'the null game is not charted');
  assert.equal(bars[0].value, 50);
});

test('no charted values at all yields no chart', () => {
  assert.equal(barsFor([g(2025, 1, null), g(2025, 2, null)], COL), null);
  assert.equal(barsFor([], COL), null);
  assert.equal(barsFor(null, COL), null);
});

test('heights scale to the window own best, and an all-zero window is flat', () => {
  const bars = barsFor([g(2025, 1, 10), g(2025, 2, 5)], COL);
  assert.ok(bars[0].height > bars[1].height);
  const flat = barsFor([g(2025, 1, 0), g(2025, 2, 0)], COL);
  assert.equal(flat[0].height, flat[1].height, 'no division by a zero max');
});

test('the opponent keeps its direction and loses its word', () => {
  assert.equal(barsFor([g(2025, 1, 1, 'rush_yds', 'at KC')], COL)[0].opponent, '@KC');
  assert.equal(barsFor([g(2025, 1, 1, 'rush_yds', 'vs BUF')], COL)[0].opponent, 'BUF');
});

// ---------------------------------------------------------------------------
// THE MOCK'S ONE DELIBERATE DEPARTURE
// ---------------------------------------------------------------------------

test('NO THRESHOLD LINE on the player page, by ruling', () => {
  // The dashed volt line is the props board's device: it puts a PRICE beside
  // production. A player page has no price on it, so there is no line to draw,
  // and drawing one would import a betting frame into a production record.
  // The mock's .over brightness step goes with it - over/under is a property
  // of a line.
  const CH = strip(src('components/player/GameCharts.js')) + strip(src('lib/gridiron/gameChart.js'));
  const CSS = strip(src('app/player/[slug]/player.css'));
  for (const forbidden of ['thline', 'gp-bar.over', '\\.over']) {
    assert.ok(!new RegExp(forbidden).test(CH), `${forbidden} must not reach the player chart`);
  }
  assert.ok(!/thline/.test(CSS));
});

test('the season selector is URL state and hides itself when pointless', () => {
  const GS = strip(src('components/player/GridironStats.js'));
  assert.match(GS, /seasons\.length > 1 && hrefFor/, 'one season means no control to press');
  const PAGE = strip(src('app/player/[slug]/page.js'));
  assert.match(PAGE, /hrefFor=\{\(y\) => `\?season=\$\{y\}#gamelog`\}/);
  // A ?season= pointing at a year the player never played falls back to the
  // most recent that has rows, rather than rendering an empty section.
  assert.match(PAGE, /seasonYears\.includes\(wanted\) \? wanted : \(seasonYears\[0\] \?\? null\)/);
});

test('the soccer arm never sees the season param', () => {
  const PAGE = strip(src('app/player/[slug]/page.js'));
  const soccerAt = PAGE.indexOf('const session = await auth()');
  assert.ok(soccerAt > 0);
  assert.ok(!/season=/.test(PAGE.slice(soccerAt)), 'the soccer render is untouched');
});
