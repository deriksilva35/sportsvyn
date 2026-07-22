// Pure unit tests for the isMember() date logic (membershipRowIsActive). No DB
// query runs, but importing membership.js pulls in db.js, which requires
// DATABASE_URL at load — so we load .env.local first (repo test convention,
// mirrors drafts.test.mjs) and dynamic-import after. The predicate itself is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '.env.local'));

const { membershipRowIsActive } = await import('./membership.js');

const NOW = new Date('2026-07-22T00:00:00Z');
const future = new Date('2026-08-22T00:00:00Z').toISOString();
const past = new Date('2026-06-22T00:00:00Z').toISOString();

test('no row -> not a member', () => {
  assert.equal(membershipRowIsActive(null, NOW), false);
  assert.equal(membershipRowIsActive(undefined, NOW), false);
});

test('active with future period end -> member', () => {
  assert.equal(membershipRowIsActive({ status: 'active', current_period_end: future }, NOW), true);
});

test('trialing with future period end -> member', () => {
  assert.equal(membershipRowIsActive({ status: 'trialing', current_period_end: future }, NOW), true);
});

test('active but period end in the past -> not a member', () => {
  assert.equal(membershipRowIsActive({ status: 'active', current_period_end: past }, NOW), false);
});

test('canceled / past_due / incomplete -> not a member regardless of period', () => {
  assert.equal(membershipRowIsActive({ status: 'canceled', current_period_end: future }, NOW), false);
  assert.equal(membershipRowIsActive({ status: 'past_due', current_period_end: future }, NOW), false);
  assert.equal(membershipRowIsActive({ status: 'incomplete', current_period_end: future }, NOW), false);
});

test('active with null period end -> member (just-created subscription)', () => {
  assert.equal(membershipRowIsActive({ status: 'active', current_period_end: null }, NOW), true);
});
