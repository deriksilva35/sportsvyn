// lib/migrations/ledger.db.test.mjs - the ledger against a real Postgres
// (DEV), inside a THROWAWAY SCHEMA: bootstrap, apply + ledger row in one
// transaction, rollback on failure, skip-if-applied, changed-checksum
// refusal, the folded BEGIN/COMMIT, the no-transaction path, status, and the
// backfill's catalog check. after() drops the schema and asserts it is gone.
//
// WHY THE DIRECT HOST. The suite's DATABASE_URL is Neon's -pooler endpoint
// (PgBouncer, transaction mode): a `SET search_path` there does not survive
// to the next statement, and this test's unqualified DDL would land in
// public. The test connects to the same database through the direct host
// (the URL with '-pooler' removed) and asserts current_schema() before it
// writes anything.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
import {
  readMigrationsDir, ensureLedger, readLedger, applyUnit, planApply, statusRows, ledgerExists,
} from './ledger.mjs';
import { parseMigration, loadCatalog, verifyUnits } from './verify.mjs';

const { Client } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_LEDGER_FILE = fs.readdirSync(path.join(__dirname, '..', '..', 'migrations')).find((f) => f.endsWith('_schema_migrations.sql'));

const SCHEMA = `zz_migledger_${process.pid}_${Date.now().toString(36)}`;
let client;
let tmp;
let dir;

function directUrl(u) {
  const url = new URL(u);
  url.hostname = url.hostname.replace('-pooler.', '.');
  return url.toString();
}

function write(name, text) { fs.writeFileSync(path.join(tmp, name), text); }
function reload() { dir = readMigrationsDir(tmp); return dir; }
const unit = (n) => dir.units.find((u) => u.number === n);

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL (source .env.local)');
  assert.notEqual(process.env.DATABASE_URL, process.env.PROD_DATABASE_URL, 'never against PROD');
  client = new Client({ connectionString: directUrl(process.env.DATABASE_URL), ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  const { rows } = await client.query('SELECT current_schema() AS s');
  assert.equal(rows[0].s, SCHEMA, 'search_path holds on this connection');

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migledger-db-'));
  // The real ledger migration, renumbered into this little sequence.
  fs.copyFileSync(path.join(__dirname, '..', '..', 'migrations', REAL_LEDGER_FILE), path.join(tmp, '009_schema_migrations.sql'));
  write('001_widgets.sql', `CREATE TABLE zz_widgets (id int PRIMARY KEY, label text NOT NULL);\nINSERT INTO zz_widgets VALUES (1, 'one');\n`);
  write('002_own_tx.sql', `BEGIN;\nALTER TABLE zz_widgets ADD COLUMN size int;\nALTER TABLE zz_widgets ADD CONSTRAINT zz_widgets_size_check CHECK (size > 0);\nCOMMIT;\n`);
  write('003_concurrently.sql', `-- cannot run in a transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS zz_widgets_label_idx ON zz_widgets (label);\n`);
  write('004_fails.sql', `CREATE TABLE zz_never (id int);\nSELECT 1/0;\n`);
  write('005_own_tx_fails.sql', `BEGIN;\nCREATE TABLE zz_never_either (id int);\nCOMMIT;\nSELECT 1/0;\n`);
  reload();
});

