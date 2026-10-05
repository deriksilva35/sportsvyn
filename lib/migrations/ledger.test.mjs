// lib/migrations/ledger.test.mjs - the ledger's pure half: duplicate refusal,
// checksum skip/refuse planning, transaction modes, status, and the CLI's
// whole-directory duplicate check (which runs before any connection).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readMigrationsDir, resolveArg, planApply, statusRows, formatStatus, transactionPlan,
  unbackfilledRequests, sha256, unitChecksum, GRANDFATHERED_DUPLICATES, LEDGER_MIGRATION_SUFFIX,
} from './ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const REAL_DIR = path.join(ROOT, 'migrations');

function fakeDir(files) {
  return {
    listDir: () => Object.keys(files),
    readFile: (p) => Buffer.from(files[path.basename(p)]),
  };
}

test('two files with one number are refused, whole directory', () => {
  const d = readMigrationsDir('/x', fakeDir({
    '001_a.sql': 'select 1;',
    '002_b.sql': 'select 2;',
    '002_c.sql': 'select 3;',
    '0003_d.sql': 'select 4;',
    '003_e.sql': 'select 5;',
  }));
  assert.deepEqual(d.duplicates.map((x) => x.number), [2, 3], '002 twice, and 0003/003 are one number');
  assert.deepEqual(d.units.map((u) => u.number), [1]);
});

test('081 is grandfathered as ONE unit, exactly, in apply order', () => {
  const g = GRANDFATHERED_DUPLICATES[81];
  const d = readMigrationsDir('/x', fakeDir({ [g[1]]: 'insert seed;', [g[0]]: 'create table;' }));
  assert.equal(d.duplicates.length, 0);
  assert.equal(d.units.length, 1);
  assert.deepEqual(d.units[0].files.map((f) => f.file), g, 'table file before seed file');
  assert.equal(d.units[0].checksum, sha256(Buffer.from('create table;insert seed;')));

  const third = readMigrationsDir('/x', fakeDir({ [g[0]]: 'a', [g[1]]: 'b', '081_more.sql': 'c' }));
  assert.equal(third.duplicates.length, 1, 'a third 081 file is refused');
  assert.deepEqual(third.duplicates[0].files.sort(), ['081_more.sql', ...g].sort());
});

test('the real migrations/ directory has no unexplained duplicates, and its ledger migration', () => {
  const d = readMigrationsDir(REAL_DIR);
  assert.deepEqual(d.duplicates, [], `duplicates: ${JSON.stringify(d.duplicates)}`);
  const ledger = d.units.filter((u) => u.isLedger);
  assert.equal(ledger.length, 1, `exactly one *${LEDGER_MIGRATION_SUFFIX}`);
  assert.ok(d.unnumbered.includes('seed_argentina_dev.sql'), 'DEV-only files are listed as unnumbered, not units');
  assert.ok(!d.units.some((u) => u.files.some((f) => /argentina/.test(f.file))));
});

test('checksum is sha256 of the file bytes', () => {
  const d = readMigrationsDir(REAL_DIR);
  const u = d.units.find((x) => x.number === 1);
  assert.equal(u.checksum, sha256(fs.readFileSync(path.join(REAL_DIR, u.files[0].file))));
  assert.equal(unitChecksum([Buffer.from('ab')]), sha256(Buffer.from('ab')));
});

test('resolveArg: by number, by name, unnumbered, missing', () => {
  const d = readMigrationsDir('/x', fakeDir({ '007_seven.sql': 'x', 'seed_dev.sql': 'y' }));
  assert.equal(resolveArg('007', d).unit.number, 7);
  assert.equal(resolveArg('7', d).unit.number, 7);
  assert.equal(resolveArg('007_seven', d).unit.number, 7);
  assert.equal(resolveArg('007_seven.sql', d).unit.number, 7);
  assert.equal(resolveArg('seed_dev', d).unnumbered, 'seed_dev.sql');
  assert.ok(resolveArg('008', d).error);
});

test('planApply: absent applies, same checksum skips, changed checksum refuses', () => {
  const d = readMigrationsDir('/x', fakeDir({ '001_a.sql': 'A', '002_b.sql': 'B', '003_c.sql': 'C' }));
  const [a, b, c] = d.units;
  const ledger = [
    { number: 1, name: '001_a.sql', checksum: a.checksum },
    { number: 2, name: '002_b.sql', checksum: sha256(Buffer.from('B, before somebody edited it')) },
  ];
  const plan = planApply([a, b, c], ledger);
  assert.deepEqual(plan.map((p) => p.action), ['skip', 'refuse', 'apply']);
  assert.match(plan[0].reason, /already applied/);
  assert.match(plan[1].reason, /CHANGED/);
});

test('transactionPlan: plain file is wrapped verbatim', () => {
  const t = transactionPlan('CREATE TABLE x (a int);\nINSERT INTO x VALUES (1);');
  assert.equal(t.mode, 'wrap');
  assert.equal(t.folded, 0);
  assert.equal(t.execSql, 'CREATE TABLE x (a int);\nINSERT INTO x VALUES (1);');
});

