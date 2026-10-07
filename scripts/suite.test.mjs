// scripts/suite.sh - the shared suite lock, tested with a fake command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'suite.sh');
const run = (env, args = []) => new Promise((res) => {
  const p = spawn('bash', [SH, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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
