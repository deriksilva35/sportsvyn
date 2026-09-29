// services/mlb-advance/mlbAdvance.test.mjs - the job's two refusals, run as a
// process with FAKE, unreachable URLs: neither may reach a database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JOB = fileURLToPath(new URL('./index.mjs', import.meta.url));
const run = (env) => spawnSync(process.execPath, [JOB, '--trigger', 'test'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000 });

test('not pointed at PROD: refuses with one journal line', () => {
  const r = run({ PROD_DATABASE_URL: 'postgres://p@prod.example.invalid/db', DATABASE_URL: 'postgres://d@dev.example.invalid/db' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), '[mlb-advance] test REFUSED: DATABASE_URL is not PROD - run through services/_preload/prod-db.mjs');
});

test('another run holds the lock: skips, exit 0, and leaves the holder\'s lock alone', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mlbadv-'));
  writeFileSync(path.join(dir, 'sportsvyn-mlb-advance.lock'), String(process.pid));   // alive: this test process
  const url = 'postgres://p@prod.example.invalid/db';
  const r = run({ PROD_DATABASE_URL: url, DATABASE_URL: url, XDG_RUNTIME_DIR: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `[mlb-advance] test SKIPPED: another run holds the lock (pid ${process.pid})`);
  assert.equal(readFileSync(path.join(dir, 'sportsvyn-mlb-advance.lock'), 'utf8'), String(process.pid));
});

test('the units: one template for both triggers, the timer at 10:00Z, the lock dir writable', () => {
  const unit = readFileSync(new URL('./systemd/sportsvyn-mlb-advance@.service', import.meta.url), 'utf8');
  const timer = readFileSync(new URL('./systemd/sportsvyn-mlb-advance.timer', import.meta.url), 'utf8');
  assert.match(unit, /^ExecStart=\S+node --import \.\/services\/_preload\/prod-db\.mjs services\/mlb-advance\/index\.mjs --trigger %i$/m);
  assert.match(unit, /^Type=oneshot$/m);
  assert.match(unit, /^ReadWritePaths=%t$/m);
  assert.match(timer, /^OnCalendar=\*-\*-\* 10:00:00 UTC$/m);
  assert.match(timer, /^Unit=sportsvyn-mlb-advance@timer\.service$/m);
});
