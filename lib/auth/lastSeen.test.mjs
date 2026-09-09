import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldTouch, LAST_SEEN_INTERVAL_MS } from './lastSeen.js';

test('a user is touched once an hour, not once a request', () => {
  const m = new Map(); const t0 = 1_000_000_000_000;
  assert.equal(shouldTouch(m, 4, t0), true, 'first sight writes');
  assert.equal(shouldTouch(m, 4, t0 + 1), false, 'the next request does not');
  assert.equal(shouldTouch(m, 4, t0 + LAST_SEEN_INTERVAL_MS - 1), false, '59:59 later still does not');
  assert.equal(shouldTouch(m, 4, t0 + LAST_SEEN_INTERVAL_MS), true, 'an hour later writes again');
  assert.equal(shouldTouch(m, 5, t0), true, 'another user has their own hour');
  assert.equal(shouldTouch(m, null, t0), false); assert.equal(shouldTouch(m, undefined, t0), false);
});
