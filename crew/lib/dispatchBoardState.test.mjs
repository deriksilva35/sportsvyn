// crew/lib/dispatchBoardState.test.mjs - thu-1: the two contracts CrewOS's poller leans on.
//
// BOARD-STATE: the real bin, end to end, prints exactly one state line in each of its three
// states and nothing else; a setup error exits 2 with stdout empty. The database is a fetch stub
// preloaded with --import (written to test-tmp/ via stubPath), so no network and no secret.
//
// DISPATCH: the forced-command router runs a name on its ALLOWED list (sportsvyn-stats with its
// one optional ISO instant, thu-3) and refuses (exit 2,
// nothing executed) an unknown name, a path and an empty name. It runs against a throwaway HOME
// whose ~/crew/bin holds dispatch plus marker-writing fakes, so a refusal is proven by the
// marker NOT existing, not by the exit code alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubPath } from '../../lib/testing/stubDir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin');
const STATE_LINE = /^(open|locks_in:[0-9]+|closed)$/;

// ---- board-state -----------------------------------------------------------------------------
function runBoardState(rows, { secrets = true } = {}) {
  const stub = stubPath('board-state-fetch.mjs');
  writeFileSync(stub, `globalThis.fetch = async () => new Response(JSON.stringify({ results: [{ rows: ${JSON.stringify(rows)} }] }), { status: 200, headers: { 'content-type': 'application/json' } });\n`);
  const dir = mkdtempSync(path.join(tmpdir(), 'crew-bs-'));
  if (secrets) writeFileSync(path.join(dir, 'crew-reader.env'), 'CREW_READER_URL=postgres://reader:not-a-secret@db.invalid/neondb\n');
  try {
    return spawnSync(process.execPath, ['--import', stub, path.join(BIN, 'board-state')], {
      encoding: 'utf8', timeout: 15_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CREW_SECRETS_DIR: dir },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stub, { force: true });
  }
}

test('board-state: exactly one state line in each of its three states, nothing else on stdout', () => {
  const cases = [
    [[{ open_count: 3, min_to_lock: 45 }], 'locks_in:45'],
    [[{ open_count: 2, min_to_lock: 600 }], 'open'],
    [[{ open_count: 0, min_to_lock: null }], 'closed'],
  ];
  for (const [rows, want] of cases) {
    const r = runBoardState(rows);
    assert.equal(r.status, 0, `${want}: exit (stderr: ${r.stderr})`);
    assert.equal(r.stdout, `${want}\n`, `${want}: stdout is the one line and nothing else`);
    assert.match(r.stdout.trimEnd(), STATE_LINE);
    assert.equal(r.stdout.trimEnd().split('\n').length, 1);
  }
});

test('board-state: a setup error exits 2 and prints nothing', () => {
  const r = runBoardState([], { secrets: false });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
});

// ---- dispatch ----------------------------------------------------------------------------------
function fakeHome() {
  const home = mkdtempSync(path.join(tmpdir(), 'crew-dispatch-'));
  const bin = path.join(home, 'crew', 'bin');
  mkdirSync(bin, { recursive: true });
  copyFileSync(path.join(BIN, 'dispatch'), path.join(bin, 'dispatch'));
  chmodSync(path.join(bin, 'dispatch'), 0o755);
  // Two allowed names, and two executables NOT on the list (crew-install-soul is a real host
  // script, thu-3 keeps it off); each leaves a marker holding its arguments if run.
  for (const name of ['provider-health', 'sportsvyn-stats', 'crew-install-soul', 'evil']) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\necho "$@" > "$HOME/ran-${name}"\necho ran ${name}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(path.join(home, 'x'), '#!/bin/sh\ntouch "$HOME/ran-x"\n');
  chmodSync(path.join(home, 'x'), 0o755);
  return home;
}
const dispatch = (home, cmd, env = {}) => spawnSync('bash', [path.join(home, 'crew', 'bin', 'dispatch'), ...(cmd === undefined ? [] : [cmd])], {
  encoding: 'utf8', timeout: 15_000, env: { PATH: process.env.PATH, HOME: home, ...env },
});