after(async () => {
  if (client) {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [SCHEMA]);
    const leaked = await client.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                                        WHERE n.nspname = 'public' AND (c.relname LIKE 'zz\\_widgets%' OR c.relname LIKE 'zz\\_never%')`);
    await client.end();
    assert.equal(rows[0].n, 0, 'test schema dropped');
    assert.equal(leaked.rows[0].n, 0, 'nothing leaked into public');
  }
  if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); assert.equal(fs.existsSync(tmp), false); }
});

test('bootstrap: no ledger -> the ledger migration is applied and records itself', async () => {
  assert.equal(await ledgerExists(client), false);
  assert.equal(await readLedger(client), null);
  const boot = await ensureLedger(client, dir.units, { appliedBy: 'test' });
  assert.equal(boot.created, true);
  const rows = await readLedger(client);
  assert.deepEqual(rows.map((r) => [r.number, r.name, r.checksum]), [[9, '009_schema_migrations.sql', unit(9).checksum]]);
  assert.equal((await ensureLedger(client, dir.units)).created, false, 'second call is a no-op');
});

test('apply: the DDL and its ledger row land together; a re-plan skips it', async () => {
  await applyUnit(client, unit(1), { appliedBy: 'test' });
  const { rows } = await client.query('SELECT label FROM zz_widgets');
  assert.deepEqual(rows, [{ label: 'one' }]);
  const ledger = await readLedger(client);
  const row = ledger.find((r) => r.number === 1);
  assert.equal(row.checksum, unit(1).checksum);
  assert.ok(row.applied_at instanceof Date);
  assert.equal(row.applied_by, 'test');
  assert.deepEqual(planApply([unit(1)], ledger).map((p) => p.action), ['skip']);
});

test('transaction wrap: a failing file leaves neither its DDL nor a ledger row', async () => {
  await assert.rejects(applyUnit(client, unit(4)), /division by zero/);
  const t = await client.query(`SELECT to_regclass('zz_never') AS t`);
  assert.equal(t.rows[0].t, null, 'CREATE TABLE rolled back');
  assert.ok(!(await readLedger(client)).some((r) => r.number === 4), 'no ledger row');
});

test('a file\'s own BEGIN/COMMIT are folded: applied atomically with its row', async () => {
  await applyUnit(client, unit(2));
  const c = await client.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'zz_widgets_size_check'`);
  assert.equal(c.rows[0].n, 1);
  assert.ok((await readLedger(client)).some((r) => r.number === 2));

  // Without folding, 005's own COMMIT would have committed zz_never_either
  // before the error. Folded, the whole file rolls back.
  await assert.rejects(applyUnit(client, unit(5)), /division by zero/);
  const t = await client.query(`SELECT to_regclass('zz_never_either') AS t`);
  assert.equal(t.rows[0].t, null, 'folded file rolled back as a whole');
  assert.ok(!(await readLedger(client)).some((r) => r.number === 5));
});

test('CREATE INDEX CONCURRENTLY runs outside a transaction and is still ledgered', async () => {
  const r = await applyUnit(client, unit(3));
  assert.equal(r.mode, 'none');
  const i = await client.query(`SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'zz_widgets_label_idx'`);
  assert.deepEqual(i.rows, [{ indisvalid: true }]);
  assert.ok((await readLedger(client)).some((r) => r.number === 3));
});

test('a changed file is refused; the primary key refuses a second row for one number', async () => {
  write('001_widgets.sql', `CREATE TABLE zz_widgets (id int PRIMARY KEY, label text NOT NULL, extra int);\n`);
  reload();
  const ledger = await readLedger(client);
  const [p] = planApply([unit(1)], ledger);
  assert.equal(p.action, 'refuse');
  assert.match(p.reason, /CHANGED since it was applied/);
  await assert.rejects(applyUnit(client, unit(1)), /duplicate key|already exists/);
  const n = await client.query('SELECT count(*)::int AS n FROM schema_migrations WHERE number = 1');
  assert.equal(n.rows[0].n, 1);
});

test('status: applied / CHANGED / pending', async () => {
  const rows = statusRows(dir.units, await readLedger(client));
  assert.deepEqual(rows.map((r) => [r.number, r.state]), [
    [1, 'CHANGED'], [2, 'applied'], [3, 'applied'], [4, 'pending'], [5, 'pending'], [9, 'applied'],
  ]);
});

test('backfill catalog check reads the same schema: 002 and 003 verified, 004 missing', async () => {
  const q = async (text) => (await client.query(text)).rows;
  const cat = await loadCatalog(q, SCHEMA);
  const parsed = dir.units.filter((u) => !u.isLedger).map((u) => ({
    number: u.number, name: u.name, parsed: parseMigration(u.files.map((f) => f.bytes.toString('utf8')).join('\n;\n')),
  }));
  const r = Object.fromEntries(verifyUnits(parsed, cat).map((x) => [x.number, x.verdict]));
  assert.equal(r[2], 'verified');
  assert.equal(r[3], 'verified');
  assert.equal(r[4], 'missing');
  assert.equal(r[1], 'partial', 'the edited 001 names a column the database never got');
});
