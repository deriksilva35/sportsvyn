// Shape tests for the Apple App Site Association content (pure; no DB/env).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPLE_APP_SITE_ASSOCIATION as AASA } from './aasa.js';

test('declares exactly the Draftvyn appID (TeamID.BundleID)', () => {
  const details = AASA.applinks.details;
  assert.equal(details.length, 1);
  assert.equal(details[0].appID, '87BX25MUHY.com.sportsvyn.draftvyn');
});

test('paths cover the auth callback and the sim surface', () => {
  const { paths } = AASA.applinks.details[0];
  assert.ok(paths.includes('/api/auth/callback/*'), 'covers auth callback');
  assert.ok(paths.includes('/sim*'), 'covers /sim*');
});

test('apps is an empty array (Apple requires the key present)', () => {
  assert.deepEqual(AASA.applinks.apps, []);
});

test('serializes to valid JSON', () => {
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(AASA)));
});
