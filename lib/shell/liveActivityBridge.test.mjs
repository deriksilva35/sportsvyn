// lib/shell/liveActivityBridge.test.mjs - the two bridge messages, the guard,
// and what happens outside the shell.
//
// NO BROWSER HERE, so window and document are stubbed on globalThis exactly as
// far as the module reads them: postMessage, Capacitor, and document.cookie.
// That is the whole surface it touches.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../testing/nextResolve.mjs';
import { SHELL_COOKIE, SHELL_VALUE } from './constants.js';
install();

// PRODUCTION, so the module's dev console.log stays out of the test output.
process.env.NODE_ENV = 'production';

const SHELL_COOKIE_STR = `${SHELL_COOKIE}=${SHELL_VALUE}`;
// THE TEN, since the live line and native 1.3 (2)'s kickoffAt. These tests pin
// the exact JSON that crosses to the native side, so the constant is the whole
// contract and not a convenient subset of it.
const STATE = {
  awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39',
  possession: 'KC', situation: '3rd & 7 · IND 34', lastPlay: 'Mahomes pass complete to Kelce',
  kickoffAt: '2026-09-13T17:00:00.000Z',
};
const URL_ = 'https://sportsvyn.com/nfl/game/nfl-2026-reg-w2-ind-kc';

let posted = [];
let mod;

/** The environment the module will read on its next call. */
function setEnv({ cookie = '', capacitor = false, container = true } = {}) {
  globalThis.document = { cookie };
  globalThis.window = {
    postMessage: (msg) => { posted.push(msg); },
    ...(container ? { webkit: { messageHandlers: {} } } : {}),
    ...(capacitor ? { Capacitor: { Plugins: { PushNotifications: {} } } } : {}),
  };
}

before(async () => { mod = await import('./liveActivityBridge.js'); });
beforeEach(() => { posted = []; });

// ---------------------------------------------------------------------------
// THE MESSAGES
// ---------------------------------------------------------------------------

test('startMessage is the CORRECTED contract\'s shape, url top level', () => {
  const m = mod.startMessage({ matchId: 21569, url: URL_, league: 'nfl', state: STATE });
  assert.deepEqual(m, { type: 'startLiveActivity', matchId: 21569, url: URL_, league: 'nfl', state: STATE });
  // Order as the correction states it, so the JSON reads the same on both
  // sides of the wire, and url is NOT a member of state. league sits beside
  // matchId and url, top level and static like them.
  assert.deepEqual(Object.keys(m), ['type', 'matchId', 'url', 'league', 'state']);
  assert.equal(m.state.league, undefined, 'league is not a member of state');
  assert.equal(m.state.url, undefined);
});

test('the matchId crosses as an INTEGER, however it arrived', () => {
  // The page has a number; a caller reading a route param has a string. The
  // native side keys its one-at-a-time rule on this value, and "21569" is not
  // 21569 when the comparison is ===.
  const m = mod.startMessage({ matchId: '21569', url: URL_, state: STATE });
  assert.equal(m.matchId, 21569);
  assert.equal(typeof m.matchId, 'number');
  assert.equal(mod.endMessage({ matchId: '21569' }).matchId, 21569);
});

test('the state is rebuilt through contentState, so an eleventh field cannot ride along', () => {
  // possession USED TO BE the stowaway here and is now in the contract, which
  // is exactly why this test names a field rather than a count: redZone is the
  // thing nobody has agreed to.
  const m = mod.startMessage({
    matchId: 21569, url: URL_,
    state: { ...STATE, redZone: true, awayScore: '7' },
  });
  assert.deepEqual(m.state, STATE);
  assert.equal(typeof m.state.awayScore, 'number');
});

test('NO URL, NO START', () => {
  // The url is a STATIC attribute: fixed when the Activity begins and not
  // correctable afterwards. An Activity without one is a card that can never
  // be tapped, for as long as it lives.
  assert.equal(mod.startMessage({ matchId: 21569, state: STATE }), null);
  assert.equal(mod.startMessage({ matchId: 21569, state: STATE, url: '' }), null);
});

test('a matchId that is not one is refused by both messages', () => {
  for (const bad of [null, undefined, 0, -3, 'nfl-2026-reg-w2-ind-kc', NaN]) {
    assert.equal(mod.startMessage({ matchId: bad, url: URL_, state: STATE }), null, `start ${bad}`);
    assert.equal(mod.endMessage({ matchId: bad }), null, `end ${bad}`);
  }
});

test('endMessage carries the matchId alone', () => {
  assert.deepEqual(mod.endMessage({ matchId: 21569 }), { type: 'endLiveActivity', matchId: 21569 });
});