test('dispatch: an allowed name runs, with its whole-number arguments', () => {
  const home = fakeHome();
  try {
    const r = dispatch(home, 'provider-health');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'ran provider-health\n');
    assert.ok(existsSync(path.join(home, 'ran-provider-health')));
    const r2 = dispatch(home, 'provider-health 90');
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(readFileSync(path.join(home, 'ran-provider-health'), 'utf8'), '90\n');
    // the same command through SSH_ORIGINAL_COMMAND (no $1)
    rmSync(path.join(home, 'ran-provider-health'));
    assert.equal(dispatch(home, undefined, { SSH_ORIGINAL_COMMAND: 'provider-health' }).status, 0);
    assert.ok(existsSync(path.join(home, 'ran-provider-health')));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('dispatch: an unknown name, a path and an empty name are refused with exit 2 and nothing runs', () => {
  const home = fakeHome();
  try {
    for (const cmd of ['evil', '../x', '../../x', '/bin/sh', '/bin/sh -c id', 'dispatch', '', '   ', 'provider-health/../evil']) {
      const r = dispatch(home, cmd);
      assert.equal(r.status, 2, `"${cmd}" exit`);
      assert.equal(r.stdout, '', `"${cmd}" printed nothing on stdout`);
    }
    assert.equal(dispatch(home, undefined).status, 2, 'no command at all');
    assert.equal(dispatch(home, 'provider-health ; evil').status, 2, 'a non-digit argument');
    assert.equal(dispatch(home, 'provider-health $(evil)').status, 2);
    for (const m of ['ran-evil', 'ran-x', 'ran-provider-health']) assert.ok(!existsSync(path.join(home, m)), `${m} never ran`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('dispatch: sportsvyn-stats takes zero or one ISO-8601 UTC instant, nothing else (thu-3)', () => {
  const home = fakeHome();
  const marker = path.join(home, 'ran-sportsvyn-stats');
  try {
    const r = dispatch(home, 'sportsvyn-stats 2026-10-28T00:00:00Z');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(marker, 'utf8'), '2026-10-28T00:00:00Z\n');
    rmSync(marker);
    const r0 = dispatch(home, 'sportsvyn-stats');
    assert.equal(r0.status, 0, r0.stderr);
    assert.equal(readFileSync(marker, 'utf8'), '\n', 'no argument passed');
    rmSync(marker);
    for (const cmd of ['sportsvyn-stats x;id', 'sportsvyn-stats 2026-10-28', 'sportsvyn-stats 60',
      'sportsvyn-stats 2026-10-28T00:00:00Z 2026-10-29T00:00:00Z', 'sportsvyn-stats 2026-10-28T00:00:00+00:00',
      'sportsvyn-stats 2026-10-28T00:00:00Z;id', 'sportsvyn-stats $(id)']) {
      const x = dispatch(home, cmd);
      assert.equal(x.status, 2, `"${cmd}" exit`);
      assert.equal(x.stdout, '', `"${cmd}" stdout`);
    }
    assert.ok(!existsSync(marker), 'no refused call ran sportsvyn-stats');
    // the ISO form stays sportsvyn-stats' own: another script still takes digits only
    assert.equal(dispatch(home, 'provider-health 2026-10-28T00:00:00Z').status, 2);
    assert.ok(!existsSync(path.join(home, 'ran-provider-health')));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('dispatch: crew-install-soul and the other host-only crew scripts stay refused (thu-3)', () => {
  const home = fakeHome();
  try {
    const r = dispatch(home, 'crew-install-soul');
    assert.equal(r.status, 2);
    assert.ok(!existsSync(path.join(home, 'ran-crew-install-soul')));
  } finally { rmSync(home, { recursive: true, force: true }); }
  const src = readFileSync(path.join(BIN, 'dispatch'), 'utf8').match(/^ALLOWED=\(([^)]*)\)$/m)[1].split(/\s+/);
  for (const n of ['crew-run-open', 'crew-run-close', 'suite.sh', 'crew-ci', 'crew-deploy', 'crew-errors', 'crew-cost', 'crew-slot-check', 'crew-soul-blob', 'crew-install-soul']) {
    assert.ok(!src.includes(n), `${n} is not allowed`);
  }
});

test('dispatch: ALLOWED is exactly the nine crew scripts', () => {
  const m = readFileSync(path.join(BIN, 'dispatch'), 'utf8').match(/^ALLOWED=\(([^)]*)\)$/m);
  assert.ok(m, 'one ALLOWED=( ... ) line');
  assert.deepEqual(m[1].trim().split(/\s+/).sort(),
    ['app-errors', 'board-state', 'cost-watch', 'data-keeper', 'latest-deploy', 'provider-health', 'retention-status', 'sportsvyn-stats', 'vercel-errors']);
});
