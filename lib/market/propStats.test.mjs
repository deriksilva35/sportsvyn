// lib/market/propStats.test.mjs — the hit-rate engine behind THE STATS line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineFor, valueOf, hitRate, contextLine, MARKET_STATS } from './propStats.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const g = (season, o) => ({ season, ...o });

// ---------------------------------------------------------------------------
// THE LINE — and the Number(null) scar, met a third time
// ---------------------------------------------------------------------------

test('an anytime market with a NULL selection_value takes its own 0.5', () => {
  // Number(null) IS 0, and 0 IS FINITE. A bare Number() check returned 0 and
  // every anytime row read "cleared 0 TDs" instead of 0.5 - the same shape as
  // the career-totals column and the props implied_probability.
  assert.equal(lineFor('player_anytime_td', null), 0.5);
  assert.equal(lineFor('player_anytime_td', ''), 0.5);
  assert.equal(lineFor('player_goal_scorer_anytime', null), 0.5);
});

test('a priced line is used verbatim when there is one', () => {
  assert.equal(lineFor('player_pass_yds', '233.5'), 233.5);
  assert.equal(lineFor('player_receptions', '1.5'), 1.5);
  // A genuine zero line is still a zero line.
  assert.equal(lineFor('player_pass_yds', '0'), 0);
});

test('an unmapped market has no line and therefore no context', () => {
  assert.equal(lineFor('player_to_receive_card', '0.5'), null);
  assert.equal(hitRate([g(2025, { goals: 1 })], 'player_to_receive_card', null), null);
});

// ---------------------------------------------------------------------------
// ABSENT vs ZERO
// ---------------------------------------------------------------------------

test('a game measured in NO column drops out of the denominator', () => {
  // A player who was not recorded did not fail to clear anything.
  assert.equal(valueOf({ rush_td: null, rec_td: null }, ['rush_td', 'rec_td']), null);
  const hr = hitRate([
    g(2025, { rush_td: 1, rec_td: null }),
    g(2025, { rush_td: null, rec_td: null }),
  ], 'player_anytime_td', null);
  assert.equal(hr.games, 1, 'the unmeasured game is not a miss, it is not a game');
  assert.equal(hr.cleared, 1);
});

test('a partially-null game is a real total, not an unknown', () => {
  // A receiver with no rushing row rushed for nothing, not for unknown.
  assert.equal(valueOf({ rush_td: null, rec_td: 2 }, ['rush_td', 'rec_td']), 2);
});

test('a real zero counts as a game and as a miss', () => {
  const hr = hitRate([g(2025, { rush_td: 0, rec_td: 0 }), g(2025, { rush_td: 1, rec_td: 0 })],
    'player_anytime_td', null);
  assert.equal(hr.games, 2);
  assert.equal(hr.cleared, 1);
});

// ---------------------------------------------------------------------------
// THE SENTENCE
// ---------------------------------------------------------------------------

test('yes/no markets and over/under markets speak differently', () => {
  const yes = hitRate([g(2025, { rush_td: 1, rec_td: 0 }), g(2025, { rush_td: 0, rec_td: 0 })],
    'player_anytime_td', null);
  assert.equal(contextLine(yes), '2025: a TD in 1 of 2 games',
    'reporting "cleared 0.5 TDs · 0.5/game" answers in a dialect nobody speaks');

  const ou = hitRate([g(2025, { pass_yds: 300 }), g(2025, { pass_yds: 150 })],
    'player_pass_yds', '233.5');
  assert.equal(contextLine(ou), '2025: cleared 233.5 pass yds in 1 of 2 · 225.0/game');
});

test('the most recent season only, never a career blend', () => {
  // "Cleared it in 11 of 17" means a season. Averaging four of them answers a
  // question nobody asked and flatters a player whose last year was his worst.
  const hr = hitRate([
    g(2025, { pass_yds: 300 }),
    g(2024, { pass_yds: 10 }), g(2024, { pass_yds: 10 }),
  ], 'player_pass_yds', '100');
  assert.equal(hr.season, 2025);
  assert.equal(hr.games, 1);
});

test('no logs, or no logs in the latest season, yields no line at all', () => {
  assert.equal(hitRate([], 'player_pass_yds', '100'), null);
  assert.equal(hitRate(null, 'player_pass_yds', '100'), null);
  assert.equal(contextLine(null), null);
});

test('SHORT CHARTS ARE HONEST CHARTS: two EPL matchweeks report as two', () => {
  const hr = hitRate([g(2026, { goals: 1 }), g(2026, { goals: 0 })],
    'player_goal_scorer_anytime', null);
  assert.equal(contextLine(hr), '2026: scored in 1 of 2 games');
});

// ---------------------------------------------------------------------------
// VOICE
// ---------------------------------------------------------------------------

test('OBSERVATION VOICE: the advice verbs appear nowhere', () => {
  const code = strip(src('lib/market/propStats.js'));
  for (const verb of ['\\bplay\\b', '\\btake\\b', '\\bbet\\b', '\\blean\\b', '\\bpick\\b']) {
    assert.ok(!new RegExp(verb, 'i').test(code), `${verb} must not appear in the stats engine`);
  }
});

test('every mapped market names columns the database actually holds', () => {
  const GRID = ['pass_yds', 'pass_td', 'rush_yds', 'rush_td', 'rec', 'rec_yds', 'rec_td'];
  const EPL = ['goals', 'assists', 'shots', 'shots_on_target'];
  for (const [key, spec] of Object.entries(MARKET_STATS)) {
    const allowed = spec.league === 'epl' ? EPL : GRID;
    for (const c of spec.cols) {
      assert.ok(allowed.includes(c), `${key} reads ${c}, which its league's table does not hold`);
    }
  }
});

test('a null season is not the word "null"', () => {
  // EPL matches carry no season_year - it is null on all 370, because a soccer
  // season is "2026-27" and does not fit an integer year. The sentence simply
  // does not name a season rather than naming a missing one.
  const hr = hitRate([{ season: null, goals: 1 }], 'player_goal_scorer_anytime', null);
  assert.equal(contextLine(hr), 'scored in 1 of 1 games');
  assert.ok(!/null/.test(contextLine(hr)));
});
