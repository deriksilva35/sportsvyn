// lib/scores/yours.test.mjs - the YOURS band, and the five states it has.
//
// PURE AND DATABASE-FREE, because the reader is. Every case here is a stake
// map built by hand, which is what makes "signed out" testable at all: the
// signed-out board is the one state that cannot be produced by giving a real
// user id different rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isYours, yoursGames, yoursOrder, withYoursBand } from './yours.js';
import { gamesSub, groupGames } from '../gridiron/scoresV2Shape.js';

const KICK = '2026-09-19T19:30:00.000Z';
const game = (id, over = {}) => ({
  id, status: 'scheduled', kickoffAt: KICK, leagueSlug: 'cfb',
  home: { id: id * 10, abbreviation: 'HOM' }, away: { id: id * 10 + 1, abbreviation: 'AWY' },
  ...over,
});
// The four shapes stakeForMatches can return, named.
const STARRED   = { pick: null, weekly: [], alerts: false, follow: 'home' };
const ALERTED   = { pick: null, weekly: [], alerts: true,  follow: null };
const BOTH      = { pick: null, weekly: [], alerts: true,  follow: 'away' };
const PICK_ONLY = { pick: { side: 'home' }, weekly: [], alerts: false, follow: null };
const WEEKLY    = { pick: null, weekly: [{ name: 'A. Player' }], alerts: false, follow: null };

// ---------------------------------------------------------------------------
// THE FIVE STATES
// ---------------------------------------------------------------------------

test('A STARRED TEAM MAKES THE GAME YOURS', () => {
  assert.equal(isYours(STARRED), true);
  assert.equal(isYours({ ...STARRED, follow: 'away' }), true, 'either side counts');
  const g = [game(1)];
  assert.deepEqual(yoursGames(g, new Map([[1, STARRED]]), { signedIn: true }).map((x) => x.id), [1]);
});

test('AN ALERT ALONE MAKES THE GAME YOURS - no star needed', () => {
  assert.equal(isYours(ALERTED), true);
  const g = [game(2)];
  assert.deepEqual(yoursGames(g, new Map([[2, ALERTED]]), { signedIn: true }).map((x) => x.id), [2]);
});

test('BOTH IS ONE GAME, NOT TWO', () => {
  assert.equal(isYours(BOTH), true);
  const g = [game(3)];
  const out = yoursGames(g, new Map([[3, BOTH]]), { signedIn: true });
  assert.equal(out.length, 1, 'a star and an alert on one game is one card');
});

test('NEITHER IS NOT YOURS - and a pick or a Weekly player is not a claim', () => {
  assert.equal(isYours(null), false, 'no stake row at all');
  assert.equal(isYours(undefined), false);
  assert.equal(isYours({ pick: null, weekly: [], alerts: false, follow: null }), false);
  // THE LINE BETWEEN THIS BAND AND MINE. Both of these are stakes and both
  // put a game in ?mine=1; neither is a standing instruction, so neither
  // belongs in YOURS. If this ever flips, it is a product decision and this
  // assertion is where it gets made.
  assert.equal(isYours(PICK_ONLY), false, 'a pick is Mine, not Yours');
  assert.equal(isYours(WEEKLY), false, 'a Weekly player is Mine, not Yours');
  const g = [game(4), game(5)];
  const stake = new Map([[4, PICK_ONLY], [5, WEEKLY]]);
  assert.deepEqual(yoursGames(g, stake, { signedIn: true }), []);
});

