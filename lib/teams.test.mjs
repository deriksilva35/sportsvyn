// lib/teams.test.mjs - which row a duplicated /team/ slug resolves to.
//
// `teams` holds one row per team PER COMPETITION, so 52 slugs exist more than
// once. getTeamBySlug picks one, and until this pass the last tiebreak was
// `id ASC` - whichever row happened to be imported first. That is not a
// preference, it is an accident, and it was live and wrong for one real team.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const teams = src('lib/teams.js');
// BOTH comment styles go first. The function's own doc block narrates the bug
// ("LIMIT 1 with no ORDER BY returned an arbitrary row", "prefer the WC-league
// row") in exactly the words these assertions look for - and the stray LIMIT 1
// in that prose sits BEFORE the real ORDER BY, which silently sliced the clause
// down to an empty string and failed every test for the wrong reason.
const code = teams.replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '');

const from = code.indexOf('ORDER BY');
const order = code.slice(from, code.indexOf('LIMIT 1', from));

test('the ordering is an explicit named precedence, not an id accident', () => {
  // `georgia` is both the country and the Georgia Bulldogs. Under id ASC the
  // country's older row won, so /team/georgia served a soccer page and the
  // Bulldogs - a full CFB roster - had no reachable page at all.
  assert.match(order, /CASE lg\.slug/);
  for (const [lg, rank] of [['fifa-wc-2026', 0], ['nfl', 1], ['cfb', 2], ['epl', 3]]) {
    assert.match(order, new RegExp(`WHEN '${lg}'\\s*THEN ${rank}`), `${lg} must be named`);
  }
});

test('gridiron outranks the legacy competition rows that shadow it', () => {
  const rank = (lg) => {
    const m = order.match(new RegExp(`WHEN '${lg}'\\s*THEN (\\d)`));
    return m ? Number(m[1]) : Number(order.match(/ELSE (\d)/)[1]);
  };
  // The actual collision: cfb must beat international-friendlies.
  assert.ok(rank('cfb') < rank('international-friendlies'));
  assert.ok(rank('nfl') < rank('international-friendlies'));
  assert.ok(rank('cfb') < rank('africa-cup-of-nations'));
});

test('the World Cup still wins where it used to - 48 team pages depend on it', () => {
  const rank = (lg) => {
    const m = order.match(new RegExp(`WHEN '${lg}'\\s*THEN (\\d)`));
    return m ? Number(m[1]) : Number(order.match(/ELSE (\d)/)[1]);
  };
  for (const other of ['nfl', 'cfb', 'epl', 'international-friendlies', 'concacaf-gold-cup']) {
    assert.ok(rank('fifa-wc-2026') < rank(other), `WC must outrank ${other}`);
  }
});

test('the blurb term still leads, and id ASC still ends it', () => {
  // Term 1 unchanged: a row that already carries an outlook blurb wins, which
  // is what stopped the blurb vanishing from most WC team pages originally.
  assert.ok(order.indexOf('current_outlook_blurb_id IS NOT NULL') < order.indexOf('CASE lg.slug'));
  // Unnamed leagues share ELSE and fall through to id ASC, which is precisely
  // why 51 of the 52 duplicated slugs resolve exactly as they did before.
  assert.match(order, /ELSE 9\s*\n\s*END,\s*\n\s*t\.id ASC/);
});

test('the league is selected, not just joined', () => {
  // Without this the page cannot tell an NFL team from a World Cup one - the
  // reason the breadcrumb, anchor rail and schedule heading were all hardcoded.
  assert.match(code, /lg\.slug\s+AS league_slug/);
});
