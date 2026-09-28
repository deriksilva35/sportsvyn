// lib/text/plural.test.mjs - the pluraliser, and that the counted "games" use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plural, noun } from './plural.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('ONE IS SINGULAR, everything else is not', () => {
  assert.equal(plural(1, 'game'), '1 game');
  assert.equal(plural(0, 'game'), '0 games');
  assert.equal(plural(2, 'game'), '2 games');
  assert.equal(plural('1', 'game'), '1 game', 'a count that arrives as a string');
  assert.equal(plural(1, 'entry', 'entries'), '1 entry');
  assert.equal(plural(4, 'entry', 'entries'), '4 entries');
  assert.equal(noun(1, 'game'), 'game');
});

// THE SITES THAT PRINTED "N games" WITH A LITERAL NOUN. A new `${n} games` is
// how "1 games" comes back, so each of these must read through plural().
const SITES = [
  'app/scores/page.js', 'components/today/GamesBand.js', 'components/sim/DraftRoom.js',
  'components/pickem/PickemGrade.js', 'components/league/LeagueHeader.js',
  'components/league/LeagueScores.js', 'lib/results/pickem.js', 'app/player/[slug]/page.js',
];
test('NO COUNT IS FOLLOWED BY A LITERAL "games" in the fixed sites', () => {
  for (const f of SITES) {
    const s = readFileSync(path.join(REPO, f), 'utf8');
    assert.doesNotMatch(s, /(\}|\bn\b|length|total|count)\s*\}?\s*games\b(?!\s*=)/, `${f} still pluralises by hand`);
    assert.match(s, /plural\(/, `${f} uses the pluraliser`);
  }
});
