import test from 'node:test';
import assert from 'node:assert/strict';
import { inWindow } from './scoresV2.js';
import { railSpan, shiftDay } from './scoresV2Shape.js';

// All relative to an injected "today": no typed dates decide anything.
const today = '2026-10-20';

test('the fetch window covers every rail day, not today +/- 3', () => {
  const { from, to } = railSpan(today);
  for (let d = from; d <= to; d = shiftDay(d, 1)) assert.ok(inWindow(d, today), d);
  assert.equal(inWindow(shiftDay(to, 1), today), false);
  assert.equal(inWindow(shiftDay(from, -1), today), false);
  assert.ok(inWindow(shiftDay(today, 4), today), 'today+4 used to load nothing');
});

test('a picked day beyond the rail is loaded too', () => {
  const far = shiftDay(railSpan(today).to, 20);
  assert.equal(inWindow(far, today), false);
  assert.equal(inWindow(far, today, far), true);
  assert.equal(inWindow(shiftDay(far, 1), today, far), false);
});
