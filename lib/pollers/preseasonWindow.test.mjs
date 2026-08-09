// lib/pollers/preseasonWindow.test.mjs - the polling window, on a fake clock.
//
// WHY THE CLOCK IS INJECTED. There is exactly one way to find out that a live
// window is wrong without a test: be watching at 7pm on the evening it matters,
// and notice. Every function here takes `now`, so the whole evening - the
// fifteen minutes before the first kickoff, the gap between the 23:00 games and
// the 23:30 one, the tail after the last final, the moment the budget runs out -
// is replayable in milliseconds.
//
// The times below are Thursday 13 August 2026, the real slate:
//   23:00Z  Detroit @ Cincinnati
//   23:00Z  Green Bay @ Pittsburgh
//   23:30Z  Indianapolis @ New England

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGameHot, sweepDecision, slateDateEt,
  HOT_INTERVAL_SEC, COLD_SYNC_HOURS, PRE_KICKOFF_MIN, POST_FINAL_MIN,
  MAX_GAME_HOURS, DAILY_REQUEST_CAP,
} from './preseasonWindow.js';

const KO_2300 = '2026-08-13T23:00:00.000Z';
const KO_2330 = '2026-08-13T23:30:00.000Z';
const at = (iso) => new Date(iso);
const SLATE = [
  { kickoffAt: KO_2300, status: 'scheduled' },
  { kickoffAt: KO_2300, status: 'scheduled' },
  { kickoffAt: KO_2330, status: 'scheduled' },
];

// Replay a stretch of minutes the way the cron actually runs it, THREADING THE
// LEDGER: every sweep that polls updates lastSyncAt, exactly as recordRun does.
// Without that a cold minute with no recorded sync returns 'daily-sync' every
// tick and the count is meaningless - the first version of these two tests made
// precisely that mistake and reported 1,021 sweeps for an 885-sweep evening.
function replay(games, fromIso, toIso) {
  let sweeps = 0;
  let lastSyncAt = new Date(new Date(fromIso).getTime() - 60 * 60 * 1000); // synced an hour ago
  for (let t = new Date(fromIso).getTime(); t <= new Date(toIso).getTime(); t += 60_000) {
    const now = new Date(t);
    const d = sweepDecision({ games, now, lastSyncAt });
    if (d.poll) { sweeps += 1; lastSyncAt = now; }
  }
  return sweeps;
}

// ---------------------------------------------------------------------------
// The window around one game
// ---------------------------------------------------------------------------

test('a game goes hot exactly 15 minutes before kickoff, not a minute earlier', () => {
  const g = { kickoffAt: KO_2300, status: 'scheduled' };
  assert.equal(isGameHot(g, at('2026-08-13T22:44:00Z')), false, '16 min out: cold');
  assert.equal(isGameHot(g, at('2026-08-13T22:45:00Z')), true, `${PRE_KICKOFF_MIN} min out: hot`);
  assert.equal(isGameHot(g, at('2026-08-13T23:00:00Z')), true, 'kickoff: hot');
});

test('a game stays hot through the whole game and the tail after it', () => {
  const g = { kickoffAt: KO_2300, status: 'scheduled' };
  assert.equal(isGameHot(g, at('2026-08-14T00:30:00Z')), true, 'halftime-ish');
  assert.equal(isGameHot(g, at('2026-08-14T02:00:00Z')), true, 'three hours in');
  // kickoff + MAX_GAME_HOURS + POST_FINAL_MIN = 23:00 + 4h + 30m = 03:30
  assert.equal(isGameHot(g, at('2026-08-14T03:29:00Z')), true, 'inside the tail');
  assert.equal(isGameHot(g, at('2026-08-14T03:31:00Z')), false, 'past the tail: cold');
});

test('a FINAL game stays hot for the tail - late corrections still land', () => {
  // The provider marks FT on its own schedule, and the last score correction
  // arrives after the whistle. Going cold the instant status flips would freeze
  // a wrong score on the page.
  const g = { kickoffAt: KO_2300, status: 'final' };
  assert.equal(isGameHot(g, at('2026-08-14T02:45:00Z')), true, 'final but inside the tail');
  assert.equal(isGameHot(g, at('2026-08-14T04:00:00Z')), false, 'final and past it');
});

