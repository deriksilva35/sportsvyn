// lib/pollers/playsScope.test.mjs - the live plays poller's scope and cadence.
//
// The test that matters most here is the NEGATIVE one: that no path exists from
// this poller to a league-wide live-CFB query. The whole cost argument rests on
// the scope being a join rather than a filter, and a filter added later would
// look almost identical in a diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dueForPoll } from './playsScope.js';
import { PLAYS_POLL_INTERVAL_SEC } from './cadence.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCOPE = src('lib/pollers/playsScope.js');
const ROUTE = src('app/api/cron/plays-live/route.js');

// ------------------------------------------------------------ the scope

test('the scope is a JOIN off the board, not a league scan filtered after', () => {
  const code = strip(SCOPE);
  // Every clause that bounds cost must be in the WHERE, in the one query.
  assert.match(code, /FROM contests c/);
  assert.match(code, /jsonb_array_elements\(c\.board\)/);
  assert.match(code, /JOIN matches m ON m\.id = \(g->>'match_id'\)::int/);
  assert.match(code, /c\.game_type = 'pickem'/);
  assert.match(code, /c\.settled = false/);
  assert.match(code, /m\.status = 'live'/);
  assert.match(code, /l\.slug = 'cfb'/);
  assert.match(code, /SELECT DISTINCT/, 'a game on two boards must be polled once');
});

