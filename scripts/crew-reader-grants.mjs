// scripts/crew-reader-grants.mjs - the crew's READ-ONLY Postgres role (wed-4).
//
//   node scripts/crew-reader-grants.mjs                 DEV, dry run: print the grant list
//   node scripts/crew-reader-grants.mjs --apply         DEV: create/refresh the role and grants
//   node scripts/crew-reader-grants.mjs --prod [--apply] PROD (Derik's GO only)
//
// Credentials from the environment only: DATABASE_URL (DEV) / PROD_DATABASE_URL,
// and CREW_READER_PASSWORD for the role's password. Never on a command line.
//
// crew_reader: LOGIN, SELECT only, default_transaction_read_only on, a 30 s
// statement timeout. FAIL CLOSED: every run REVOKEs everything and grants the
// tables that exist NOW, so a table added later is invisible until this runs
// again (app_errors grants itself in its own migration). Excluded below: the
// auth/OTP/token tables whole, and the email/identity/token/payload columns
// of tables the crew otherwise needs (a column grant lists every other column).
//
// STATS SURFACE (tue-4, migration 143): the Pulse stats script reads ONLY the views in
// schema crew_stats (users_v, sessions_v, ... - no email, token, IP or payload
// columns); every run revokes crew_stats and re-grants USAGE + SELECT on the views.
// THE ASSISTANT (fri-1): CrewOS's read-only SQL asks for the base tables by name
// ("FROM users"), so users, sessions, daily_board_runs and daily_guest_runs are
// granted by COLUMN with the same columns withheld as the views (EXCLUDED_COLUMNS).
// The login token, email, name, date of birth, handle, device id, IP and pick
// payloads stay unreadable either way.
// CREW-BIN (crew/bin watcher scripts): four more views, defined HERE and created in the same
// --apply transaction, BEFORE the grants: app_errors_v, boards_v, retention_ages_v,
// provider_freshness_v (CREW_VIEWS below; the SQL is the contract, no PII column in any of them).
// They run with the owner's rights, so crew_reader needs no grant on push_sends (withheld whole)
// or on the other base tables behind them.
// A password is set only when the role is NEW or CREW_READER_PASSWORD is given: an
// existing role keeps its password (the crew's stored secret) when the variable is
// absent.
//
// RE-RUN after a migration adds a table the Watcher should read.

import { neon } from '@neondatabase/serverless';

const ROLE = 'crew_reader';
const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');

/** Whole tables the crew never reads: auth accounts, one-time codes, push tokens, signups. */
export const EXCLUDED_TABLES = Object.freeze([
  'accounts', 'verification_token', 'email_otp', 'auth_throttle',
  'email_signups', 'device_tokens', 'live_activities',
  // tue-6 sweep of the 92 readable tables: purchase events (app_user_id, product),
  // subscription state (Stripe ids), push send log (device-linked, message text) and
  // join-code invites. The Watcher reads none of them.
  'revenuecat_events', 'memberships', 'push_sends', 'draft_config_invites',
]);

/** Columns withheld from tables the crew does read. */
export const EXCLUDED_COLUMNS = Object.freeze({
  // fri-1 (CrewOS assistant): users, sessions and the two Daily run tables are
  // COLUMN-granted, holding back exactly what the crew_stats views hold back:
  // identity and contact columns, the login token, pick payloads, device and IP.
  users: ['email', 'emailVerified', 'contact_email', 'contact_email_at', 'email_opted_out_at', 'date_of_birth', 'name', 'image', 'handle'],
  sessions: ['sessionToken'],
  daily_board_runs: ['picks', 'steps'],
  // Guest runs: written and read by lib/daily/guestRuns.js alone (its guard test);
  // named here only to withhold the device, IP and payload columns.
  daily_guest_runs: ['device_id', 'ip', 'picks', 'steps'],
  player_leagues: ['join_code', 'invite_token'],
  draft_config_invites: ['code'],
  memberships: ['stripe_customer_id', 'stripe_subscription_id'],
  push_sends: ['device_token'],
});

