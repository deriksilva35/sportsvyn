// scripts/suite.sh - the shared suite lock, tested with a fake command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'suite.sh');
// SV_SUITE_ENV cleared: a crew-mode suite must not run these sub-suites in crew mode.
const run = (env, args = []) => new Promise((res) => {
  const p = spawn('bash', [SH, ...args], { env: { ...process.env, SV_SUITE_ENV: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ code, out }));
});

test('a second run waits for the first, then runs; node exit code and wall-clock pass through', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suite-'));
  const env = { SV_SUITE_LOCK: path.join(dir, 'l'), SV_SUITE_WAIT: '20' };
  try {
    const a = run({ ...env, SV_SUITE_CMD: 'echo A-ran; sleep 2' });
    await new Promise((r) => setTimeout(r, 600));
    const b = await run({ ...env, SV_SUITE_CMD: 'echo B-ran "$@"; exit 3' }, ['x']);
    const ra = await a;
    assert.equal(ra.code, 0);
    assert.match(ra.out, /A-ran/);
    assert.match(ra.out, /suite wall-clock: \d+s/);
    assert.match(b.out, /suite busy: .*pid \d+ .* since \d{4}-\d\d-\d\dT.* - waiting up to/);
    assert.match(b.out, /B-ran x/);
    assert.equal(b.code, 3);
    assert.ok(!existsSync(env.SV_SUITE_LOCK + '.who'), 'holder file removed on exit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with a 1s wait the second run exits non-zero naming the holder', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suite-'));
  const env = { SV_SUITE_LOCK: path.join(dir, 'l') };
  try {
    const a = run({ ...env, SV_SUITE_CMD: 'sleep 3' });
    await new Promise((r) => setTimeout(r, 600));
    const b = await run({ ...env, SV_SUITE_WAIT: '1', SV_SUITE_CMD: 'echo SHOULD-NOT-RUN' });
    assert.notEqual(b.code, 0);
    assert.doesNotMatch(b.out, /SHOULD-NOT-RUN/);
    assert.match(b.out, /suite busy: \S+@\S+ pid \d+ \S+ since \S+\n?$/);
    assert.equal((await a).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the script is executable and package.json test points at it', async () => {
  const { statSync, readFileSync } = await import('node:fs');
  assert.ok(statSync(SH).mode & 0o100);
  const pkg = JSON.parse(readFileSync(path.resolve(path.dirname(SH), '../package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'scripts/suite.sh');
  assert.equal(spawnSync('bash', ['-n', SH]).status, 0);
});

// ---------------------------------------------------------------------------
// THE CREW'S GATE (CrewOS, 20 Oct): one lock with the CI job, and never PROD.
// ---------------------------------------------------------------------------
const CI_HOST = 'postgres://u:p@ep-ci-branch-000000.c-7.us-east-1.aws.neon.tech/db';

test('CREW MODE refuses, before the lock, anything that could see PROD or DEV', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suite-crew-'));
  try {
    const dotenv = path.join(dir, '.env.local');
    writeFileSync(dotenv, 'PROD_DATABASE_URL=postgres://real\n');
    const none = path.join(dir, 'absent.env');
    const base = { SV_SUITE_ENV: 'crew', SV_SUITE_LOCK: path.join(dir, 'l'), SV_SUITE_CMD: 'echo SHOULD-NOT-RUN', PROD_DATABASE_URL: '' };
    const cases = [
      [{ SV_SUITE_DOTENV: dotenv, DATABASE_URL: CI_HOST }, /\.env\.local exists/],
      [{ SV_SUITE_DOTENV: none, DATABASE_URL: CI_HOST, PROD_DATABASE_URL: 'postgres://x' }, /PROD_DATABASE_URL is set/],
      [{ SV_SUITE_DOTENV: none, DATABASE_URL: '' }, /DATABASE_URL is not set/],
      [{ SV_SUITE_DOTENV: none, DATABASE_URL: 'postgres://u:p@ep-rough-mouse-aph1upi2-pooler.c-7.us-east-1.aws.neon.tech/db' }, /DEV or PROD/],
      [{ SV_SUITE_DOTENV: none, DATABASE_URL: 'postgres://u:p@ep-winter-dawn-ap3fbbfn-pooler.c-7.us-east-1.aws.neon.tech/db' }, /DEV or PROD/],
    ];
    for (const [env, why] of cases) {
      const r = await run({ ...base, ...env });
      assert.equal(r.code, 2, JSON.stringify(env));
      assert.match(r.out, why);
      assert.doesNotMatch(r.out, /SHOULD-NOT-RUN/);
      assert.ok(!existsSync(base.SV_SUITE_LOCK + '.who'), 'refused before taking the lock');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CREW MODE runs on the env it was handed and never sources the env file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'suite-crew-'));
  try {
    const r = await run({ SV_SUITE_ENV: 'crew', SV_SUITE_LOCK: path.join(dir, 'l'), SV_SUITE_DOTENV: path.join(dir, 'absent.env'),
      DATABASE_URL: CI_HOST, PROD_DATABASE_URL: '', SV_SUITE_CMD: 'echo "ran prod=[${PROD_DATABASE_URL:-}]"' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ran prod=\[\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ONE LOCK: suite.sh and the CI job name the same lock file', async () => {
  const { readFileSync } = await import('node:fs');
  const sh = readFileSync(SH, 'utf8');
  const wf = readFileSync(path.resolve(path.dirname(SH), '../.github/workflows/tests.yml'), 'utf8');
  const shLock = /SHARED_LOCK=(\S+)/.exec(sh)?.[1];
  assert.ok(shLock, 'suite.sh names the shared lock');
  assert.match(wf, new RegExp(`flock -w \\d+ ${shLock.replace(/[/.]/g, (c) => `\\${c}`)} `), 'tests.yml flocks the same file');
});
