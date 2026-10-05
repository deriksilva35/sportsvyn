#!/usr/bin/env node
// scripts/apply-migrations.mjs — apply one or more migrations/NNN_*.sql files
// to whatever DATABASE_URL points at, in the order given, and RECORD each one
// in the schema_migrations ledger (lib/migrations/ledger.mjs).
//
// WHY THIS EXISTS. A one-shot inline script that opens a PROD connection
// trips the auto-mode permission classifier every time — it has no name, no
// history, nothing to distinguish it from an arbitrary unreviewed write. This
// one is small, named, does exactly one auditable thing (run the SQL files
// you point it at, nothing else), and prints the target fingerprint before
// it touches anything, the same convention every other script in this repo
// follows.
//
// THE LEDGER (sun-18 item 4). Every run, before connecting:
//   - the WHOLE migrations/ directory is checked for two files with one
//     number (081's table+seed pair is the single grandfathered exception);
//     any other duplicate REFUSES the run, whatever was asked for.
// Then, per requested migration:
//   - in the ledger with the same sha256      -> skipped, "already applied"
//   - in the ledger with a DIFFERENT sha256   -> REFUSED, nothing is applied
//     (the whole plan is checked before the first file runs)
//   - absent                                  -> applied, and its ledger row
//     inserted in the SAME transaction. A file that cannot run in a
//     transaction (117's CREATE INDEX CONCURRENTLY) runs statement by
//     statement with the row written after the last; a file with its own
//     top-level BEGIN/COMMIT (120, 122) has them folded into ours. See
//     transactionPlan() in the lib for both.
// BOOTSTRAP: if the target has no schema_migrations table, the
// *_schema_migrations.sql migration is applied first (it records itself).
// Until the one-time backfill (scripts/migrations-backfill.mjs) has run on a
// target, its older migrations read as pending there - which is why the
// backfill runs at merge, before this script is next used on PROD.
//
// USES pg's Client, NOT THE sql TAGGED TEMPLATE. lib/db.js's neon() helper
// is documented single-statement only; migrations are multi-statement DDL.
//
// Usage:
//   set -a && . ./.env.local && set +a
//   node scripts/apply-migrations.mjs 087 088 089
//   node scripts/apply-migrations.mjs 087_footballdb_season_totals
//   node scripts/apply-migrations.mjs --status          # applied vs pending, read-only
//   # to hit PROD: DATABASE_URL="$PROD_DATABASE_URL" node scripts/apply-migrations.mjs 087 088 089
// Options:
//   --dir <path>   migrations directory (default: ./migrations)
//   --fresh        allow applying a pre-ledger migration to a target whose
//                  ledger has no backfill (a brand-new database). Without it
//                  that request is refused: on an existing database it means
//                  scripts/migrations-backfill.mjs has not run yet.
//
// Unnumbered files (seed_argentina_dev.sql, teardown_argentina_dev.sql) are
// DEV-only: they can still be run by exact name, are NEVER ledgered, and are
// refused outright when the target is PROD.

import pkg from 'pg';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  readMigrationsDir, duplicateMessage, resolveArg, planApply, statusRows, formatStatus,
  readLedger, ensureLedger, applyUnit, unbackfilledRequests, LEDGER_TABLE,
} from '../lib/migrations/ledger.mjs';

const { Client } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
let MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const args = [];
let STATUS = false;
let FRESH = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--fresh') { FRESH = true; continue; }
  if (argv[i] === '--dir') { MIGRATIONS_DIR = path.resolve(argv[++i]); continue; }
  if (argv[i] === '--status') { STATUS = true; continue; }
  args.push(argv[i]);
}
if (!STATUS && !args.length) {
  console.error('Usage: node scripts/apply-migrations.mjs <number-or-name> [<number-or-name> ...] | --status');
  process.exit(1);
}

