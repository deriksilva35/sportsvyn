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
  assert.ok(!('users' in by), 'users is withheld whole (tue-4): the crew reads it through crew_stats.users_v');
  assert.deepEqual(by.player_leagues, ['id', 'name']);
});

test('the exclusion lists name the auth tables and every email/token/identity column', () => {
  for (const t of ['accounts', 'sessions', 'verification_token', 'email_otp', 'email_signups', 'device_tokens']) assert.ok(EXCLUDED_TABLES.includes(t), t);
  for (const c of ['email', 'contact_email', 'date_of_birth', 'emailVerified']) assert.ok(EXCLUDED_COLUMNS.users.includes(c), c);
  assert.ok(EXCLUDED_COLUMNS.player_leagues.includes('invite_token'));
});

// ---- tue-4: the stats surface is views, and the base tables stay revoked ----
import { readFileSync } from 'node:fs';
import { statsGrants } from './crew-reader-grants.mjs';

test('the base tables behind the stats views are excluded and never re-granted', () => {
  const COLS2 = { users: ['id', 'created_at'], sessions: ['id'], daily_guest_runs: ['id'], daily_board_runs: ['id'], daily_boards: ['id'] };
  const plan = grantPlan(Object.keys(COLS2), (t) => COLS2[t]);
  assert.deepEqual(plan.map((p) => p.table), ['daily_boards'], 'only daily_boards (public game data) is granted');
  for (const t of ['users', 'sessions', 'daily_guest_runs', 'daily_board_runs']) assert.ok(EXCLUDED_TABLES.includes(t), t);
});

test('statsGrants: nothing without the schema; otherwise revoke, then usage + select', () => {
  assert.deepEqual(statsGrants(false), []);
  const g = statsGrants(true);
  assert.match(g[0], /^REVOKE ALL ON ALL TABLES IN SCHEMA crew_stats/);
  assert.ok(g.some((x) => /GRANT USAGE ON SCHEMA crew_stats/.test(x)));
  assert.ok(g.some((x) => /GRANT SELECT ON ALL TABLES IN SCHEMA crew_stats/.test(x)));
});

test('docs/crew/sportsvyn-stats reads only crew_stats.*_v - no base table, no VERIFY marker', () => {
  const src = readFileSync(new URL('../docs/crew/sportsvyn-stats', import.meta.url), 'utf8');
  const queries = src.split('\n').filter((l) => /^q \w+ "/.test(l));
  assert.ok(queries.length >= 20, 'the script has its queries');
  for (const l of queries) {
    const ctes = new Set([...l.matchAll(/\b([a-z_]+) AS \(SELECT/g)].map((m) => m[1]));
    for (const m of l.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/g)) {
      if (ctes.has(m[1])) continue;
      assert.match(m[1], /^crew_stats\.[a-z_]+_v$/, `${m[1]} in: ${l.slice(0, 60)}`);
    }
  }
  assert.ok(!/VERIFY/.test(src));
});

test('the migration names no sensitive column in any crew_stats view', () => {
  const sql = readFileSync(new URL('../migrations/143_crew_stats_views.sql', import.meta.url), 'utf8');
  const views = sql.split('CREATE OR REPLACE VIEW').slice(1).map((v) => v.split(';')[0]);
  assert.ok(views.length >= 11);
  for (const v of views) {
    // The select list, with the payload-derived counts and booleans taken out.
    const sel = v.slice(v.indexOf('SELECT'), v.indexOf('FROM public.'))
      .replace(/\(picks IS NOT NULL\)/g, '').replace(/\(SELECT count\(\*\) FROM [^)]*\)\)?/g, '')
      .replace(/jsonb_typeof\((?:board|lineup)\)|jsonb_array_length\(board\)/g, '');
    for (const bad of ['email', 'name', 'sessionToken', 'device_id', 'ip', 'image', 'handle', 'date_of_birth', 'lineup', 'picks', 'steps', 'board', 'join_code', 'invite_token']) {
      assert.ok(!new RegExp(`\\b${bad}\\b`).test(sel), `${bad} in view ${v.trim().slice(0, 40)}`);
    }
  }
});
