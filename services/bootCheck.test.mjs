// services/bootCheck.test.mjs - every droplet entry BOOTS (mon-3 item 2).
//
// The 5 Oct poller outage was a TDZ ReferenceError at import of
// services/live-poller/index.mjs: green suite, green `node --check`, dead
// service. This file evaluates each entry for real, exactly as its unit starts
// it, in boot-check mode (lib/ops/bootCheck.mjs): every top-level statement runs,
// then the entry exits 0 before any connection, loop, lock or write. The
// environment is scrubbed to stubs - DATABASE_URL is a `.invalid` host - so
// there is no DB and no network in here.
//
// The negative control replays the 5 Oct bug: the real poller source with `log`
// moved below the throttle that uses it. Fixture files go to test-tmp/ via
// stubPath() and are removed in after().
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runBootCheck, checkEntry, ENTRIES, PRELOAD, BOOT_CHECK_FLAG, isBootCheck } from '../lib/ops/bootCheck.mjs';
import { stubPath } from '../lib/testing/stubDir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
const fixture = (name, body) => { const p = stubPath(name); writeFileSync(p, body); made.push(p); return p; };
after(() => { for (const p of made) rmSync(p, { force: true }); });

test('every entry a unit starts boots: imported, built, exits 0 at its gate', async () => {
  const { ok, results } = await runBootCheck({ cwd: REPO, timeoutMs: 8000 });
  for (const r of results) assert.ok(r.ok, `${r.name}: ${r.why}\n${r.output}`);
  assert.equal(ok, true);
  assert.deepEqual(results.map((r) => r.name), ['live-poller', 'daily-tick', 'mlb-advance']);
  // and it never pointed anywhere real
  for (const r of results) assert.match(r.output, /\[prod-db\] DATABASE_URL -> boot-check\.invalid:5432/);
});

test('NEGATIVE CONTROL: the 5 Oct TDZ order (cfbKick above log) fails the check', async () => {
  const src = readFileSync(path.join(REPO, 'services/live-poller/index.mjs'), 'utf8');
  const logLine = "const log = (...a) => console.log(new Date().toISOString(), ...a);\n";
  const kickLine = 'const cfbKick = createKickThrottle(';
  assert.ok(src.includes(logLine) && src.includes(kickLine), 'the poller still has both lines - update this fixture if they moved');
  let bad = src.replace(logLine, '');
  const at = bad.indexOf('\n', bad.indexOf(kickLine)) + 1;
  bad = bad.slice(0, at) + logLine + bad.slice(at);           // log now AFTER cfbKick: the 5 Oct order
  // same module graph, from test-tmp/: relative imports made absolute
  const lib = pathToFileURL(path.join(REPO, 'lib')).href;
  bad = bad.replaceAll("'../../lib/", `'${lib}/`)
    .replace("'./poll.mjs'", `'${pathToFileURL(path.join(REPO, 'services/live-poller/poll.mjs')).href}'`);
  const p = fixture('tdz-live-poller.mjs', bad);
  const r = await checkEntry({ name: 'live-poller', entry: p }, { cwd: REPO, timeoutMs: 8000 });
  assert.equal(r.ok, false, r.output);
  assert.match(r.why, /exit 1/);
  assert.match(r.output, /ReferenceError: Cannot access 'log' before initialization/);
});

test('an entry that exits 0 without reaching its gate fails (silence is not a pass)', async () => {
  const p = fixture('early-exit.mjs', 'process.exit(0);\n');
  const r = await checkEntry({ name: 'live-poller', entry: p }, { cwd: REPO, timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.match(r.why, /gate was never reached/);
});

test('an entry that never exits (no gate: the service started for real) fails on the timeout', async () => {
  const p = fixture('runs-forever.mjs', 'setInterval(() => {}, 1000);\n');
  const r = await checkEntry({ name: 'live-poller', entry: p }, { cwd: REPO, timeoutMs: 700 });
  assert.equal(r.ok, false);
  assert.match(r.why, /did not exit within 700 ms/);
});

test('the gate REFUSES a real DATABASE_URL, even with --boot-check', () => {
  const r = spawnSync(process.execPath, ['--import', PRELOAD, 'services/daily-tick/index.mjs', BOOT_CHECK_FLAG], {
    cwd: REPO, encoding: 'utf8', timeout: 8000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, RESEND_API_KEY: 'x', PROD_DATABASE_URL: 'postgres://u:p@db.example.com/real' },
  });
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /daily-tick REFUSED: --boot-check runs only against the stub DATABASE_URL/);
});

test('boot-check mode is argv-only: an env var cannot turn it on', () => {
  assert.equal(isBootCheck(['node', 'x.mjs']), false);
  assert.equal(isBootCheck(['node', 'x.mjs', '--trigger', 'timer']), false);
  assert.equal(isBootCheck(['node', 'x.mjs', BOOT_CHECK_FLAG]), true);
  const src = readFileSync(path.join(REPO, 'lib/ops/bootCheck.mjs'), 'utf8');
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /process\.env\.SV_BOOT_CHECK/);
});

test('ENTRIES covers every unit ExecStart, with the same preload, and no unit passes --boot-check', () => {
  const units = [];
  for (const svc of readdirSync(path.join(REPO, 'services'), { withFileTypes: true })) {
    if (!svc.isDirectory()) continue;
    let files = [];
    try { files = readdirSync(path.join(REPO, 'services', svc.name, 'systemd')); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith('.service'))) {
      const exec = readFileSync(path.join(REPO, 'services', svc.name, 'systemd', f), 'utf8').match(/^ExecStart=(.*)$/m)?.[1];
      if (exec) units.push({ f, exec });
    }
  }
  assert.ok(units.length >= 3, `found ${units.length} units`);
  for (const { f, exec } of units) {
    assert.doesNotMatch(exec, /--boot-check/, `${f} must never start in boot-check mode`);
    const entry = exec.match(/(services\/[\w-]+\/index\.mjs)/)?.[1];
    assert.ok(entry, `${f}: no services/<x>/index.mjs in ExecStart`);
    assert.ok(ENTRIES.some((e) => e.entry === entry), `${f} starts ${entry}, which lib/ops/bootCheck.mjs ENTRIES does not check`);
    assert.ok(exec.includes(`--import ${PRELOAD}`), `${f}: preload differs from the boot check's (${PRELOAD})`);
  }
});
