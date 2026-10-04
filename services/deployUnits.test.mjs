// services/deployUnits.test.mjs - the droplet's unit files run from the deploy
// folder, with a memory cap (sun-12 item 7). Pure: reads files, starts nothing.
//
// The units in this repo ARE the installed units (scripts/deploy-poller.sh
// --install-units copies them byte for byte), so what is pinned here is what
// systemd runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemdKick } from '../lib/mlb/advanceKick.js';
import { ADVANCE_UNIT } from '../lib/mlb/advance.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICES = ['live-poller', 'daily-tick', 'mlb-advance'];
// Walk, do not list: a new unit under services/*/systemd/ is covered the day it lands.
const unitFiles = SERVICES.flatMap((s) => readdirSync(path.join(REPO, 'services', s, 'systemd'))
  .map((f) => path.join('services', s, 'systemd', f)));
const serviceFiles = unitFiles.filter((f) => f.endsWith('.service'));
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
/** directive values in a unit file, comments stripped */
const keys = (text) => {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z]+)=(.*)$/.exec(line.trim());
    if (m) (out[m[1]] ??= []).push(m[2]);
  }
  return out;
};
const toBytes = (v) => { const m = /^(\d+)([KMG])?$/.exec(v); return Number(m[1]) * ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2]] ?? 1); };

test('the deploy script knows every unit file in the repo (and nothing that is not there)', () => {
  const sh = readFileSync(path.join(REPO, 'scripts/deploy-poller.sh'), 'utf8');
  const listed = [...sh.matchAll(/^\s+(services\/[^\s]+\/systemd\/[^\s]+)$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, [...unitFiles].sort());
  assert.equal(serviceFiles.length, 3);
});

for (const f of serviceFiles) {
  test(`${path.basename(f)}: runs from the deploy folder, reads the main tree's .env.local`, () => {
    const k = keys(read(f));
    assert.deepEqual(k.WorkingDirectory, ['%h/deploy/sportsvyn/current']);
    assert.deepEqual(k.EnvironmentFile, ['%h/projects/sportsvyn/.env.local'], 'one copy of every secret');
    assert.equal(k.ExecStart.length, 1);
    assert.match(k.ExecStart[0], /^%h\/\.nvm\/versions\/node\/v\d+\.\d+\.\d+\/bin\/node --import \.\/services\/_preload\/prod-db\.mjs services\//,
      'pinned node, the PROD preload, entrypoint RELATIVE to the working directory');
    // No directive may name the working checkout: that is the whole ruling.
    for (const [key, vals] of Object.entries(k)) {
      for (const v of vals) assert.doesNotMatch(v, /\/projects\/sportsvyn(?!\/\.env\.local)/, `${key}=${v} names the working checkout`);
    }
    assert.ok(!k.User, 'a --user unit has no User= (the installed file is this file, no sed step)');
  });

  test(`${path.basename(f)}: has a memory cap, MemoryHigh below MemoryMax`, () => {
    const k = keys(read(f));
    assert.equal(k.MemoryMax?.length, 1, 'MemoryMax set once');
    assert.equal(k.MemoryHigh?.length, 1, 'MemoryHigh set once');
    const max = toBytes(k.MemoryMax[0]); const high = toBytes(k.MemoryHigh[0]);
    assert.ok(high < max, 'the soft limit sits under the wall');
    assert.ok(max >= 256 * 1024 ** 2 && max <= 2 * 1024 ** 3, `MemoryMax ${k.MemoryMax[0]} is between 256M and 2G on an 8 GB box`);
    assert.ok(k.MemorySwapMax?.length === 1, 'swap capped too, or the wall can be walked around');
  });
}

test('the poller: 512M wall over a 93 MB worst peak; restart on failure, backing off, never giving up', () => {
  const text = read('services/live-poller/systemd/sportsvyn-live-poller.service');
  const k = keys(text);
  assert.deepEqual(k.MemoryMax, ['512M']);
  assert.ok(toBytes(k.MemoryMax[0]) >= 5 * 93 * 1024 ** 2, 'at least 5x the highest logged peak');
  assert.deepEqual(k.Restart, ['on-failure']);
  assert.deepEqual(k.RestartSec, ['10']);
  assert.ok(k.RestartMaxDelaySec && k.RestartSteps, 'backs off instead of a 10 s request loop');
  assert.deepEqual(k.StartLimitIntervalSec, ['0']);
  // ...and in [Unit], where systemd reads it, not [Service], where it is ignored.
  assert.ok(text.search(/^StartLimitIntervalSec=0$/m) < text.search(/^\[Service\]$/m));
  assert.deepEqual(k.WantedBy, ['default.target'], 'a user unit hangs off default.target');
});

test('advanceKick: the transient kick starts the advance UNIT by name, carrying no path of its own', async () => {
  const calls = [];
  const spawn = { spawnSync: (cmd, argv, opts) => { calls.push({ cmd, argv, opts }); return { status: 0, stdout: '', stderr: '' }; } };
  const r = await systemdKick('2026-10-04', { spawn });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  const { cmd, argv, opts } = calls[0];
  assert.equal(cmd, 'systemd-run');
  assert.deepEqual(argv.slice(-4), ['systemctl', '--user', 'start', ADVANCE_UNIT]);
  assert.equal(opts.cwd, undefined, 'no cwd: the started unit owns its WorkingDirectory');
  for (const a of argv) {
    assert.doesNotMatch(a, /^--(working-directory|property=WorkingDirectory)|^-p$|\/projects\/|\/deploy\//, `kick arg ${a} carries a path`);
  }
  // ...so the directory it runs in is the template's, which is the deploy folder.
  assert.equal(ADVANCE_UNIT, 'sportsvyn-mlb-advance@event.service');
  const tpl = keys(read('services/mlb-advance/systemd/sportsvyn-mlb-advance@.service'));
  assert.deepEqual(tpl.WorkingDirectory, ['%h/deploy/sportsvyn/current']);
});
