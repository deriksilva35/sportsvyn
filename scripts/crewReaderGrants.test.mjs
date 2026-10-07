// scripts/crewReaderGrants.test.mjs - the crew role's grant plan (wed-4). PURE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantPlan, EXCLUDED_TABLES, EXCLUDED_COLUMNS } from './crew-reader-grants.mjs';

const COLS = {
  users: ['id', 'handle', 'email', 'date_of_birth', 'name', 'contact_email'],
  sessions: ['id', 'sessionToken'],
  matches: ['id', 'status'],
  app_errors: ['id', 'service'],
  player_leagues: ['id', 'name', 'join_code', 'invite_token'],
};

test('auth/session/token tables are never granted; withheld columns never listed', () => {
  const plan = grantPlan(Object.keys(COLS), (t) => COLS[t]);
  const by = Object.fromEntries(plan.map((p) => [p.table, p.columns]));
  assert.ok(!('sessions' in by));
  assert.equal(by.matches, null, 'a clean table is granted whole');
  assert.equal(by.app_errors, null, 'the crew reads app_errors');
  assert.deepEqual(by.users, ['id', 'handle']);
  assert.deepEqual(by.player_leagues, ['id', 'name']);
});

test('the exclusion lists name the auth tables and every email/token/identity column', () => {
  for (const t of ['accounts', 'sessions', 'verification_token', 'email_otp', 'email_signups', 'device_tokens']) assert.ok(EXCLUDED_TABLES.includes(t), t);
  for (const c of ['email', 'contact_email', 'date_of_birth', 'emailVerified']) assert.ok(EXCLUDED_COLUMNS.users.includes(c), c);
  assert.ok(EXCLUDED_COLUMNS.player_leagues.includes('invite_token'));
});
