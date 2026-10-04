// lib/gridiron/cfbTimings.test.mjs - the cfb-games ledger row names where its
// time went (sun-9 a), and the upsert loop reads once, not once per game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SYNC = src('lib/gridiron/sync.js');
const CFB = SYNC.slice(SYNC.indexOf('export async function syncCfbGames'));
const ROUTE = src('app/api/cron/gridiron-games/route.js');

test('every step is timed, and the timings ride the summary', () => {
  for (const step of ['cfbdRegular', 'cfbdPost', 'upsertLoop', 'broadcasts', 'liveScores', 'liveLines']) {
    assert.match(CFB, new RegExp(`\\b${step}: 0\\b`), `${step} starts at 0 so an unrun step reads 0, not missing`);
  }
  assert.match(CFB, /timed\('cfbdRegular', \(\) => cfbdGet\(p\)\)/);
  assert.match(CFB, /timed\('cfbdPost', \(\) => cfbdGet\(p\)\)/);
  assert.match(CFB, /timed\('broadcasts', \(\) => syncCfbBroadcasts\(/);
  assert.match(CFB, /timed\('liveScores', \(\) => withAdvisoryLock\(LIVE_LOCK\('cfb'\)/);
  assert.match(CFB, /t\.upsertLoop \+= Date\.now\(\) - loopStart/);
  assert.match(CFB, /timings_ms: t \};/);
});

test('the route hands the NFL league\'s wall time to the CFB row', () => {
  assert.match(ROUTE, /timings: \{ nfl: ctx\.elapsed\['nfl-games'\] \?\? 0 \}/);
  assert.match(ROUTE, /elapsed\[lg\.source\] = Date\.now\(\) - leagueStart;/);
  // NFL runs first, so its time is known when CFB starts.
  assert.ok(ROUTE.indexOf("source: 'nfl-games'") < ROUTE.indexOf("source: 'cfb-games'"));
});

test('budgetProbe is timed by recordRun, next to the run\'s own steps', () => {
  assert.match(src('lib/pollers/runRecorder.js'), /timings_ms = \{ \.\.\.\(out\.timings_ms \?\? \{\}\), budgetProbe: Date\.now\(\) - t0 \}/);
});

test('one SELECT for the batch: the per-game lookup is skipped when the batch was prefetched', () => {
  assert.match(CFB, /const known = await prefetchExisting\(leagueId, 'cfbd_game_id', \[\.\.\.byId\.keys\(\)\]\)/);
  assert.match(CFB, /await upsertGame\(leagueId, 'cfbd_game_id', w\.id, \{\s*\.\.\.w\.row, known,\s*\}, summary\);/);
  const up = SYNC.slice(SYNC.indexOf('async function upsertGame('), SYNC.indexOf('async function prefetchExisting'));
  assert.match(up, /const known = g\.known \?\? null;\s*const existing = known\s*\? \(known\.get\(String\(providerId\)\) \?\? null\)/);
  // Teams are resolved in the sequential pass, before any concurrent write.
  assert.ok(CFB.indexOf('await resolveSide(') < CFB.indexOf('await pool('));
});