// ---------------------------------------------------------------------------
// THE GUARD
// ---------------------------------------------------------------------------

test('the shell cookie is enough, and so is the Capacitor plugin', () => {
  assert.equal(mod.canUseLiveActivityBridge({ cookie: SHELL_COOKIE_STR, capacitor: false }), true);
  assert.equal(mod.canUseLiveActivityBridge({ cookie: '', capacitor: true }), true);
});

test('a plain browser cannot use the bridge', () => {
  assert.equal(mod.canUseLiveActivityBridge({ cookie: 'other=1', capacitor: false }), false);
  assert.equal(mod.canUseLiveActivityBridge({}), false);
});

// ---------------------------------------------------------------------------
// POSTING
// ---------------------------------------------------------------------------

test('inside the shell, both messages are posted', () => {
  setEnv({ cookie: SHELL_COOKIE_STR });
  assert.equal(mod.startLiveActivity({ matchId: 21569, url: URL_, league: 'nfl', state: STATE }), true);
  assert.equal(mod.endLiveActivity({ matchId: 21569 }), true);
  assert.deepEqual(posted, [
    { type: 'startLiveActivity', matchId: 21569, url: URL_, league: 'nfl', state: STATE },
    { type: 'endLiveActivity', matchId: 21569 },
  ]);
});

test('OUTSIDE THE SHELL IT IS A SILENT NO-OP', () => {
  // A browser is not a place a Live Activity can exist. Posting anyway would
  // be a message no listener answers, and the page would have no way to know.
  setEnv({ cookie: 'sv_shell=not-the-app' });
  assert.equal(mod.startLiveActivity({ matchId: 21569, url: URL_, state: STATE }), false);
  assert.equal(mod.endLiveActivity({ matchId: 21569 }), false);
  assert.deepEqual(posted, []);
});

test('shell mode with no container posts nothing either', () => {
  // The cookie survives in a browser tab the shell once opened. A container is
  // the thing that receives the post, so both have to be true.
  setEnv({ cookie: SHELL_COOKIE_STR, container: false });
  assert.equal(mod.startLiveActivity({ matchId: 21569, url: URL_, state: STATE }), false);
  assert.deepEqual(posted, []);
});

test('a refused message never reaches postMessage', () => {
  setEnv({ cookie: SHELL_COOKIE_STR });
  assert.equal(mod.startLiveActivity({ matchId: 21569, state: STATE }), false); // no url
  assert.equal(mod.endLiveActivity({}), false);
  assert.deepEqual(posted, []);
});

test('a postMessage that throws is caught, not thrown into the room', () => {
  setEnv({ cookie: SHELL_COOKIE_STR });
  globalThis.window.postMessage = () => { throw new Error('webview went away'); };
  assert.equal(mod.startLiveActivity({ matchId: 21569, url: URL_, state: STATE }), false);
});

// ---------------------------------------------------------------------------
// THE LEAGUE KEY (LIVE ACTIVITY LEAGUE KEY relay)
// ---------------------------------------------------------------------------

test('THE START CARRIES league FOR NFL, MLB AND CFB - top level, as handed in', () => {
  for (const league of ['nfl', 'mlb', 'cfb']) {
    const m = mod.startMessage({ matchId: 21569, url: `https://sportsvyn.com/${league}/game/x`, league, state: STATE });
    assert.equal(m.league, league);
  }
  // Absent is null, never missing: the key is always on the start message.
  const none = mod.startMessage({ matchId: 21569, url: URL_, state: STATE });
  assert.ok(Object.hasOwn(none, 'league'));
  assert.equal(none.league, null);
  assert.equal(mod.startMessage({ matchId: 21569, url: URL_, league: '  ', state: STATE }).league, null);
  // ONLY THE START. The end message is unchanged.
  assert.deepEqual(mod.endMessage({ matchId: 21569 }), { type: 'endLiveActivity', matchId: 21569 });
});

test('THE BRIDGE NEVER PARSES league OUT OF THE URL', () => {
  // A url that says one league and a caller that says another: the caller's
  // value - the league row's - is what crosses.
  const m = mod.startMessage({ matchId: 1, url: 'https://sportsvyn.com/nfl/game/x', league: 'cfb', state: STATE });
  assert.equal(m.league, 'cfb');
  const src = readFileSync(new URL('./liveActivityBridge.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function startMessage'), src.indexOf('export function endMessage'));
  assert.doesNotMatch(fn, /url\.(split|match|replace)|new URL\(/);
});
