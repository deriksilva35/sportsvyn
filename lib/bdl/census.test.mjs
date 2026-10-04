// lib/bdl/census.test.mjs - EVERY CALL TO THE SECONDARY FEED GOES THROUGH ONE DOOR.
//
// Ruling sun-6 item 1 holds only while every request to the feed is made by
// bdlFetch() (lib/bdl/http.js): that is where a 4xx/5xx is recorded into the
// run's scope before anybody gets a chance to catch it. A caller that fetches
// the host itself bypasses the record, and its 401s go back to hiding inside an
// ok=true - which is the 3 Oct incident, rebuilt.
//
// A guard cannot see a file it does not name, so this one names none: it WALKS
// lib/, services/ and app/ and
//   1. allows the feed's host in exactly one file, lib/bdl/http.js;
//   2. requires every file that reads the key to import the door;
//   3. COUNTS the bdlFetch call sites per file, so a new caller is looked at
//      (and a walker that silently matched nothing cannot pass);
//   4. follows the import graph from every cron route and every droplet
//      service, and requires each one that can reach the feed to run it under
//      the scope - recordRun plus an alert on !ok for a route, withBdlErrors or
//      recordRun for a service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1');
const DOOR = 'lib/bdl/http.js';

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'test-tmp') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.m?js$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const FILES = ['lib', 'services', 'app'].flatMap((d) => walk(path.join(REPO, d)));
const code = new Map(FILES.map((f) => [rel(f), strip(readFileSync(f, 'utf8'))]));

test('1. the feed\'s host is named in ONE file, the door', () => {
  const host = /balldontlie/i;
  const hits = [...code].filter(([, c]) => host.test(c)).map(([f]) => f);
  assert.deepEqual(hits, [DOOR],
    'only lib/bdl/http.js may name the host - fetch through bdlFetch() so a 4xx/5xx is recorded and fails the run');
});

