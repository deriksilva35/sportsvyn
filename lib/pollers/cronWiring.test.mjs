// Structural tests over the cron surface. Route handlers CANNOT be imported under
// node --test (the @/ path alias is a Next build concern), so these read the route
// sources as text and assert the contract every cron shares: the Bearer gate, the
// force-dynamic + maxDuration exports, and a matching vercel.json schedule. A
// source scan is blunt, but it catches the two failures that actually happen — a
// route shipped without a schedule (never runs) and a route shipped without the
// auth gate (world-readable) — neither of which any unit test would notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CRON_DIR = path.join(REPO, 'app', 'api', 'cron');

const vercel = JSON.parse(readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
const routeDirs = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const src = (name) => readFileSync(path.join(CRON_DIR, name, 'route.js'), 'utf8');

// Strip /* */ and // comments so a source scan can assert about CODE, not prose.
// Crude (it would mangle a comment marker inside a string literal), which is fine
// for these route files and honest about its limits.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scheduleFor = (name) => vercel.crons.find((c) => c.path === `/api/cron/${name}`)?.schedule;

test('every cron route is registered in vercel.json', () => {
  const missing = routeDirs.filter((n) => !scheduleFor(n));
  assert.deepEqual(missing, [], `route(s) with no schedule (will never run): ${missing.join(', ')}`);
});

test('every vercel.json cron points at a route that exists', () => {
  const paths = vercel.crons.map((c) => c.path);
  const orphans = paths.filter((p) => !routeDirs.includes(p.replace('/api/cron/', '')));
  assert.deepEqual(orphans, [], `scheduled path(s) with no route: ${orphans.join(', ')}`);
});

test('no two crons share a path', () => {
  const paths = vercel.crons.map((c) => c.path);
  assert.equal(new Set(paths).size, paths.length);
});

test('every schedule is a 5-field cron expression', () => {
  for (const c of vercel.crons) {
    assert.equal(c.schedule.trim().split(/\s+/).length, 5, `${c.path}: '${c.schedule}'`);
  }
});

test('every cron route gates on the Bearer secret and returns 401', () => {
  // Two accepted forms of the same contract: the extracted cronAuthorized() helper
  // (newer routes) and the inline header comparison (the soccer routes, which
  // predate the helper). Either satisfies the gate; neither being present does not.
  for (const name of routeDirs) {
    const s = src(name);
    const gated = /cronAuthorized\(request\)/.test(s)
      || /authHeader !== `Bearer \$\{process\.env\.CRON_SECRET\}`/.test(s);
    assert.ok(gated, `${name}: no CRON_SECRET gate — the route is world-readable`);
    assert.match(s, /status:\s*401/, `${name}: no 401 path`);
  }
});

test('every cron route is force-dynamic with an explicit maxDuration', () => {
  for (const name of routeDirs) {
    const s = src(name);
    assert.match(s, /export const dynamic = 'force-dynamic'/, `${name}: not force-dynamic`);
    assert.match(s, /export const maxDuration = \d+/, `${name}: no maxDuration`);
  }
});

// ---------------------------------------------------------------------------
// adp-snapshot specifics
// ---------------------------------------------------------------------------

test('adp-snapshot runs once a day, on an hour no other cron claims', () => {
  const schedule = scheduleFor('adp-snapshot');
  const [min, hour, dom, mon, dow] = schedule.trim().split(/\s+/);
  // Once a day: a fixed minute + fixed hour, every day.
  assert.equal(min, '0');
  assert.equal(hour, '11');
  assert.deepEqual([dom, mon, dow], ['*', '*', '*']);

  // No other DAILY-or-rarer cron shares the hour. (The sub-hourly pollers run
  // every hour by definition and are excluded — they cannot be avoided.)
  const collisions = vercel.crons.filter((c) => {
    if (c.path === '/api/cron/adp-snapshot') return false;
    const f = c.schedule.trim().split(/\s+/);
    return f[1] === hour; // a literal hour field equal to ours
  });
  assert.deepEqual(collisions.map((c) => c.path), []);
});

test('adp-snapshot: lock, run record, and failure alert all on the same source key', () => {
  const s = src('adp-snapshot');
  assert.match(s, /withAdvisoryLock\('adp-snapshot'/);
  assert.match(s, /source: 'adp-snapshot'/);
  assert.match(s, /recordRun\(/);
  assert.match(s, /recordDecision\(sql, \{ source: 'adp-snapshot', kind: 'skipped-locked'/);
  assert.match(s, /maybeAlert\(/);
});

test('adp-snapshot records counts, not just an ok flag', () => {
  const s = src('adp-snapshot');
  assert.match(s, /totalUpserted/);
  assert.match(s, /perPair/);
  assert.match(s, /match: m\.counts/);
});

test('adp-snapshot resolves identities as well as writing ADP', () => {
  // Step 2 is not optional: snapshotPool leaves matched_player_id NULL, and the
  // draft room's stat lines join through that column. A snapshot without matching
  // is a pool that looks fresh while every stat line behind it is dark.
  const s = stripComments(src('adp-snapshot'));
  assert.match(s, /matchPoolIdentities\(/, 'adp-snapshot must resolve pool identities');
  // ...and in that order — matching only sees rows snapshotPool has written.
  assert.ok(s.indexOf('snapshotPool(') < s.indexOf('matchPoolIdentities('),
    'snapshotPool must run before matchPoolIdentities');
});

test('adp-snapshot never joins stats through the pool (standing fan-out rule)', () => {
  // The rule is specifically about STATS. sim_player_pool holds one row per player
  // PER preset pair, so joining a stat table through it multiplies every player by
  // the pair count and reads a per-player stat lookup for each copy. Reading the
  // pool itself is fine and necessary (the calibration step does it).
  //
  // Comments are stripped first: the route's header names the forbidden tables in
  // order to explain the rule, and a scan that cannot tell prose from code would
  // forbid documenting it.
  const s = stripComments(src('adp-snapshot'));
  for (const forbidden of ['nfl_player_game_stats', 'nfl_players', 'draft_picks']) {
    assert.ok(!s.includes(forbidden), `adp-snapshot must not reference ${forbidden} in code`);
  }
  // Case-SENSITIVE: SQL keywords are uppercase throughout this repo, and a
  // case-insensitive scan would flag JavaScript's Array.prototype.join().
  assert.ok(!/\bJOIN\b/.test(s), 'adp-snapshot must not join anything');
});

test('adp-snapshot mutates ONLY via snapshotPool/matchPoolIdentities', () => {
  // Every write goes through a tested lib function. The route's own inline SQL is
  // read-only (presets + the pool it just wrote, for the calibration reading), so
  // no write verb may appear in the route source at all.
  const s = stripComments(src('adp-snapshot'));
  assert.match(s, /snapshotPool\(/);
  assert.match(s, /matchPoolIdentities\(/);
  for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DROP']) {
    assert.ok(!new RegExp(`\\b${verb}\\b`).test(s), `adp-snapshot must not ${verb} directly`);
  }
});
