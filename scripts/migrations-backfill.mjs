#!/usr/bin/env node
// scripts/migrations-backfill.mjs - ONE-TIME: write schema_migrations rows for
// the migrations that ran before the ledger existed (sun-18 item 4).
//
// FIRST, READ-ONLY. Every numbered migration (except the ledger migration
// itself) is parsed for the objects it leaves behind and checked against the
// target's catalog (lib/migrations/verify.mjs): verified / partial / missing /
// unverifiable. SELECTs only, through the neon HTTP driver; the default run
// stops there and writes nothing.
//
// THEN, ONLY WITH --apply: the ledger is bootstrapped if absent (the
// *_schema_migrations.sql migration is applied and records itself), and one
// row per verified or unverifiable migration is inserted in ONE transaction,
// with the current file checksum, applied_at NULL (nobody recorded when) and
// note 'backfilled ...'. --apply REFUSES while any migration is partial or
// missing, unless it is named in --pending (expected not yet applied - left
// out of the ledger so the apply script runs it later) or --skip (left out on
// purpose, for a human to resolve). Rows already in the ledger with the same
// checksum are left alone, so a re-run is a no-op; one with a different
// checksum is refused.
//
// Usage:
//   set -a && . ./.env.local && set +a
//   node scripts/migrations-backfill.mjs                       # DEV (DATABASE_URL), dry run
//   node scripts/migrations-backfill.mjs --prod                # PROD (PROD_DATABASE_URL), dry run
//   node scripts/migrations-backfill.mjs --prod --pending 126,127
//   node scripts/migrations-backfill.mjs --prod --apply        # writes the ledger
// Options:
//   --dir <path>     migrations directory (default: ./migrations)
//   --verbose        list every superseded object and every unchecked statement
//   --json <file>    also write the full verification result as JSON

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
import { neon } from '@neondatabase/serverless';
import { readMigrationsDir, duplicateMessage, ensureLedger, readLedger, LEDGER_TABLE } from '../lib/migrations/ledger.mjs';
import { parseMigration, loadCatalog, verifyUnits } from '../lib/migrations/verify.mjs';

const { Client } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const numList = (v) => new Set((v || '').split(',').filter(Boolean).map((x) => parseInt(x, 10)));

const PROD = flag('--prod');
const APPLY = flag('--apply');
const VERBOSE = flag('--verbose');
const DIR = opt('--dir') ? path.resolve(opt('--dir')) : path.join(__dirname, '..', 'migrations');
const PENDING = numList(opt('--pending'));
const SKIP = numList(opt('--skip'));
const JSON_OUT = opt('--json');

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error(`${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} is not set (source .env.local).`); process.exit(1); }
const isProd = !!process.env.PROD_DATABASE_URL && url === process.env.PROD_DATABASE_URL;

console.log('='.repeat(74));
console.log(`TARGET        ${isProd ? 'PROD' : 'DEV'}  ${new URL(url).host}`);
console.log(`FINGERPRINT   ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}`);
console.log(`MODE          ${APPLY ? 'APPLY (writes the ledger)' : 'dry run (SELECT only)'}`);
console.log(`MIGRATIONS    ${DIR}`);
console.log('='.repeat(74));

const dir = readMigrationsDir(DIR);
if (dir.duplicates.length) {
  console.error(`REFUSED: duplicate migration numbers in ${DIR}:\n${duplicateMessage(dir.duplicates)}`);
  process.exit(2);
}
if (dir.unnumbered.length) console.log(`not ledgered (unnumbered, DEV-only): ${dir.unnumbered.join(', ')}`);

const units = dir.units.filter((u) => !u.isLedger);
const ledgerUnit = dir.units.find((u) => u.isLedger);
const parsed = units.map((u) => ({
  number: u.number,
  name: u.name,
  parsed: parseMigration(u.files.map((f) => f.bytes.toString('utf8')).join('\n;\n')),
}));

const sql = neon(url);
const q = (text) => sql.query(text);
const cat = await loadCatalog(q);
const ledgerPresent = (await q(`SELECT to_regclass('${LEDGER_TABLE}') IS NOT NULL AS present`))[0].present;
const ledgerRows = ledgerPresent ? await q(`SELECT number, name, checksum FROM ${LEDGER_TABLE}`) : [];
const ledgered = new Map(ledgerRows.map((r) => [Number(r.number), r]));

const results = verifyUnits(parsed, cat);
const pad = (n) => String(n).padStart(3, '0');
const byVerdict = {};
for (const r of results) {
  if (PENDING.has(r.number) && r.verdict !== 'verified') r.verdict = `expected-pending (${r.verdict})`;
  (byVerdict[r.verdict] ||= []).push(r);
}

