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

test('auth/token tables are never granted; withheld columns never listed', () => {
  const plan = grantPlan([...Object.keys(COLS), 'accounts', 'email_otp'], (t) => COLS[t] ?? ['id']);
  const by = Object.fromEntries(plan.map((p) => [p.table, p.columns]));
  assert.ok(!('accounts' in by) && !('email_otp' in by));
  assert.equal(by.matches, null, 'a clean table is granted whole');
  assert.equal(by.app_errors, null, 'the crew reads app_errors');
  // fri-1: the assistant reads users and sessions by COLUMN - never the token or the identity.
  assert.deepEqual(by.users, ['id'], 'users: no email, handle, name, date of birth or contact email');
  assert.deepEqual(by.sessions, ['id'], 'sessions: never the sessionToken');
  assert.deepEqual(by.player_leagues, ['id', 'name']);
});

test('the exclusion lists name the auth tables and every email/token/identity column', () => {
  for (const t of ['accounts', 'verification_token', 'email_otp', 'email_signups', 'device_tokens']) assert.ok(EXCLUDED_TABLES.includes(t), t);
  assert.ok(EXCLUDED_COLUMNS.sessions.includes('sessionToken'), 'the login token is never readable');
  for (const c of ['email', 'contact_email', 'date_of_birth', 'emailVerified']) assert.ok(EXCLUDED_COLUMNS.users.includes(c), c);
  assert.ok(EXCLUDED_COLUMNS.player_leagues.includes('invite_token'));
});

// ---- tue-4: the stats surface is views, and the base tables stay revoked ----
import { readFileSync } from 'node:fs';
import { statsGrants } from './crew-reader-grants.mjs';

test('fri-1: the base tables behind the stats views are COLUMN-granted, withholding what the views withhold', () => {
  // The PROD column lists as of 17 Oct 2026.
  const COLS2 = {
    users: ['id', 'name', 'email', 'emailVerified', 'image', 'created_at', 'first_seen_context', 'email_opted_out_at', 'handle',
      'handle_changed_at', 'contact_email', 'contact_email_at', 'onboarded_at', 'push_prompted_at', 'push_choice', 'last_seen_at', 'is_house', 'date_of_birth'],
    sessions: ['id', 'userId', 'expires', 'sessionToken'],
    daily_board_runs: ['id', 'board_id', 'user_id', 'picks', 'score', 'pct', 'matched', 'elapsed_s', 'completed_at', 'started_at', 'tz', 'late_claim', 'steps'],
    daily_guest_runs: ['id', 'board_id', 'device_id', 'ip', 'started_at', 'picks', 'score', 'pct', 'matched', 'elapsed_s', 'completed_at',
      'claim_expires_at', 'claimed_by', 'claimed_at', 'claimed_day', 'steps'],
  };
  const by = Object.fromEntries(grantPlan(Object.keys(COLS2), (t) => COLS2[t]).map((p) => [p.table, p.columns]));
  const never = ['email', 'emailVerified', 'contact_email', 'contact_email_at', 'email_opted_out_at', 'name', 'image', 'handle',
    'date_of_birth', 'sessionToken', 'picks', 'steps', 'device_id', 'ip'];
  for (const [t, cols] of Object.entries(by)) {
    assert.ok(Array.isArray(cols) && cols.length, `${t} is column-limited, never whole`);
    for (const c of never) assert.ok(!cols.includes(c), `${t}.${c} is never granted`);
  }
  assert.deepEqual(by.sessions, ['id', 'userId', 'expires']);
  assert.ok(by.users.includes('created_at') && by.users.includes('last_seen_at') && by.users.includes('is_house'));
  assert.ok(by.daily_board_runs.includes('score') && by.daily_guest_runs.includes('claimed_by'));
  for (const t of Object.keys(COLS2)) assert.ok(!EXCLUDED_TABLES.includes(t), t);
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

test('tue-6: purchase, subscription, push-log and invite tables are withheld whole', () => {
  const COLS3 = { revenuecat_events: ['event_id'], memberships: ['user_id', 'status'], push_sends: ['id'], draft_config_invites: ['id'], matches: ['id'] };
  const plan = grantPlan(Object.keys(COLS3), (t) => COLS3[t]);
  assert.deepEqual(plan.map((p) => p.table), ['matches']);
  for (const t of ['revenuecat_events', 'memberships', 'push_sends', 'draft_config_invites']) assert.ok(EXCLUDED_TABLES.includes(t), t);
});

// ---- crew-bin: the four views crew/bin reads, created in the apply transaction ----
import { CREW_VIEWS, viewStatements } from './crew-reader-grants.mjs';

test('crew-bin views: the four names, schema first, every statement a CREATE OR REPLACE in crew_stats', () => {
  assert.deepEqual(CREW_VIEWS.map((v) => v.name), ['app_errors_v', 'boards_v', 'retention_ages_v', 'provider_freshness_v']);
  const st = viewStatements();
  assert.equal(st[0], 'CREATE SCHEMA IF NOT EXISTS crew_stats');
  assert.equal(st.length, 5);
  for (const s of st.slice(1)) assert.match(s, /^CREATE OR REPLACE VIEW crew_stats\.[a-z_]+_v AS SELECT /);
});

test('crew-bin views carry no email, handle, IP, token, message text or payload column', () => {
  const never = ['email', 'handle', 'ip', 'device_token', 'sessionToken', 'message', 'picks', 'steps', 'board', 'perfect', 'meta', 'payload', 'name', 'error'];
  for (const v of CREW_VIEWS) {
    // The names a view EXPOSES: every `AS alias` plus the bare columns of a plain select list.
    const exposed = [...v.sql.matchAll(/\bAS\s+([a-z_]+)/g)].map((m) => m[1]);
    const plain = v.sql.match(/^SELECT ([a-z_, ]+) FROM public\./)?.[1].split(',').map((c) => c.trim()) ?? [];
    for (const c of [...exposed, ...plain]) assert.ok(!never.includes(c), `${v.name} exposes ${c}`);
  }
  const by = Object.fromEntries(CREW_VIEWS.map((v) => [v.name, v.sql]));
  assert.ok(!/\bmessage\b/.test(by.app_errors_v), 'app_errors: the signature, never the message text');
  assert.match(by.boards_v, /FROM public\.contests$/);
  assert.ok(!/\b(board|perfect|meta)\b/.test(by.boards_v.replace(/game_type/g, '')), 'boards: schedule columns only');
  // push_sends is withheld whole from the role; only the owner-rights view reads it, as counts by age.
  assert.ok(EXCLUDED_TABLES.includes('push_sends'));
  assert.match(by.retention_ages_v, /count\(\*\)::bigint AS row_count/);
  assert.ok(!/device_token/.test(by.retention_ages_v));
});

test('crew-bin: the apply transaction creates the views BEFORE the stats grants', () => {
  const src = readFileSync(new URL('./crew-reader-grants.mjs', import.meta.url), 'utf8');
  assert.ok(src.indexOf('...viewStatements()') > 0 && src.indexOf('...viewStatements()') < src.indexOf('...statsGrants(true)'));
  assert.ok(src.includes('sql.transaction(stmts.map'), 'one transaction: a failure leaves the previous grants');
});
