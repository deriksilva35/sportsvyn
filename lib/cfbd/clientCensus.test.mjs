// lib/cfbd/clientCensus.test.mjs - NOBODY FETCHES CFBD BUT THE DOOR.
//
// A guard cannot see a file it does not name, so this one names none: it WALKS
// every source directory and requires that the CFBD host appears in exactly one
// non-test file, lib/cfbd/client.js. A new private fetcher - the shape all
// eleven old ones had - would skip the 25 s timeout, the call count and the
// free quota reading, so it fails here.
//
// Then it COUNTS, so a walker that silently matched nothing cannot pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
const ROOTS = ['lib', 'app', 'services', 'scripts', 'components'];
const SKIP_DIRS = new Set(['node_modules', 'test-tmp', '.next']);
const HOST = /collegefootballdata\.com/;
const DOOR = 'lib/cfbd/client.js';

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(m?js|jsx|ts|tsx|cjs)$/.test(e.name) && !/\.test\.m?js$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const files = ROOTS.filter((r) => existsSync(path.join(REPO, r))).flatMap((r) => walk(path.join(REPO, r)));

test('the walk saw the tree (a guard over nothing passes vacuously)', () => {
  assert.ok(files.length > 500, `walked ${files.length} files`);
  for (const must of [DOOR, 'lib/gridiron/sync.js', 'services/live-poller/poll.mjs', 'lib/pollers/runRecorder.js']) {
    assert.ok(files.some((f) => rel(f) === must), `${must} is in the walk`);
  }
});

test('the CFBD host is named in exactly one source file: the door', () => {
  const naming = files.filter((f) => HOST.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(naming, [DOOR],
    `fetch CFBD through lib/cfbd/client.js (cfbdGet / cfbdFetch), not directly: ${naming.filter((f) => f !== DOOR).join(', ')}`);
});

test('the former fetchers all go through the door now', () => {
  // The eleven that had their own fetch on 3 Oct. Each must import the door
  // (directly, or playsImport's retrying wrapper) and keep no raw CFBD fetch.
  const callers = [
    'lib/gridiron/sync.js', 'lib/gridiron/playsImport.js', 'lib/gridiron/cfbScoreboard.js',
    'lib/gridiron/stuckLive.js', 'lib/cfb/rankingsImport.js', 'lib/cfb/gameStatsImport.js',
    'lib/cfb/seasonStatsImport.js', 'lib/standings/cfb.js', 'lib/gridiron/rosterImport.js',
    'services/live-poller/poll.mjs', 'lib/pollers/runRecorder.js',
  ];
  for (const c of callers) {
    const src = readFileSync(path.join(REPO, c), 'utf8');
    assert.match(src, /from '(\.\.\/)+(lib\/)?cfbd\/client\.js'/, `${c} imports the door`);
    assert.doesNotMatch(src, /CFBD_API_KEY/, `${c} reads no CFBD key of its own`);
  }
});