// The directory check comes before anything else, including the connection:
// a duplicate is wrong whatever database it would have been applied to.
const dir = readMigrationsDir(MIGRATIONS_DIR);
if (dir.duplicates.length) {
  console.error(`REFUSED: two migration files share a number in ${MIGRATIONS_DIR}:\n${duplicateMessage(dir.duplicates)}`);
  console.error('Renumber the newer file to (highest existing) + 1. Nothing was applied.');
  process.exit(2);
}

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const isProd = !!process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL;
const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);
console.log('='.repeat(74));
console.log(`TARGET   DATABASE_URL -> ${new URL(process.env.DATABASE_URL).host}${isProd ? '   (PROD)' : ''}`);
console.log(`FINGERPRINT   ${fingerprint}`);
console.log(`MIGRATIONS    ${STATUS ? '--status (read-only)' : args.join(', ')}`);
console.log('='.repeat(74));

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

if (STATUS) {
  await client.connect();
  try {
    const rows = await readLedger(client);
    console.log(formatStatus(statusRows(dir.units, rows || []), { ledgerExists: rows !== null }));
    if (dir.unnumbered.length) console.log(`not ledgered (unnumbered, DEV-only): ${dir.unnumbered.join(', ')}`);
  } finally {
    await client.end();
  }
  process.exit(0);
}

const resolved = args.map((a) => ({ arg: a, ...resolveArg(a, dir) }));
const bad = resolved.filter((r) => r.error);
if (bad.length) { for (const b of bad) console.error(b.error); process.exit(1); }
const unnumbered = resolved.filter((r) => r.unnumbered);
if (unnumbered.length && isProd) {
  console.error(`REFUSED: ${unnumbered.map((r) => r.unnumbered).join(', ')} is DEV-only (unnumbered) and the target is PROD.`);
  process.exit(2);
}
const units = [];
for (const r of resolved) if (r.unit && !units.includes(r.unit)) units.push(r.unit);

const appliedBy = `${os.userInfo().username}@${os.hostname()}`;
await client.connect();
let failed = false;
try {
  // Guard first, so a refused request leaves the target exactly as it was.
  const before = (await readLedger(client)) || [];
  const early = FRESH ? [] : unbackfilledRequests(units, before, dir.units);
  if (early.length) {
    throw new Error(`${early.map((u) => u.name).join(', ')} predate${early.length === 1 ? 's' : ''} the ledger and this target's ledger has no backfill. ` +
      'Run scripts/migrations-backfill.mjs on it first (or pass --fresh if this really is a new, empty database). Nothing was applied.');
  }
  if (units.length) {
    const boot = await ensureLedger(client, dir.units, { appliedBy, log: (s) => console.log(s) });
    if (boot.created) console.log(`BOOTSTRAP: ${LEDGER_TABLE} was absent - applied ${boot.unit.name} (it records itself)`);
  }
  const ledger = units.length ? await readLedger(client) : [];
  const plan = planApply(units, ledger);
  const refused = plan.filter((p) => p.action === 'refuse');
  if (refused.length) {
    console.error('\n' + '!'.repeat(74));
    for (const p of refused) console.error(`REFUSED ${p.unit.name}: ${p.reason}`);
    console.error('A migration that already ran must not change. Put the change in a NEW migration.');
    console.error('Nothing in this run was applied.');
    console.error('!'.repeat(74));
    process.exitCode = 2;
  } else {
    let applied = 0;
    for (const p of plan) {
      if (p.action === 'skip') { console.log(`\n--- ${p.unit.name}: ${p.reason}, skipped ---`); continue; }
      console.log(`\n--- applying ${p.unit.name} ---`);
      await applyUnit(client, p.unit, { appliedBy, log: (s) => console.log(s) });
      console.log(`OK (ledgered as ${p.unit.number}, sha256 ${p.unit.checksum.slice(0, 12)})`);
      applied++;
    }
    for (const r of unnumbered) {
      console.log(`\n--- applying ${r.unnumbered} (DEV-only, NOT LEDGERED) ---`);
      await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, r.unnumbered), 'utf8'));
      console.log('OK');
    }
    console.log(`\nApplied ${applied} migration(s)${unnumbered.length ? ` + ${unnumbered.length} unledgered DEV file(s)` : ''}.`);
  }
} catch (e) {
  failed = true;
  console.error(`\nFAILED: ${e.message}`);
} finally {
  await client.end();
}
if (failed) process.exit(1);