/** PURE. The crew_stats surface: fail closed, then USAGE + SELECT on the views. */
export function statsGrants(schemaExists) {
  if (!schemaExists) return [];
  return [
    `REVOKE ALL ON ALL TABLES IN SCHEMA crew_stats FROM ${ROLE}`,
    `GRANT USAGE ON SCHEMA crew_stats TO ${ROLE}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA crew_stats TO ${ROLE}`,
  ];
}

/**
 * The views crew/bin reads (crew-bin). CREATE OR REPLACE, so a re-run refreshes them.
 * NO email, handle, IP, token, message text or payload in any of them:
 *   app_errors_v      the error SIGNATURE (service, hash, counts, times) - never the message text.
 *   boards_v          contests' schedule columns - never the board, perfect or meta payloads.
 *   retention_ages_v  per tracked table, row counts by whole-day age from its retention clock
 *                     (app_errors.ts, push_sends.sent_at, daily_guest_runs.started_at,
 *                     sessions.expires = days since EXPIRY, negative while valid).
 *   provider_freshness_v  one row per feed: when it last wrote, how stale is too stale
 *                     (max_age_min) and whether a write is expected right now (expected).
 * Cadences: docs/crew/watch-rules.md, "provider-health".
 */
export const CREW_VIEWS = Object.freeze([
  { name: 'app_errors_v', sql: `SELECT id, service, count, first_seen, ts, stack_hash FROM public.app_errors` },
  {
    name: 'boards_v',
    sql: `SELECT id, game_type, sport, season_year, week, opens_at, locks_at, settles_at, settled FROM public.contests`,
  },
  {
    name: 'retention_ages_v',
    sql: `SELECT 'app_errors'::text AS table_name, floor(extract(epoch FROM (now() - ts)) / 86400)::int AS age_days, count(*)::bigint AS row_count
            FROM public.app_errors GROUP BY 2
          UNION ALL
          SELECT 'push_sends', floor(extract(epoch FROM (now() - sent_at)) / 86400)::int, count(*)::bigint
            FROM public.push_sends GROUP BY 2
          UNION ALL
          SELECT 'daily_guest_runs', floor(extract(epoch FROM (now() - started_at)) / 86400)::int, count(*)::bigint
            FROM public.daily_guest_runs GROUP BY 2
          UNION ALL
          SELECT 'sessions', floor(extract(epoch FROM (now() - expires)) / 86400)::int, count(*)::bigint
            FROM public.sessions GROUP BY 2`,
  },
  {
    name: 'provider_freshness_v',
    sql: `SELECT 'bdl'::text AS provider,
                 (SELECT max(updated_at) FROM public.matches WHERE external_ids ? 'bdl_game_id') AS last_ok_at,
                 30 AS max_age_min,
                 EXISTS (SELECT 1 FROM public.matches WHERE status = 'live' AND external_ids ? 'bdl_game_id') AS expected
          UNION ALL
          SELECT 'cfbd',
                 (SELECT max(updated_at) FROM public.matches WHERE external_ids ? 'cfbd_game_id'),
                 60,
                 EXISTS (SELECT 1 FROM public.matches m JOIN public.leagues l ON l.id = m.league_id
                          WHERE l.slug = 'cfb' AND m.status = 'live')
          UNION ALL
          SELECT 'odds',
                 (SELECT max(fetched_at) FROM public.odds_markets),
                 180,
                 extract(hour FROM (now() AT TIME ZONE 'UTC')) >= 8
                   AND EXISTS (SELECT 1 FROM public.odds_markets WHERE fetched_at >= now() - interval '3 days')
          UNION ALL
          SELECT 'ffc',
                 (SELECT (max(snapshot_date)::timestamp AT TIME ZONE 'UTC') FROM public.sim_player_pool),
                 2280,
                 true
          UNION ALL
          SELECT 'injuries',
                 (SELECT max(started_at) FROM public.sync_runs WHERE source = 'wire' AND ok),
                 60,
                 EXISTS (SELECT 1 FROM public.matches m JOIN public.leagues l ON l.id = m.league_id
                          WHERE l.slug = 'nfl' AND m.kickoff_at BETWEEN now() - interval '7 days' AND now() + interval '7 days')`,
  },
]);

