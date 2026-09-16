// lib/shell/liveActivityBridge.test.mjs - the two bridge messages, the guard,
// and what happens outside the shell.
//
// NO BROWSER HERE, so window and document are stubbed on globalThis exactly as
// far as the module reads them: postMessage, Capacitor, and document.cookie.
// That is the whole surface it touches.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../testing/nextResolve.mjs';
import { SHELL_COOKIE, SHELL_VALUE } from './constants.js';
install();

// PRODUCTION, so the module's dev console.log stays out of the test output.
process.env.NODE_ENV = 'production';

const SHELL_COOKIE_STR = `${SHELL_COOKIE}=${SHELL_VALUE}`;
const STATE = { awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39' };
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

test('startMessage is the contract\'s shape and nothing more', () => {
  assert.deepEqual(mod.startMessage({ matchId: 21569, state: STATE, url: URL_ }), {
    type: 'startLiveActivity',
    matchId: 21569,
    state: STATE,
    url: URL_,
  });
});

test('the matchId crosses as an INTEGER, however it arrived', () => {
  // The page has a number; a caller reading a route param has a string. The
  // native side keys its one-at-a-time rule on this value, and "21569" is not
  // 21569 when the comparison is ===.
  const m = mod.startMessage({ matchId: '21569', state: STATE, url: URL_ });
  assert.equal(m.matchId, 21569);
  assert.equal(typeof m.matchId, 'number');
  assert.equal(mod.endMessage({ matchId: '21569' }).matchId, 21569);
});

test('the state is rebuilt through contentState, so a seventh field cannot ride along', () => {
  const m = mod.startMessage({
    matchId: 21569, url: URL_,
    state: { ...STATE, possession: 'KC', awayScore: '7' },
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
    assert.equal(mod.startMessage({ matchId: bad, state: STATE, url: URL_ }), null, `start ${bad}`);
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
  assert.equal(mod.startLiveActivity({ matchId: 21569, state: STATE, url: URL_ }), true);
  assert.equal(mod.endLiveActivity({ matchId: 21569 }), true);
  assert.deepEqual(posted, [
    { type: 'startLiveActivity', matchId: 21569, state: STATE, url: URL_ },
    { type: 'endLiveActivity', matchId: 21569 },
  ]);
});

test('OUTSIDE THE SHELL IT IS A SILENT NO-OP', () => {
  // A browser is not a place a Live Activity can exist. Posting anyway would
  // be a message no listener answers, and the page would have no way to know.
  setEnv({ cookie: 'sv_shell=not-the-app' });
  assert.equal(mod.startLiveActivity({ matchId: 21569, state: STATE, url: URL_ }), false);
  assert.equal(mod.endLiveActivity({ matchId: 21569 }), false);
  assert.deepEqual(posted, []);
});

test('shell mode with no container posts nothing either', () => {
  // The cookie survives in a browser tab the shell once opened. A container is
  // the thing that receives the post, so both have to be true.
  setEnv({ cookie: SHELL_COOKIE_STR, container: false });
  assert.equal(mod.startLiveActivity({ matchId: 21569, state: STATE, url: URL_ }), false);
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
  assert.equal(mod.startLiveActivity({ matchId: 21569, state: STATE, url: URL_ }), false);
});