test('2. every file that reads the key imports the door', () => {
  const offenders = [...code]
    .filter(([f, c]) => f !== DOOR && /BDL_API_KEY/.test(c) && !/from ['"][./]*(?:lib\/)?bdl\/http\.js['"]/.test(c))
    .map(([f]) => f);
  assert.deepEqual(offenders, [], 'a file holding the key must reach the feed through bdlFetch');
});

// THE CALLERS, COUNTED. A change here is a caller added or removed: look at
// which, check it goes through bdlFetch with the right `allow`, then update.
const CALLERS = {
  'lib/cfb/bdlLive.js': 2,
  'lib/gridiron/gameStatsSync.js': 1,
  'lib/gridiron/nflStatsSync.js': 1,
  'lib/gridiron/playsImport.js': 1,
  'lib/gridiron/rosterImport.js': 1,
  'lib/gridiron/stuckLive.js': 1,
  'lib/gridiron/sync.js': 1,
  'lib/mlb/bdlLive.js': 1,
  'lib/mlb/playsImport.js': 1,
  'lib/mlb/probables.js': 1,
  'lib/mlb/resync.js': 1,
  'lib/mlb/schedule.js': 2,
  'lib/mlb/standings.js': 1,
  'lib/mlb/sync.js': 1,
  'lib/nba/schedule.js': 1,
  'lib/nba/statsSync.js': 1,
  'lib/nba/sync.js': 1,
  'lib/october/pool.js': 2,
  'lib/six/pool.js': 1,
  'lib/standings/nfl.js': 1,
  'lib/weekly/pool.js': 1,
  'lib/wire/injuries.js': 1,
  'services/live-poller/poll.mjs': 3,
};

test('3. WALK AND COUNT: the bdlFetch call sites, file by file', () => {
  const seen = {};
  for (const [f, c] of code) {
    if (f === DOOR) continue;
    const n = (c.match(/\bbdlFetch\(/g) ?? []).length;
    if (n) seen[f] = n;
  }
  assert.deepEqual(seen, CALLERS);
  assert.equal(Object.values(seen).reduce((a, b) => a + b, 0), 28, '28 call sites on sun-6');
  // AND EACH CALLER'S ALLOWANCES ARE THE ONES WE MEANT: a status in `allow` is
  // an ANSWER, not an error, so it must be one that means something.
  for (const [f, c] of code) {
    for (const m of c.matchAll(/allow: \[([^\]]*)\]/g)) {
      if (f === DOOR) continue;
      assert.ok(['404', '429'].includes(m[1].trim()), `${f}: allow [${m[1]}] - only 404 (gone) or 429 (retried) may be an answer`);
    }
  }
});

// ---------------------------------------------------------- the import graph

function importsOf(file) {
  const c = code.get(rel(file)) ?? '';
  const specs = [
    ...[...c.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...c.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
  const out = [];
  for (const s of specs) {
    let base;
    if (s.startsWith('.')) base = path.resolve(path.dirname(file), s);
    else if (s.startsWith('@/')) base = path.join(REPO, s.slice(2));
    else continue;
    for (const cand of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
      if (existsSync(cand) && statSync(cand).isFile()) { out.push(cand); break; }
    }
  }
  return out;
}

const CALLER_FILES = new Set(Object.keys(CALLERS));
const memo = new Map();
function reachesFeed(file, stack = new Set()) {
  const r = rel(file);
  if (memo.has(r)) return memo.get(r);
  if (CALLER_FILES.has(r)) { memo.set(r, true); return true; }
  if (stack.has(r)) return false;
  stack.add(r);
  const hit = importsOf(file).some((f) => reachesFeed(f, stack));
  stack.delete(r);
  memo.set(r, hit);
  return hit;
}

// The cron routes whose import graph reaches a feed caller. Pinned, so a route
// that newly reaches the feed is looked at - and so the walker is seen to work.
const FEED_ROUTES = [
  'app/api/cron/draft-bridge/route.js',
  'app/api/cron/draft-settle/route.js',
  'app/api/cron/football-regrade/route.js',
  'app/api/cron/gridiron-games/route.js',
  'app/api/cron/gridiron-season/route.js',
  'app/api/cron/gridiron-teams/route.js',
  'app/api/cron/house-entries/route.js',
  'app/api/cron/mlb-schedule/route.js',
  'app/api/cron/nba-schedule/route.js',
  'app/api/cron/nfl-stats-sweep/route.js',
  'app/api/cron/pickem-board/route.js',
  'app/api/cron/plays-live/route.js',
  'app/api/cron/run-settle/route.js',
  'app/api/cron/standings-nfl/route.js',
  'app/api/cron/stuck-live/route.js',
  'app/api/cron/weekly-board/route.js',
  'app/api/cron/weekly-settle/route.js',
  'app/api/cron/wire/route.js',
];

test('4a. every cron route that can reach the feed runs under recordRun and alerts on !ok', () => {
  const routes = FILES.filter((f) => /app\/api\/cron\/[^/]+\/route\.js$/.test(rel(f)));
  assert.ok(routes.length > 30, `the walker sees the cron routes (${routes.length})`);
  const feed = routes.filter((f) => reachesFeed(f)).map(rel).sort();
  assert.deepEqual(feed, FEED_ROUTES);
  for (const r of feed) {
    const c = code.get(r);
    assert.match(c, /\brecordRun\(/, `${r} reaches the feed: its work must run inside recordRun`);
    // The alert on a failed run. wire alerts from inside its tick (any lane's
    // error fails it); the rest check the recorded result.
    if (r === 'app/api/cron/wire/route.js') { assert.match(c, /if \(!ok \|\|[\s\S]{0,120}?\{\s*await maybeAlert\(/); continue; }
    assert.match(c, /!\s*(?:res|out|outcome\.result|pk\.result\?|sx\.result\?|r|run|result)\??\.ok[\s\S]{0,400}?maybeAlert\(|maybeAlert\([\s\S]{0,80}?!\w+\.ok/,
      `${r} reaches the feed: a failed run must reach maybeAlert`);
  }
});

test('4b. every droplet service that can reach the feed scopes it', () => {
  const services = FILES.filter((f) => /^services\/[^/]+\/index\.mjs$/.test(rel(f)));
  assert.ok(services.length >= 3, `the walker sees the services (${services.length})`);
  const feed = services.filter((f) => reachesFeed(f)).map(rel).sort();
  assert.ok(feed.includes('services/live-poller/index.mjs'), 'the live poller reaches the feed');
  for (const s of feed) {
    const c = code.get(s);
    assert.ok(/withBdlErrors\(/.test(c) || /recordRun\(/.test(c), `${s} reaches the feed without a scope`);
  }
});

test('5. the mechanism is wired where the ruling needs it', () => {
  const rr = code.get('lib/pollers/runRecorder.js');
  assert.match(rr, /const \{ value, bdlErrors \} = await withBdlErrors\(run\);/, 'recordRun scopes every run');
  assert.match(rr, /if \(bdlErrors\.length\) \{[\s\S]*?ok = false[\s\S]*?return \{ ok: false, id, error: head, summary \};/,
    'a run with a recorded 4xx/5xx is FAILED, its summary kept');
  const poller = code.get('services/live-poller/index.mjs');
  assert.match(poller, /const \{ bdlErrors \} = await withBdlErrors\(async \(\) => \{\s*if \(active && lock && !decision\.capped\) \{/,
    'the poll, its box scores, plays and snapshots run inside the scope');
  const scoped = poller.slice(poller.indexOf('await withBdlErrors('), poller.indexOf('if (bdlErrors.length)'));
  for (const step of ['pollOnce(', 'syncBox(', 'syncMlbPlays(', 'syncNbaLastPlay(', 'snapshotLiveBoards(', 'refreshMlbProbables(']) {
    assert.ok(scoped.includes(step), `${step} must be inside the scoped tick`);
  }
  assert.match(poller, /reportBdlErrors\(sql, \{ source: `live-poller-\$\{lg\.slug\}`, kind: 'bdl-errors', bdlErrors/);
  assert.match(poller, /closeWindow\(windowId, \{ \.\.\.window, closedState: decision\.state \}, window\.bdlErrors === 0\)/,
    'a window that saw a 4xx/5xx closes failed');
  const sync = code.get('lib/gridiron/sync.js');
  assert.match(sync, /runAndAlert\(sql, \{\s*source: 'cfb-live-lines'/);
  const door = code.get(DOOR);
  assert.match(door, /scope\.getStore\(\)\?\.push\(/, 'the record is made where the error is made');
  assert.match(door, /throw bdlError\(res\.status, path,/);
});
