import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cronAuthorized } from './cronAuth.js';

const req = (auth) => ({ headers: { get: (k) => (k === 'authorization' ? auth : null) } });

test('accepts the correct Bearer secret', () => {
  assert.equal(cronAuthorized(req('Bearer s3cret'), 's3cret'), true);
});
test('rejects a wrong secret', () => {
  assert.equal(cronAuthorized(req('Bearer nope'), 's3cret'), false);
});
test('rejects a missing Authorization header', () => {
  assert.equal(cronAuthorized(req(null), 's3cret'), false);
});
test('rejects when no CRON_SECRET is configured', () => {
  assert.equal(cronAuthorized(req('Bearer x'), ''), false);
  assert.equal(cronAuthorized(req('Bearer x'), undefined), false);
});
