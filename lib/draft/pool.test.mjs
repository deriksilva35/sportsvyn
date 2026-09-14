// lib/draft/pool.test.mjs - the rolling pool, and the replay it must not break.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasKickedOff, kickedOffTeams, withholdFrom, isWithheld } from './pool.js';

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const FIRST_KO = '2026-09-18T00:15:00Z';
const SUN_KO = '2026-09-20T17:00:00Z';
const games = () => new Map([
  ['BUF', { status: 'scheduled', kickoffAt: FIRST_KO }],
  ['DET', { status: 'scheduled', kickoffAt: FIRST_KO }],
  ['KC', { status: 'scheduled', kickoffAt: SUN_KO }],
  ['IND', { status: 'scheduled', kickoffAt: SUN_KO }],
]);
const pool = () => ([
  { ffcPlayerId: '1', name: 'A Bill', team: 'BUF' },
  { ffcPlayerId: '2', name: 'A Lion', team: 'DET' },
  { ffcPlayerId: '3', name: 'A Chief', team: 'KC' },
  { ffcPlayerId: '4', name: 'A Colt', team: 'IND' },
  { ffcPlayerId: '5', name: 'A Bye', team: 'SEA' },   // no game this week
  { ffcPlayerId: '6', name: 'No Team', team: null },
]);

// ---------------------------------------------------------------------------
// THE POOL BEFORE AND AFTER A KICKOFF
// ---------------------------------------------------------------------------
test('BEFORE THE FIRST KICKOFF the pool is whole - nothing is withheld', () => {
  const r = withholdFrom(pool(), games(), new Date('2026-09-17T23:59:00Z'));
  assert.equal(r.available.length, 6);
  assert.deepEqual(r.withheld, []);
});

test('AFTER THE FIRST KICKOFF only that game\'s clubs are out', () => {
  const r = withholdFrom(pool(), games(), new Date('2026-09-18T00:16:00Z'));
  assert.deepEqual(r.withheld.map((p) => p.name), ['A Bill', 'A Lion']);
  assert.deepEqual(r.available.map((p) => p.name), ['A Chief', 'A Colt', 'A Bye', 'No Team']);
});

test('AT THE KICKOFF ITSELF he is out - the boundary is <=', () => {
  const r = withholdFrom(pool(), games(), new Date(FIRST_KO));
  assert.equal(r.withheld.length, 2);
});

test('the Sunday wave takes its own clubs later, and not before', () => {
  const mid = withholdFrom(pool(), games(), new Date('2026-09-19T12:00:00Z'));
  assert.deepEqual(mid.withheld.map((p) => p.team), ['BUF', 'DET']);
  const sun = withholdFrom(pool(), games(), new Date('2026-09-20T17:30:00Z'));
  assert.deepEqual(sun.withheld.map((p) => p.team), ['BUF', 'DET', 'KC', 'IND']);
});

test('A BYE IS AVAILABLE. No game this week is not a kickoff', () => {
  const r = withholdFrom(pool(), games(), new Date('2026-09-21T00:00:00Z'));
  assert.ok(r.available.some((p) => p.name === 'A Bye'));
  assert.ok(r.available.some((p) => p.name === 'No Team'));
});

test('the status leads and the clock is the fallback, both directions', () => {
  // Live before its scheduled time: the provider wins.
  assert.equal(hasKickedOff({ status: 'live', kickoffAt: '2099-01-01T00:00:00Z' }, new Date()), true);
  assert.equal(hasKickedOff({ status: 'final', kickoffAt: '2099-01-01T00:00:00Z' }, new Date()), true);
  // Scheduled but past its time: our clock wins.
  assert.equal(hasKickedOff({ status: 'scheduled', kickoffAt: '2020-01-01T00:00:00Z' }, new Date()), true);
  assert.equal(hasKickedOff({ status: 'scheduled', kickoffAt: '2099-01-01T00:00:00Z' }, new Date()), false);
  assert.equal(hasKickedOff(null, new Date()), false, 'no game is not a kickoff');
  assert.equal(hasKickedOff({ status: 'scheduled', kickoffAt: null }, new Date()), false);
});

test('NO GAMES MAP MEANS NO WITHHOLDING - a practice mock never moves', () => {
  for (const g of [null, undefined, new Map()]) {
    const r = withholdFrom(pool(), g, new Date('2030-01-01T00:00:00Z'));
    assert.equal(r.available.length, 6, 'a July mock must not lose players to a season');
    assert.deepEqual(r.withheld, []);
  }
});

test('kickedOffTeams and isWithheld agree with withholdFrom', () => {
  const now = new Date('2026-09-18T01:00:00Z');
  assert.deepEqual([...kickedOffTeams(games(), now)].sort(), ['BUF', 'DET']);
  assert.equal(isWithheld({ team: 'BUF' }, games(), now), true);
  assert.equal(isWithheld({ team: 'KC' }, games(), now), false);
  assert.equal(isWithheld({ team: null }, games(), now), false);
  assert.equal(isWithheld(null, games(), now), false);
});

