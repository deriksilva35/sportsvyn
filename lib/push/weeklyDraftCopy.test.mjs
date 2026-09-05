// lib/push/weeklyDraftCopy.test.mjs - the six Weekly/Draft push keys (D1)
// and renderCopy()'s {placeholder} substitution. PURE, no DB, no network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_COPY, copyFor, renderCopy, RenderCopyError } from './copy.js';

const KEYS = ['weekly-open', 'weekly-reminder', 'weekly-settled', 'draft-open', 'draft-reminder', 'draft-settled'];

test('all six keys exist, same shape as every other PUSH_COPY entry', () => {
  for (const k of KEYS) {
    assert.ok(PUSH_COPY[k], `${k} missing`);
    assert.equal(typeof PUSH_COPY[k].title, 'string');
    assert.equal(typeof PUSH_COPY[k].body, 'string');
    assert.ok(PUSH_COPY[k].url.startsWith('/'));
  }
});

test('renderCopy fills every {placeholder} with the given param', () => {
  const c = renderCopy('weekly-settled:217', { week: 1, pts: 148.2, pct: 92, rank: 3, field: 214 });
  assert.equal(c.body, 'Week 1 is graded. 148.2 pts, 92% of the best six. 3 of 214.');
});

test('renderCopy throws on an unfilled {key} - no brace ever leaves this function', () => {
  assert.throws(() => renderCopy('weekly-reminder:217', {}), RenderCopyError);
  try {
    renderCopy('weekly-reminder:217', {});
    assert.fail('expected a throw');
  } catch (err) {
    assert.ok(err instanceof RenderCopyError);
    assert.equal(err.eventId, 'weekly-reminder:217');
    assert.deepEqual(err.missing, ['n_set']);
  }
});

test('renderCopy returns null for an unknown prefix, same refusal as copyFor', () => {
  assert.equal(renderCopy('mystery:1', {}), null);
});

test('draft-reminder\'s seat_state fills as one string, not a nested template', () => {
  const c = renderCopy('draft-reminder:3', { seat_state: 'Seat 4 drafting' });
  assert.equal(c.body, 'One hour to lock. Seat 4 drafting.');
  const none = renderCopy('draft-reminder:3', { seat_state: 'No seat yet' });
  assert.equal(none.body, 'One hour to lock. No seat yet.');
});

test('draft-settled substitutes pts and the season rank - room_rank is gone', () => {
  const c = renderCopy('draft-settled:3', { week: 1, pts: 61.4, rank: 40, field: 214 });
  assert.equal(c.body, 'Week 1 is graded. 61.4 pts, 40 of 214.');
});

test('copyFor on a weekly/draft key still returns the raw template, unrendered', () => {
  assert.equal(copyFor('weekly-open:217'), PUSH_COPY['weekly-open']);
  assert.ok(copyFor('weekly-open:217').body.includes('{lock_local}'));
});
