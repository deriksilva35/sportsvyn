// components/gridiron/editionKicker.test.mjs - the board's kicker names its week (tue-6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editionKicker } from '../../lib/rankings/editionKicker.js';

const src = readFileSync(new URL('./EditorialBoard.js', import.meta.url), 'utf8');

test('THE KICKER IS THE EDITION\'S OWN WEEK, not a literal "Preseason"', () => {
  assert.equal(editionKicker('Week 3 · computed 2026-09-29', 2), 'Week 3 · Edition 2');
  assert.equal(editionKicker('AP week 5 · computed 2026-09-29', 2), 'AP week 5 · Edition 2');
  assert.equal(editionKicker('Preseason', 0), 'Preseason · Edition 0');
  assert.equal(editionKicker(null, 0), 'Preseason · Edition 0', 'Edition 0 has no label');
  assert.equal(editionKicker('Computed 2026-09-22', 1), 'Computed 2026-09-22 · Edition 1', 'a legacy label is printed as it is, never invented');
  assert.doesNotMatch(src, />Preseason · Edition \{/, 'the literal is gone');
  assert.match(src, /\{editionKicker\(editionLabel, editionNumber\)\}/);
  assert.equal((src.match(/editionLabel=\{board\.editionLabel\}/g) ?? []).length, 2, 'both heads pass the label');
});