test('postponed and cancelled games are never hot', () => {
  for (const status of ['postponed', 'cancelled']) {
    assert.equal(isGameHot({ kickoffAt: KO_2300, status }, at('2026-08-13T23:10:00Z')), false, status);
  }
});

test('a garbage kickoff is cold, not a crash', () => {
  for (const kickoffAt of [null, undefined, '', 'not a date', {}]) {
    assert.equal(isGameHot({ kickoffAt, status: 'scheduled' }, at(KO_2300)), false, JSON.stringify(kickoffAt));
  }
});

// ---------------------------------------------------------------------------
// The evening, replayed
// ---------------------------------------------------------------------------

test('THURSDAY 13 AUG, minute by minute', () => {
  const run = (iso, extra = {}) => sweepDecision({ games: SLATE, now: at(iso), lastSyncAt: at('2026-08-13T18:00:00Z'), ...extra });

  assert.equal(run('2026-08-13T20:00:00Z').reason, 'cold', 'three hours out: no request');
  assert.equal(run('2026-08-13T22:44:00Z').reason, 'cold', 'one minute before the window opens');

  const open = run('2026-08-13T22:45:00Z');
  assert.equal(open.poll, true);
  assert.equal(open.reason, 'hot');
  assert.equal(open.hotGames, 2, 'the two 23:00 games');
  assert.equal(open.nextCheckSec, HOT_INTERVAL_SEC);

  assert.equal(run('2026-08-13T23:15:00Z').hotGames, 3, 'the 23:30 game joins at 23:15');
  assert.equal(run('2026-08-14T01:00:00Z').hotGames, 3, 'all three mid-game');

  // The 23:00 games close at 03:30, the 23:30 game at 04:00.
  assert.equal(run('2026-08-14T03:40:00Z').hotGames, 1, 'only the late game is still in its tail');
  assert.equal(run('2026-08-14T04:01:00Z').poll, false, 'the evening is over');
  assert.equal(run('2026-08-14T04:01:00Z').reason, 'cold');
});

test('ONE REQUEST PER SWEEP regardless of how many games are hot', () => {
  // The decision never returns a per-game count to act on - the importer asks
  // for the DAY, so a 16-game Saturday costs what a 3-game Thursday costs.
  const saturday = Array.from({ length: 16 }, () => ({ kickoffAt: KO_2300, status: 'scheduled' }));
  const d = sweepDecision({ games: saturday, now: at('2026-08-13T23:10:00Z') });
  assert.equal(d.poll, true);
  assert.equal(d.hotGames, 16, 'reported for observability');
  assert.equal(d.nextCheckSec, HOT_INTERVAL_SEC, 'and the cadence does not change');
});

test('THE WIDEST REAL EVENING FITS UNDER THE CAP', () => {
  // This test was originally written against a three-game Thursday and a guessed
  // "busiest case", and it passed. Then the real 2026 schedule landed: Saturday
  // 22 August runs 12:00 to 22:00 ET - a TEN-hour spread, ten games - whose hot
  // window is 14.75 hours. At 60s that is 885 sweeps, and the cap was 600. The
  // poller would have stopped mid-slate on the biggest day of the preseason and
  // reported itself as working.
  //
  // So the cap is now checked against the actual worst day, replayed.
  const SAT_22 = [
    '2026-08-22T16:00:00Z', // 12:00 ET
    '2026-08-22T21:00:00Z',
    '2026-08-23T00:00:00Z',
    '2026-08-23T02:00:00Z', // 22:00 ET
  ].map((iso) => ({ kickoffAt: iso, status: 'scheduled' }));

  const sweeps = replay(SAT_22, '2026-08-22T15:00:00Z', '2026-08-23T08:00:00Z');
  assert.ok(sweeps > 850 && sweeps < 920, `the widest evening should take ~885 sweeps, got ${sweeps}`);
  assert.ok(sweeps < DAILY_REQUEST_CAP,
    `the cap (${DAILY_REQUEST_CAP}) must cover the widest real evening (${sweeps})`);

  // And the cap must still catch a runaway: a tick every minute all day is 1,440.
  assert.ok(DAILY_REQUEST_CAP < 1440, 'a cap that a runaway cannot reach is not a cap');
  assert.ok(DAILY_REQUEST_CAP < 7500 / 2, 'and it stays a fraction of the plan');
});

