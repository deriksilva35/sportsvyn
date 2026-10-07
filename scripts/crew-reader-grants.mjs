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
// auth/session/OTP/token tables whole, and the email/identity/token columns
// of tables the crew otherwise needs (a column grant lists every other column).
//
// RE-RUN after a migration adds a table the Watcher should read.

import { neon } from '@neondatabase/serverless';

const ROLE = 'crew_reader';
const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');

/** Whole tables the crew never reads: auth, sessions, one-time codes, push tokens, signups. */
export const EXCLUDED_TABLES = Object.freeze([
  'accounts', 'sessions', 'verification_token', 'email_otp', 'auth_throttle',
  'email_signups', 'device_tokens', 'live_activities',
]);

/** Columns withheld from tables the crew does read. */
export const EXCLUDED_COLUMNS = Object.freeze({
  users: ['email', 'emailVerified', 'contact_email', 'contact_email_at', 'email_opted_out_at', 'date_of_birth', 'name', 'image'],
  player_leagues: ['join_code', 'invite_token'],
  draft_config_invites: ['code'],
  daily_guest_runs: ['ip', 'device_id'],
  memberships: ['stripe_customer_id', 'stripe_subscription_id'],
  push_sends: ['device_token'],
});

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
  console.log(`grants: ${plan.length} tables (${plan.filter((p) => p.columns).length} column-limited); excluded: ${EXCLUDED_TABLES.filter((t) => byTable.has(t)).join(', ')}`);
  if (!APPLY) return;

  const pw = process.env.CREW_READER_PASSWORD;
  if (!pw || pw.length < 24) throw new Error('CREW_READER_PASSWORD (24+ chars) is not set');
  const db = (await sql`SELECT current_database() AS d`)[0].d;
  const [exists] = await sql`SELECT 1 AS x FROM pg_roles WHERE rolname = ${ROLE}`;
  const lit = `'${pw.replace(/'/g, "''")}'`;
  const stmts = [
    exists ? `ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${lit}` : `CREATE ROLE ${ROLE} WITH LOGIN NOINHERIT PASSWORD ${lit}`,
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
  ];
  // One transaction: a failure part-way leaves the previous grants as they were.
  await sql.transaction(stmts.map((s) => sql.query(s)));
  console.log(`applied: ${stmts.length} statements`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