test('SIGNED OUT THERE IS NO BAND AT ALL', () => {
  const g = [game(6)];
  const stake = new Map([[6, STARRED]]);
  // Even handed a stake map - which cannot happen in the page, and is the
  // point: the band's absence must not depend on the map being empty.
  assert.deepEqual(yoursGames(g, stake, { signedIn: false }), []);
  const groups = [{ key: 'day', title: 'Today', sub: '1 game', games: g }];
  const out = withYoursBand(groups, { games: g, stake, signedIn: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'day', 'the slate is untouched');
  assert.equal(out.some((x) => x.key === 'yours'), false, 'no band, not an empty one');
});

// ---------------------------------------------------------------------------
// ORDER AND SHAPE
// ---------------------------------------------------------------------------

test('LIVE FIRST, THEN BY KICKOFF', () => {
  const early = game(1, { kickoffAt: '2026-09-19T16:00:00.000Z' });
  const late = game(2, { kickoffAt: '2026-09-19T23:30:00.000Z' });
  const liveLate = game(3, { status: 'live', kickoffAt: '2026-09-19T23:00:00.000Z' });
  const sorted = [early, late, liveLate].sort(yoursOrder);
  assert.deepEqual(sorted.map((g) => g.id), [3, 1, 2],
    'the live game leads even though it kicks off after the early one');
  // A missing kickoff sorts last rather than throwing the comparator.
  const noKick = game(4, { kickoffAt: null });
  assert.deepEqual([noKick, early].sort(yoursOrder).map((g) => g.id), [1, 4]);
});

test('THE BAND IS A GROUP LIKE ANY OTHER, and the rest is the rest', () => {
  const a = game(1, { status: 'live' });
  const b = game(2);
  const c = game(3);
  const groups = [
    { key: 'live', title: 'Live now', sub: 'updates every 30s', games: [a] },
    { key: 'day', title: 'Today', sub: '2 games', games: [b, c] },
  ];
  const stake = new Map([[1, STARRED], [3, ALERTED]]);
  const out = withYoursBand(groups, { games: [a, b, c], stake, signedIn: true });

  assert.equal(out[0].key, 'yours', 'the band leads');
  // Sentence case in the data; .sv2-gh h2 uppercases it, the same way
  // "Live now" reaches the screen as LIVE NOW.
  assert.equal(out[0].title, 'Yours');
  assert.deepEqual(out[0].games.map((g) => g.id), [1, 3], 'live first, then by kickoff');
  assert.match(out[0].sub, /2 games/);
  assert.match(out[0].sub, /1 live/);
  assert.deepEqual(Object.keys(out[0]).sort(), ['games', 'key', 'sub', 'title'],
    'the same shape groupGames returns - no card redesign, no new render branch');

  // NO CARD IS DRAWN TWICE. The lifted games are gone from the groups below.
  const below = out.slice(1);
  assert.deepEqual(below.flatMap((g) => g.games.map((x) => x.id)), [2]);
  // And a group emptied by the lift is dropped, not left as a bare heading.
  assert.equal(below.some((g) => g.key === 'live'), false, 'Live now held only game 1');
});

test('THE BAND NEVER RESURRECTS A GAME THE BOARD FILTERED OUT', () => {
  // A followed game on another day, or one the Top 25 pill excluded, is not
  // in `groups` - and must not reappear just because the reader starred it.
  const shown = game(1);
  const hidden = game(9);
  const groups = [{ key: 'day', title: 'Today', sub: '1 game', games: [shown] }];
  const stake = new Map([[9, STARRED]]);
  const out = withYoursBand(groups, { games: [shown, hidden], stake, signedIn: true });
  assert.equal(out.some((g) => g.key === 'yours'), false, 'nothing drawn is yours, so no band');
  assert.deepEqual(out[0].games.map((g) => g.id), [1]);
});

test('NO CLAIM, NO BAND - the slate is returned untouched', () => {
  const g = [game(1), game(2)];
  const groups = [{ key: 'day', title: 'Today', sub: '2 games', games: g }];
  const out = withYoursBand(groups, { games: g, stake: new Map(), signedIn: true });
  assert.equal(out, groups, 'the very same array, not a rebuilt copy');
});


// ---------------------------------------------------------------------------
// THE HEADING COUNTS THE CARDS UNDER IT
// ---------------------------------------------------------------------------

/**
 * EVERY group, not just the one we expect to change: the rule is that no
 * heading on the board may name a number the cards below it do not match, and
 * a guard that only checked the day group would miss the next sub that grows a
 * count. A sub with no leading count is silently fine - there is nothing to
 * disagree with.
 */
function headingsAgree(groups) {
  for (const grp of groups) {
    const m = /^(\d+) game/.exec(grp.sub ?? '');
    if (!m) continue;
    assert.equal(Number(m[1]), grp.games.length,
      `"${grp.title}" heading says ${m[1]} over ${grp.games.length} cards: ${grp.sub}`);
  }
}

test('THE HEADING IS REBUILT FROM THE POST-LIFT LENGTH - every group the band takes from', () => {
  const games = Array.from({ length: 14 }, (_, i) => game(i + 1));
  const groups = [{
    key: 'day', title: 'Today', sub: gamesSub(14, ' · your picks lock at kick'),
    subTail: ' · your picks lock at kick', games,
  }];
  const stake = new Map([[1, STARRED], [2, ALERTED]]);
  const out = withYoursBand(groups, { games, stake, signedIn: true });

  headingsAgree(out);
  const day = out.find((g) => g.key === 'day');
  assert.equal(day.games.length, 12);
  assert.equal(day.sub, '12 games · your picks lock at kick',
    'the number changed and the tail survived it');
  assert.equal(/^14 game/.test(day.sub), false, 'the stale 14 is gone');
  assert.equal(out[0].sub, '2 games', 'and the band counts itself');
});

test('A GROUP THE BAND DID NOT TOUCH KEEPS ITS EXACT OBJECT', () => {
  // Rebuilding a sub the lift did not affect would be churn, and an identity
  // check is the cheapest way to say "this group was not rewritten".
  const a = game(1); const b = game(2); const c = game(3);
  const live = { key: 'live', title: 'Live now', sub: 'updates every 30s', games: [c] };
  const day = { key: 'day', title: 'Today', sub: gamesSub(2, ''), subTail: '', games: [a, b] };
  const out = withYoursBand([live, day], { games: [a, b, c], stake: new Map([[1, STARRED]]), signedIn: true });
  headingsAgree(out);
  assert.equal(out.find((g) => g.key === 'live'), live, 'untouched group is the same object');
  assert.equal(out.find((g) => g.key === 'day').sub, '1 game', 'and singular, not "1 games"');
});

test('A SUB WITH NO COUNT IS LEFT ALONE even when the band takes from it', () => {
  // Live now says "updates every 30s" and Final says a weekday - neither names
  // a number, so neither can disagree with one.
  const a = game(1, { status: 'live' }); const b = game(2, { status: 'live' });
  const groups = [{ key: 'live', title: 'Live now', sub: 'updates every 30s', games: [a, b] }];
  const out = withYoursBand(groups, { games: [a, b], stake: new Map([[1, STARRED]]), signedIn: true });
  headingsAgree(out);
  assert.equal(out.find((g) => g.key === 'live').sub, 'updates every 30s');
});

test('THE REAL groupGames OUTPUT SURVIVES THE BAND WITH HONEST HEADINGS', () => {
  // Through the actual grouping function, not a hand-built fixture: the shape
  // the band receives in production is the shape this rule has to hold for.
  const today = '2026-09-20';
  const games = Array.from({ length: 6 }, (_, i) => game(i + 1, {
    status: 'scheduled', kickoffAt: `2026-09-20T1${i}:00:00.000Z`,
  }));
  const { groups } = groupGames(games, { date: today, today, tz: 'UTC', signedIn: true });
  headingsAgree(groups);
  const out = withYoursBand(groups, {
    games, stake: new Map([[1, STARRED], [4, ALERTED]]), signedIn: true,
  });
  headingsAgree(out);
  assert.equal(out[0].key, 'yours');
  assert.equal(out[0].games.length, 2);
  assert.equal(out.find((g) => g.key === 'day').games.length, 4);
});