test('transactionPlan: a file\'s own top-level BEGIN/COMMIT are folded, a DO block\'s BEGIN is not', () => {
  const sql = "-- head\nBEGIN;\nALTER TABLE m DROP CONSTRAINT c;\nDO $$\nBEGIN\n  PERFORM 1;\nEND $$;\nCOMMIT;\n";
  const t = transactionPlan(sql);
  assert.equal(t.mode, 'wrap');
  assert.equal(t.folded, 2);
  assert.doesNotMatch(t.execSql.replace(/\/\*[^*]*\*\//g, ''), /^\s*(BEGIN|COMMIT)\s*;/m, 'top-level BEGIN;/COMMIT; gone');
  assert.match(t.execSql, /DO \$\$\nBEGIN\n {2}PERFORM 1;\nEND \$\$;/, 'DO body untouched');
});

test('transactionPlan: CONCURRENTLY runs outside a transaction, statement by statement', () => {
  const t = transactionPlan("-- note; with a semicolon\nCREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t (a);\nCOMMENT ON INDEX i IS 'x; y';\n");
  assert.equal(t.mode, 'none');
  assert.equal(t.statements.length, 2, 'the ; inside a comment and a string do not split');
  assert.throws(() => transactionPlan('BEGIN; CREATE INDEX CONCURRENTLY i ON t (a); COMMIT;'), /mixes/);
  assert.throws(() => transactionPlan('ROLLBACK;'), /ROLLBACK/);
});

test('transactionPlan on the real files: 117 none, 120 and 122 folded, 082 (DO block) plain', () => {
  const d = readMigrationsDir(REAL_DIR);
  const plan = (n) => transactionPlan(d.units.find((u) => u.number === n).files[0].bytes.toString('utf8'));
  assert.equal(plan(117).mode, 'none');
  assert.equal(plan(120).folded, 2);
  assert.equal(plan(122).folded, 2);
  assert.equal(plan(82).mode, 'wrap');
  assert.equal(plan(82).folded, 0);
  for (const u of d.units) for (const f of u.files) transactionPlan(f.bytes.toString('utf8'));
});

test('statusRows / formatStatus: applied, pending, CHANGED, ledger-only', () => {
  const d = readMigrationsDir('/x', fakeDir({ '001_a.sql': 'A', '002_b.sql': 'B', '003_c.sql': 'C' }));
  const [a] = d.units;
  const rows = statusRows(d.units, [
    { number: 1, name: '001_a.sql', checksum: a.checksum, applied_at: null, note: 'backfilled' },
    { number: 2, name: '002_b.sql', checksum: '0'.repeat(64), applied_at: new Date('2026-10-04T00:00:00Z') },
    { number: 9, name: '009_gone.sql', checksum: '1'.repeat(64), applied_at: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.number, r.state]), [[1, 'applied'], [2, 'CHANGED'], [3, 'pending'], [9, 'LEDGER-ONLY']]);
  const text = formatStatus(rows, { ledgerExists: true });
  assert.match(text, /001 {2}applied .*\(backfilled\)/);
  assert.match(text, /applied 1 \/ pending 1 \/ CHANGED 1 \/ ledger-only 1/);
  assert.match(formatStatus(statusRows(d.units, []), { ledgerExists: false }), /no schema_migrations table/);
});

test('unbackfilledRequests: an old migration on a ledger with no backfill is caught', () => {
  const d = readMigrationsDir('/x', fakeDir({ '001_a.sql': 'A', '002_schema_migrations.sql': 'L', '003_c.sql': 'C' }));
  const [a, l, c] = d.units;
  assert.deepEqual(unbackfilledRequests([a, c], [], d.units), [a], 'no ledger at all: 001 would re-run');
  assert.deepEqual(unbackfilledRequests([a, c], [{ number: 2 }], d.units), [a], 'only the ledger row');
  assert.deepEqual(unbackfilledRequests([a, c], [{ number: 1 }, { number: 2 }], d.units), [], 'backfilled');
  assert.deepEqual(unbackfilledRequests([l], [], d.units), []);
});

test('CLI refuses a duplicate number before it connects to anything', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migledger-'));
  try {
    fs.writeFileSync(path.join(tmp, '001_a.sql'), 'select 1;');
    fs.writeFileSync(path.join(tmp, '005_one.sql'), 'select 1;');
    fs.writeFileSync(path.join(tmp, '005_two.sql'), 'select 2;');
    for (const args of [['--status'], ['001']]) {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'apply-migrations.mjs'), '--dir', tmp, ...args], {
        env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' },
        encoding: 'utf8',
      });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /REFUSED: two migration files share a number/);
      assert.match(r.stderr, /005_one\.sql, 005_two\.sql/);
      assert.doesNotMatch(r.stdout, /FINGERPRINT/, 'refused before the target banner, i.e. before connecting');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(tmp), false);
});