test('the ordinary Thursday evening is far cheaper', () => {
  const sweeps = replay(SLATE, '2026-08-13T22:00:00Z', '2026-08-14T06:00:00Z');
  assert.ok(sweeps > 300 && sweeps < 340, `expected ~315 sweeps, got ${sweeps}`);
});

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

test('THE CAP BEATS A HOT GAME - a budget that yields is not a budget', () => {
  const d = sweepDecision({
    games: SLATE, now: at('2026-08-13T23:10:00Z'), requestsToday: DAILY_REQUEST_CAP,
  });
  assert.equal(d.poll, false);
  assert.equal(d.reason, 'capped');
  assert.equal(d.cap, DAILY_REQUEST_CAP);
});

test('one request below the cap still polls', () => {
  const d = sweepDecision({
    games: SLATE, now: at('2026-08-13T23:10:00Z'), requestsToday: DAILY_REQUEST_CAP - 1,
  });
  assert.equal(d.poll, true);
  assert.equal(d.reason, 'hot');
});

// ---------------------------------------------------------------------------
// The cold path
// ---------------------------------------------------------------------------

test('nothing hot: a daily sync fires once, then goes quiet', () => {
  const now = at('2026-08-10T12:00:00Z');
  const stale = sweepDecision({ games: [], now, lastSyncAt: at('2026-08-09T12:00:00Z') });
  assert.equal(stale.poll, true);
  assert.equal(stale.reason, 'daily-sync', `${COLD_SYNC_HOURS}h+ since the last sync`);

  const fresh = sweepDecision({ games: [], now, lastSyncAt: at('2026-08-10T06:00:00Z') });
  assert.equal(fresh.poll, false, 'six hours ago is recent enough');
  assert.equal(fresh.reason, 'no-games');
});

test('a first run with no ledger syncs rather than waiting a day', () => {
  const d = sweepDecision({ games: [], now: at('2026-08-10T12:00:00Z'), lastSyncAt: null });
  assert.equal(d.poll, true);
  assert.equal(d.reason, 'daily-sync');
  assert.equal(d.hoursSinceSync, null, 'never synced is reported as null, not as a huge number');
});

test('an off-day with games scheduled later reads as cold, not as no-games', () => {
  // The distinction matters when reading the ledger: "cold" means we knew about
  // games and chose not to poll; "no-games" means the day is empty.
  const d = sweepDecision({ games: SLATE, now: at('2026-08-13T12:00:00Z'), lastSyncAt: at('2026-08-13T09:00:00Z') });
  assert.equal(d.reason, 'cold');
});

// ---------------------------------------------------------------------------
// The date the provider is asked for
// ---------------------------------------------------------------------------

test('the slate date is EASTERN, which is the whole point', () => {
  // A 23:30Z Thursday kickoff is Thursday evening in ET. By the time the game
  // ends it is FRIDAY in UTC - asking the provider for the UTC date mid-game
  // would request the wrong slate and quietly get nothing back.
  assert.equal(slateDateEt(at('2026-08-13T23:30:00Z')), '2026-08-13', 'kickoff');
  assert.equal(slateDateEt(at('2026-08-14T02:00:00Z')), '2026-08-13', 'mid-game, already Friday UTC');
  assert.equal(slateDateEt(at('2026-08-14T03:59:00Z')), '2026-08-13', 'the tail is still Thursday ET');
  assert.equal(slateDateEt(at('2026-08-14T12:00:00Z')), '2026-08-14', 'Friday morning is Friday');
});

test('the pads are the ones the ruling asked for', () => {
  assert.equal(PRE_KICKOFF_MIN, 15, 'kickoff - 15 min');
  assert.equal(POST_FINAL_MIN, 30, 'final + 30 min');
  assert.equal(HOT_INTERVAL_SEC, 60, 'every 60s while hot');
  assert.ok(MAX_GAME_HOURS >= 4, 'the tail must clear a long game plus overtime');
});
