'use client';
// lib/shell/liveActivityBridge.js - web SENDER for the two Live Activity
// bridge messages (CONTRACT AMENDMENT - THE BRIDGE AND THE DEEP LINK):
//
//   window.postMessage({ type:'startLiveActivity', matchId, url, state }, '*')
//   window.postMessage({ type:'endLiveActivity',   matchId }, '*')
//
// matchId is the integer. state is the same six the push carries. url is the
// absolute deep link the Activity keeps in its static attributes - it crosses
// as a whole URL, not as an id for the native side to resolve.
//
// A SIBLING OF bridge.js, not an addition to it, for one reason: this one
// answers the NATIVE-vs-WEB question, and haptics and share answer the
// in-container question. bridge.js posts whenever a container exists;
// a Live Activity needs the environment that can actually hold one.
//
// THE ENVIRONMENT CHECK IS components/alerts/enable.js's, not a third answer.
// pushPathFor({cookie, capacitor}) is the predicate that already decides native
// vs web for alerts, and it reads the shell cookie through isShellClient, the
// same one the tab bar uses. A Live Activity lives in exactly the environment
// that has a native push transport, so reusing it is not convenience - a second
// predicate is how the two drift.
//
// SILENT OUTSIDE THE SHELL. In a browser, or in shell mode with no container
// yet, every function here returns false and posts nothing. It never throws
// into the room.

import { pushPathFor } from '@/lib/push/sheetRules';
import { contentState } from '@/lib/push/liveActivityState';

const isDev = process.env.NODE_ENV !== 'production';
const inBrowser = () => typeof window !== 'undefined';

function environment() {
  if (!inBrowser()) return { cookie: '', capacitor: false };
  return {
    cookie: typeof document === 'undefined' ? '' : document.cookie,
    capacitor: Boolean(window.Capacitor?.Plugins?.PushNotifications),
  };
}

/** Is this an environment that can hold a Live Activity at all? */
export function canUseLiveActivityBridge(env = environment()) {
  return pushPathFor(env) === 'native';
}

/** The container that receives the post. Same signal bridge.js uses. */
function hasContainer() {
  return inBrowser() && Boolean(window.Capacitor || (window.webkit && window.webkit.messageHandlers));
}

// ---------------------------------------------------------------------------
// THE MESSAGES, PURE. Exported so the shape is testable without a window -
// the thing most worth checking here is that we never post a message the
// native side cannot act on.
// ---------------------------------------------------------------------------

/** @returns the message, or null when there is not enough to act on. */
export function startMessage({ matchId, url, state } = {}) {
  const id = Number(matchId);
  if (!Number.isInteger(id) || id <= 0) return null;
  // NO URL, NO START. The url is a STATIC attribute: it is fixed when the
  // Activity begins and cannot be corrected later, so an Activity started
  // without one is a card that can never be tapped, for as long as it lives.
  if (!url || typeof url !== 'string') return null;
  // KEY ORDER FOLLOWS THE CORRECTED CONTRACT, so the JSON a debugger prints on
  // either side of the wire reads the same way. url is TOP LEVEL, not a member
  // of state - the six are what changes, the url never does.
  return { type: 'startLiveActivity', matchId: id, url, state: contentState(state) };
}

/** @returns the message, or null when the matchId is not one. */
export function endMessage({ matchId } = {}) {
  const id = Number(matchId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: 'endLiveActivity', matchId: id };
}

function post(msg) {
  if (!msg) return false;
  if (!canUseLiveActivityBridge()) return false;
  if (isDev) console.log('[shell:liveActivity]', msg, hasContainer() ? '(posted)' : '(no container)');
  if (!hasContainer()) return false;
  try { window.postMessage(msg, '*'); return true; } catch { return false; }
}

/**
 * Start - or, for a matchId already running, update. NEVER CALLED ON PAGE LOAD
 * (relay 3B item 4): Activity.request needs the app in the foreground, and a
 * message posted while the webview is still coming up is lost with nothing to
 * show for it. Every caller must be a deliberate hand - a tap, not an effect.
 *
 * The one-at-a-time rule is the NATIVE side's to keep (a start for a different
 * match ends the current one first; a start for the same match updates it in
 * place), so the web side sends the same message either way and does not track
 * what is running.
 * @returns {boolean} whether the message was posted.
 */
export function startLiveActivity({ matchId, url, state } = {}) {
  return post(startMessage({ matchId, url, state }));
}

/** @returns {boolean} whether the message was posted. */
export function endLiveActivity({ matchId } = {}) {
  return post(endMessage({ matchId }));
}