console.log(`\nledger table on target: ${ledgerPresent ? `present, ${ledgerRows.length} row(s)` : 'absent'}`);
console.log(`ledger migration: ${ledgerUnit ? ledgerUnit.name : 'NONE FOUND'}\n`);
for (const r of results) {
  const tail = r.checked ? `${r.present}/${r.checked} objects` : 'no checkable objects';
  const extra = [r.data ? `${r.data} data stmt` : null, r.superseded.length ? `${r.superseded.length} superseded` : null, r.drift.length ? `${r.drift.length} comment drift` : null]
    .filter(Boolean).join(', ');
  console.log(`${pad(r.number)}  ${r.verdict.padEnd(14)} ${r.name}  [${tail}${extra ? `; ${extra}` : ''}]`);
  for (const m of r.missing) console.log(`       MISSING  ${m}`);
  for (const d of r.drift) console.log(`       drift    ${d}`);
  for (const x of r.unrecognized) console.log(`       unrecognized  ${x}`);
  if (VERBOSE) {
    for (const x of r.superseded) console.log(`       superseded  ${x}`);
    for (const x of r.unchecked) console.log(`       unchecked   ${x}`);
  }
  const lr = ledgered.get(r.number);
  if (lr) {
    const u = units.find((x) => x.number === r.number);
    console.log(`       ledger: ${lr.checksum === u.checksum ? 'already recorded, same checksum' : `RECORDED WITH A DIFFERENT CHECKSUM (${lr.checksum.slice(0, 12)})`}`);
  }
}

console.log('\nSUMMARY');
for (const [v, rs] of Object.entries(byVerdict)) console.log(`  ${v.padEnd(32)} ${rs.length}  ${rs.map((r) => pad(r.number)).join(' ')}`);
const unverifiable = byVerdict.unverifiable || [];
if (unverifiable.length) {
  console.log('\nUNVERIFIABLE - ASSUMED APPLIED (for Derik): nothing in the catalog proves these ran.');
  for (const r of unverifiable) {
    const why = r.superseded.length ? `every object was later changed or dropped (${r.superseded.length})` : r.data ? `data only (${r.data} statement(s))` : 'no statements found';
    console.log(`  ${pad(r.number)} ${r.name} - ${why}`);
  }
}

if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));

const blocking = results.filter((r) => (r.verdict === 'missing' || r.verdict === 'partial') && !SKIP.has(r.number));
const changed = results.filter((r) => { const lr = ledgered.get(r.number); return lr && lr.checksum !== units.find((u) => u.number === r.number).checksum; });

if (!APPLY) {
  console.log(`\nDRY RUN - nothing written.${blocking.length ? ` --apply would REFUSE: ${blocking.map((r) => pad(r.number)).join(' ')} not verified (resolve, or name them in --pending / --skip).` : ''}`);
  process.exit(0);
}

if (blocking.length) {
  console.error(`\nREFUSED: ${blocking.map((r) => `${pad(r.number)} ${r.verdict}`).join(', ')}. Resolve, or name them in --pending / --skip.`);
  process.exit(2);
}
if (changed.length) {
  console.error(`\nREFUSED: already in the ledger with a different checksum: ${changed.map((r) => pad(r.number)).join(' ')}`);
  process.exit(2);
}

const toInsert = results.filter((r) =>
  (r.verdict === 'verified' || r.verdict === 'unverifiable') && !SKIP.has(r.number) && !ledgered.has(r.number));
const stamp = new Date().toISOString().slice(0, 10);
const appliedBy = `${os.userInfo().username}@${os.hostname()}`;

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const boot = await ensureLedger(client, dir.units, { appliedBy, log: (s) => console.log(s) });
  if (boot.created) console.log(`\nBOOTSTRAP: applied ${boot.unit.name} (created ${LEDGER_TABLE}, recorded itself)`);
  await client.query('BEGIN');
  for (const r of toInsert) {
    const u = units.find((x) => x.number === r.number);
    const note = `backfilled ${stamp}: ${r.verdict === 'verified' ? `verified ${r.present}/${r.checked} objects` : 'unverifiable - assumed applied'}`;
    await client.query(
      `INSERT INTO ${LEDGER_TABLE} (number, name, checksum, applied_at, applied_by, note) VALUES ($1, $2, $3, NULL, $4, $5)`,
      [u.number, u.name, u.checksum, appliedBy, note]
    );
  }
  await client.query('COMMIT');
  console.log(`\nAPPLIED: ${toInsert.length} ledger row(s) inserted. Left out: ${[...PENDING, ...SKIP].map(pad).join(' ') || 'none'}.`);
  const rows = await readLedger(client);
  console.log(`${LEDGER_TABLE} now holds ${rows.length} row(s).`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`FAILED, rolled back the backfill inserts: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