/** PURE. The statements that (re)create the schema and views, run before the grants. */
export function viewStatements() {
  return [
    'CREATE SCHEMA IF NOT EXISTS crew_stats',
    ...CREW_VIEWS.map((v) => `CREATE OR REPLACE VIEW crew_stats.${v.name} AS ${v.sql}`),
  ];
}

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

/** PURE. -> [{ table, columns: null | [..] }] for the tables that exist. */
export function grantPlan(tables, columnsOf) {
  const out = [];
  for (const t of [...tables].sort()) {
    if (EXCLUDED_TABLES.includes(t)) continue;
    const hide = EXCLUDED_COLUMNS[t];
    if (!hide) { out.push({ table: t, columns: null }); continue; }
    out.push({ table: t, columns: columnsOf(t).filter((c) => !hide.includes(c)) });
  }
  return out;
}

async function main() {
  const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} is not set`);
  const sql = neon(url);
  const host = new URL(url).host;
  console.log(`TARGET ${PROD ? 'PROD' : 'DEV'} ${host} ${APPLY ? 'APPLY' : 'dry run'}`);

  const cols = await sql`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position`;
  const byTable = new Map();
  for (const r of cols) (byTable.get(r.table_name) ?? byTable.set(r.table_name, []).get(r.table_name)).push(r.column_name);
  const plan = grantPlan([...byTable.keys()], (t) => byTable.get(t));

  for (const p of plan) console.log(`  ${p.table}${p.columns ? ` (${p.columns.length} of ${byTable.get(p.table).length} columns)` : ''}`);
  console.log(`crew_stats views created on --apply: ${CREW_VIEWS.map((v) => v.name).join(', ')}`);
  console.log(`grants: ${plan.length} tables (${plan.filter((p) => p.columns).length} column-limited); excluded: ${EXCLUDED_TABLES.filter((t) => byTable.has(t)).join(', ')}`);
  if (!APPLY) return;

  const pw = process.env.CREW_READER_PASSWORD;
  const db = (await sql`SELECT current_database() AS d`)[0].d;
  const [exists] = await sql`SELECT 1 AS x FROM pg_roles WHERE rolname = ${ROLE}`;
  if ((!exists && !pw) || (pw && pw.length < 24)) throw new Error('CREW_READER_PASSWORD (24+ chars) is not set');
  const lit = pw ? `'${pw.replace(/'/g, "''")}'` : null;
  const stmts = [
    ...(exists
      ? [pw ? `ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${lit}` : `ALTER ROLE ${ROLE} WITH LOGIN`]
      : [`CREATE ROLE ${ROLE} WITH LOGIN NOINHERIT PASSWORD ${lit}`]),
    `ALTER ROLE ${ROLE} SET default_transaction_read_only = on`,
    `ALTER ROLE ${ROLE} SET statement_timeout = '30s'`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE}`,
    `REVOKE CREATE ON SCHEMA public FROM ${ROLE}`,
    `GRANT CONNECT ON DATABASE ${q(db)} TO ${ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
    ...plan.map((p) => p.columns
      ? `GRANT SELECT (${p.columns.map(q).join(', ')}) ON public.${q(p.table)} TO ${ROLE}`
      : `GRANT SELECT ON public.${q(p.table)} TO ${ROLE}`),
    // crew-bin: the schema and the four views exist before the grants run (the schema is always
    // there after this, so the stats surface is always granted).
    ...viewStatements(),
    ...statsGrants(true),
  ];
  // One transaction: a failure part-way leaves the previous grants as they were.
  await sql.transaction(stmts.map((s) => sql.query(s)));
  console.log(`applied: ${stmts.length} statements`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