test('NO league-wide live query exists anywhere in this poller', () => {
  // The failure this forbids: `SELECT ... FROM matches WHERE status='live'`
  // followed by a .filter() in JS. That would enumerate all 79 games of a
  // September Saturday and only then decide it wanted eight.
  for (const [name, code] of [['scope', strip(SCOPE)], ['route', strip(ROUTE)]]) {
    assert.doesNotMatch(
      code,
      /FROM matches m?\s+(?:JOIN leagues[\s\S]{0,80})?WHERE[\s\S]{0,80}status = 'live'/,
      `${name} must not query matches by status alone`,
    );
    assert.doesNotMatch(code, /\.filter\([^)]*board/i, `${name} must not post-filter by board`);
  }
  // And the route must reach games ONLY through the scope module.
  assert.match(strip(ROUTE), /liveBoardGames\(\)/);
  assert.doesNotMatch(strip(ROUTE), /sql`\s*SELECT[\s\S]*FROM matches/,
    'the route must hold no game query of its own');
});

test('NFL is not reachable from this poller - BDL live stays deferred', () => {
  const code = strip(SCOPE) + strip(ROUTE);
  assert.match(strip(SCOPE), /l\.slug = 'cfb'/);
  assert.doesNotMatch(code, /importNflPlays|bdl/i);
});

// ------------------------------------------------------------ the cadence

const games = [{ id: 1 }, { id: 2 }, { id: 3 }];
const NOW = new Date('2026-08-29T18:00:00Z');
const ago = (sec) => new Date(NOW.getTime() - sec * 1000);

test('a game is due once 90s have passed, and not before', () => {
  const last = new Map([[1, ago(89)], [2, ago(90)], [3, ago(600)]]);
  const due = dueForPoll(games, last, PLAYS_POLL_INTERVAL_SEC, NOW).map((g) => g.id);
  assert.deepEqual(due, [2, 3], '89s is not yet due; 90s and 600s are');
});

test('a game never polled is always due - that is the one we most want to start', () => {
  assert.deepEqual(
    dueForPoll(games, new Map([[1, ago(10)]]), PLAYS_POLL_INTERVAL_SEC, NOW).map((g) => g.id),
    [2, 3],
  );
  assert.deepEqual(dueForPoll(games, new Map(), PLAYS_POLL_INTERVAL_SEC, NOW).length, 3);
});

test('the throttle means a minute cron polls a game every other tick, never twice', () => {
  // The real firing pattern: 60s cron, 90s throttle.
  let lastPoll = new Date('2026-08-29T18:00:00Z');
  const ticks = [];
  for (let i = 1; i <= 6; i++) {
    const t = new Date(lastPoll.getTime() + 0);      // placeholder, set below
    const at = new Date(new Date('2026-08-29T18:00:00Z').getTime() + i * 60_000);
    const due = dueForPoll([{ id: 1 }], new Map([[1, lastPoll]]), PLAYS_POLL_INTERVAL_SEC, at);
    if (due.length) { ticks.push(i); lastPoll = at; }
    void t;
  }
  assert.deepEqual(ticks, [2, 4, 6], 'polled every other minute - 2 requests per game per 4 min');
});

test('an empty scope costs zero provider requests', () => {
  assert.equal(dueForPoll([], new Map(), PLAYS_POLL_INTERVAL_SEC, NOW).length, 0);
  assert.match(strip(ROUTE), /if \(!inScope\.length\)/);
  // The early return must happen BEFORE any import call.
  const code = strip(ROUTE);
  assert.ok(code.indexOf('if (!inScope.length)') < code.indexOf('importCfbPlays('),
    'the empty-scope return must precede any fetch');
});

// ------------------------------------------------------ write path + ledger

test('the write path is the backfill\'s, unchanged - no second normalizer', () => {
  const code = strip(ROUTE);
  assert.match(code, /importCfbPlays/);
  // No hand-rolled fetch, no parallel normalisation, no new table.
  assert.doesNotMatch(code, /fetch\(/);
  assert.doesNotMatch(code, /normalizeCfbdLive|CREATE TABLE/);
});

test('every tick is ledgered and failures alarm on their OWN source', () => {
  const code = strip(ROUTE);
  assert.match(code, /recordRun\(sql, \{/);
  assert.match(code, /source: SOURCE/);
  assert.match(code, /budget: probeCfbdBudget/, 'CFBD budget rides the ledger row');
  assert.match(code, /maybeAlert\(sql, \{/);
  assert.match(code, /const SOURCE = 'plays-live'/);
  // Sharing gridiron-games' source would let an unrelated alert rate-limit this
  // one out for ALERT_WINDOW_HOURS.
  assert.doesNotMatch(code, /source: 'cfb-games'/);
});

test('one failing game does not abandon the rest of the slate', () => {
  const code = strip(ROUTE);
  const loop = code.slice(code.indexOf('for (const g of due)'), code.indexOf('return {'));
  assert.match(loop, /try \{/);
  assert.match(loop, /catch \(e\)/);
  assert.match(loop, /failed \+= 1/);
});

// --------------------------------------- the 'simulated' badge check (item 4)

test('a LIVE-polled game can never wear the simulated badge', () => {
  // `simulated` is set in exactly one place - simulateAsOf - and only when an
  // asOf argument is present. The page passes asOf ONLY from ?asOf= in the
  // query string. The poller writes plays rows and touches neither. So a live
  // game reaches the strip through the same path a completed one does, with
  // asOf null and simulated false.
  const model = src('lib/gridiron/driveStrip.js');
  const setters = [...model.matchAll(/simulated:\s*(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(setters, ['false', 'true'], 'exactly two: the null-asOf path and the cut path');
  assert.match(model, /if \(n == null\) return \{ plays: list, simulated: false/);

  const page = strip(src('app/nfl/game/[slug]/page.js'));
  assert.match(page, /const asOf = rawAsOf != null && \/\^\\d\+\$\/\.test\(String\(rawAsOf\)\) \? Number\(rawAsOf\) : null;/);
  assert.match(page, /rawAsOf = Array\.isArray\(sp\.asOf\)/, 'asOf comes from the query string only');

  // And the poller must not be able to introduce it.
  assert.doesNotMatch(strip(ROUTE), /simulate|asOf/i);
  assert.doesNotMatch(strip(SCOPE), /simulate|asOf/i);
});

// ------------------------------------------------------------- registration

test('the cron is registered every minute, and only once', () => {
  const vercel = JSON.parse(src('vercel.json'));
  const mine = vercel.crons.filter((c) => c.path === '/api/cron/plays-live');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].schedule, '* * * * *');
});
