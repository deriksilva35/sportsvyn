#!/usr/bin/env node
// scripts/crew-probe-account.mjs - the crew lobby-probe account (users.is_probe, migration 150).
//
//   node scripts/crew-probe-account.mjs                      DEV, dry run: say what --apply would do
//   node scripts/crew-probe-account.mjs --apply              DEV: create-or-find the probe user (idempotent)
//   node scripts/crew-probe-account.mjs --mint-token | install -m 600 /dev/stdin ~/crew/secrets/probe.token
//   node scripts/crew-probe-account.mjs --mint-token --ttl-min 15 | ...     a short verification session
//   node scripts/crew-probe-account.mjs --revoke             delete the probe user's sessions
//   --prod                                                   target PROD_DATABASE_URL instead of DATABASE_URL
//
// WHAT THE ACCOUNT IS. A machine, never a person: crew/bin/lobby-probe signs in as it (a long-lived
// Auth.js database session) and loads GET / to prove the lobby renders for a signed-in reader. It has
// users.is_probe = true, which every users-table count and every email/push audience excludes
// (docs/reports/2026-11-03-probe-exclusion.md). Its address is on .invalid, which never delivers, and it is
// marked email_opted_out_at as a second lock. It has a handle, an adult date of birth (the proxy's age
// screen sends a signed-in reader without one to /age) and onboarded_at, so GET / renders the lobby
// instead of redirecting. It never enters a contest.
//
// THE TOKEN. --mint-token inserts one sessions row (expires now() + 365 days, or --ttl-min minutes) with
// token = crypto.randomBytes(32).toString('hex') and writes the token to STDOUT ONLY, nothing else on
// stdout. It REFUSES (exit 2, nothing written, database not contacted) when stdout is a terminal, so the
// only way to use it is a pipe into the secret file. The token is never in argv, never in a log line, never
// on stderr. --revoke ends every session of the probe user (they are then signed out on the next request).
//
// CREDENTIALS from the environment only: DATABASE_URL (DEV) / PROD_DATABASE_URL (--prod). Source
// `set -a && . ./.env.local && set +a`; no secret on a command line.
// Overrides for tests only: CREW_PROBE_EMAIL, CREW_PROBE_HANDLE (a sentinel row on DEV).
import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PROBE_EMAIL = 'crew-probe@sportsvyn.invalid';
export const PROBE_HANDLE = 'crewprobe';
const PROBE_NAME = 'crew probe';
const PROBE_DOB = '1990-01-01';          // an adult date: the age gate passes without asking
const YEAR_MIN = 365 * 24 * 60;

class Refused extends Error {}

export function parseFlags(argv) {
  const f = { prod: false, apply: false, mint: false, revoke: false, ttlMin: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prod') f.prod = true;
    else if (a === '--apply') f.apply = true;
    else if (a === '--mint-token') f.mint = true;
    else if (a === '--revoke') f.revoke = true;
    else if (a === '--ttl-min') {
      const v = argv[i + 1];
      if (!/^\d{1,7}$/.test(v ?? '') || Number(v) < 1) throw new Refused('--ttl-min needs a whole number of minutes');
      f.ttlMin = Number(v); i += 1;
    } else throw new Refused(`unknown argument: ${a.startsWith('--') ? a : '(not a flag)'}`);
  }
  if (f.ttlMin != null && !f.mint) throw new Refused('--ttl-min only goes with --mint-token');
  if (f.mint && (f.apply || f.revoke)) throw new Refused('--mint-token stands alone (run --apply first)');
  if (f.revoke && f.apply) throw new Refused('--revoke stands alone');
  return f;
}

export async function main({ argv, env, stdout, stderr, isTTY }) {
  const f = parseFlags(argv);
  // The TTY refusal comes FIRST: before any database contact, nothing written.
  if (f.mint && isTTY) throw new Refused('--mint-token writes the token to stdout and refuses a terminal: pipe it into the secret file');
  const url = f.prod ? env.PROD_DATABASE_URL : env.DATABASE_URL;
  if (!url) throw new Refused(`${f.prod ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} is not set in the environment`);
  const sql = neon(url);
  const email = env.CREW_PROBE_EMAIL || PROBE_EMAIL;
  const handle = env.CREW_PROBE_HANDLE || PROBE_HANDLE;
  const act = f.mint ? 'mint-token' : f.revoke ? 'revoke' : f.apply ? 'apply' : 'dry run';
  stderr(`TARGET ${f.prod ? 'PROD' : 'DEV'} ${new URL(url).host} ${act}`);

  const find = async () => (await sql`SELECT id, is_probe, handle FROM users WHERE lower(email) = lower(${email})`)[0] ?? null;
  const row = await find();
  if (row && !row.is_probe) throw new Refused(`a users row with the probe address exists and is NOT flagged is_probe (id ${row.id}): refusing to touch it`);

  if (f.mint) {
    if (!row) throw new Refused('no probe user yet: run with --apply first');
    const ttl = f.ttlMin ?? YEAR_MIN;
    const token = randomBytes(32).toString('hex');
    await sql`INSERT INTO sessions ("userId", expires, "sessionToken")
              VALUES (${row.id}, now() + make_interval(mins => ${ttl}), ${token})`;
    stderr(`minted one session for user ${row.id}, expires in ${ttl} min (${ttl === YEAR_MIN ? '365 days' : 'short'})`);
    stdout(token);
    return 0;
  }
  if (f.revoke) {
    if (!row) { stderr('no probe user: nothing to revoke'); return 0; }
    const gone = await sql`DELETE FROM sessions WHERE "userId" = ${row.id} RETURNING 1`;
    stderr(`revoked ${gone.length} session(s) of user ${row.id}`);
    return 0;
  }
  if (row) { stderr(`probe user exists: id ${row.id} handle ${row.handle ?? '-'}${f.apply ? ' (left as is)' : ''}`); return 0; }
  if (!f.apply) { stderr(`dry run: would create user ${email} (is_probe, handle ${handle}, adult date of birth, onboarded, opted out of mail). Re-run with --apply.`); return 0; }
  const clash = (await sql`SELECT id FROM users WHERE lower(handle) = lower(${handle})`)[0];
  if (clash) throw new Refused(`handle ${handle} is taken by user ${clash.id}`);
  const [made] = await sql`
    INSERT INTO users (name, email, handle, date_of_birth, onboarded_at, email_opted_out_at, morning_email, is_probe)
    VALUES (${PROBE_NAME}, ${email}, ${handle}, ${PROBE_DOB}::date, now(), now(), false, true)
    RETURNING id`;
  stderr(`created probe user id ${made.id}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main({
    argv: process.argv.slice(2), env: process.env,
    stdout: (s) => process.stdout.write(`${s}\n`),
    stderr: (s) => process.stderr.write(`${s}\n`),
    isTTY: Boolean(process.stdout.isTTY),
  }).then((code) => process.exit(code), (e) => {
    // Refusals are ours and carry no secret; anything else is reduced to its name.
    process.stderr.write(`crew-probe-account: ${e instanceof Refused ? e.message : `failed (${e?.name ?? 'Error'})`}\n`);
    process.exit(2);
  });
}