// ---------------------------------------------------------------------------
// THE REPLAY, WHICH IS THE FAILURE THIS EXISTS TO PREVENT
// ---------------------------------------------------------------------------
test('A DRAFTED PLAYER WHOSE GAME KICKS OFF MUST NOT BREAK THE REPLAY', () => {
  // rebuildState looks every persisted pick up in the pool it was handed and
  // THROWS if one is missing. Filtering the pool would 500 that room on every
  // load for the rest of the week. The pool stays whole; only `available`
  // narrows - asserted here against the source, because the bug is an
  // architecture mistake rather than a value.
  const t = stripComments(src('../fantasy/drafts.js'));
  assert.match(t, /const state = rebuildState\(config, pool, draft\.pick_position, pickRows/,
    'rebuildState is still handed the WHOLE pool');
  assert.match(t, /const \{ available, withheld \} = withholdFrom\(state\.available, ranked\?\.gamesByTeam, now\)/,
    'and the narrowing happens on state.available, after the replay');
  // The throw is still there, which is what makes the ordering load-bearing.
  const rebuild = t.slice(t.indexOf('function rebuildState'), t.indexOf('function advanceAi'));
  assert.match(rebuild, /throw new Error\(`rebuildState: persisted player/);
  assert.equal(/withholdFrom/.test(rebuild), false, 'no filtering may happen inside the replay');
});

test('autoCompleteDraftFor narrows after its replay too', () => {
  const t = stripComments(src('../fantasy/drafts.js'));
  const fn = t.slice(t.indexOf('export async function autoCompleteDraftFor'));
  assert.match(fn, /const state = rebuildState\(config, pool,/);
  assert.match(fn, /state\.available = withholdFrom\(state\.available, rankedWindow\.gamesByTeam, now\)\.available/);
  assert.ok(fn.indexOf('rebuildState') < fn.indexOf('withholdFrom'), 'replay first, narrow second');
  // AND ONLY WHILE THE WEEK IS OPEN. After the lock this function is the
  // settle's reconstruction of an abandoned room, and every game has kicked
  // off - a rolling pool there is an EMPTY pool, and every abandoned room
  // would settle with the picks it happened to make instead of the eight it
  // is owed. The replay harness caught exactly that.
  assert.match(fn, /const weekOpen = rankedWindow/);
  assert.match(fn, /if \(weekOpen\) \{/);
});

// ---------------------------------------------------------------------------
// THE LOCK, AND THE SHORT ROSTER
// ---------------------------------------------------------------------------
test('A PICK AFTER THE WEEK LOCKS IS REFUSED ON THE SERVER - it was not before', () => {
  const t = stripComments(src('../fantasy/drafts.js'));
  for (const fn of ['makePickFor', 'timerAutoPickFor']) {
    const body = t.slice(t.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 900), /reason: 'week_locked'/, `${fn} must refuse after the lock`);
  }
  // A practice draft has no ranked window and is never refused for a lock.
  assert.match(t, /if \(ranked && new Date\(ranked\.locksAt\)/);
});

test('a player withheld for a kickoff says so, rather than "unavailable"', () => {
  const t = stripComments(src('../fantasy/drafts.js'));
  assert.match(t, /reason: kicked \? 'player_kicked_off' : 'player_unavailable'/);
});

test('NO LEGAL PICK ENDS THE DRAFT SHORT rather than erroring', () => {
  const t = stripComments(src('../fantasy/drafts.js'));
  assert.equal(/reason: 'no_legal_pick'/.test(t), false,
    'the pool can genuinely run out now, so that is not an error any more');
  assert.match(t, /if \(!userRec\) return finishShort\(draftId, state, 'pool_exhausted'\)/);
  const auto = t.slice(t.indexOf('export async function autoCompleteDraftFor'));
  assert.match(auto, /return \{ ok: true, completed: true, short: true/);
});

test('finishShort completes the room rather than leaving it stuck on a turn', () => {
  const t = stripComments(src('../fantasy/drafts.js'));
  const fn = t.slice(t.indexOf('async function finishShort'), t.indexOf('async function persistTurn'));
  assert.match(fn, /UPDATE drafts SET status = 'completed'/);
  assert.match(fn, /afterRankedComplete\(draftId\)/, 'and it still bridges its roster');
  assert.equal(/short_reason/.test(fn), false, 'no column was added - the pick count says it');
});

test('THE TRIPWIRE TELLS A THIN POOL FROM A BROKEN CONFIG', () => {
  const t = stripComments(src('./entry.js'));
  assert.match(t, /AND d\.status = 'completed'/, 'an in-progress room is short by definition');
  assert.match(t, /const thin = Boolean\(grid && Number\(grid\.seats\) > 0 && Number\(grid\.made\) < Number\(grid\.seats\)\)/);
  assert.match(t, /legal: \{ \.\.\.legal, thin \}/);
  assert.match(t, /if \(!r\.legal\.ok\) \{ if \(r\.legal\.thin\) thin \+= 1; else dnf \+= 1; \}/,
    'a thin roster must not be counted as a DNF');
  assert.match(t, /return \{ bridged, dnf, thin, autoCompleted, entries: rows\.length \}/);
});

test('an unfilled slot already scores zero - bestBall fills only what it can', () => {
  const t = stripComments(src('./bestball.js'));
  assert.match(t, /if \(p\) \{ lineup\[slot\] = p\.id; chosen\[slot\] = p; \}/);
  assert.match(t, /\{ id: null, name: null, pos: null, points: 0 \}/);
});
