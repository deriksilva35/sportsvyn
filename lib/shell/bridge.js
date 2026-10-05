'use client';
// lib/shell/bridge.js — web SENDER for the sim-app native shell bridge.
// Contract (mirrors ../sportsvyn-mock-app/README.md, the native RECEIVER):
//   window.postMessage({ type:'haptic', kind:'light'|'heavy'|'notify'|'tick' }, '*')
//   window.postMessage({ type:'share', url, title }, '*')
// The native Capacitor shell injects a WKUserScript that listens for these and
// calls @capacitor/haptics / @capacitor/share. Outside shell mode, or with no
// native container present, these are silent no-ops and never throw.

import { SHELL_VALUE, SHELL_COOKIE } from './constants.js';

const isDev = process.env.NODE_ENV !== 'production';
const inBrowser = () => typeof window !== 'undefined';

// Shell mode: the persisted cookie, and nothing else.
//
// IT USED TO CHECK ?shell=sim-app FIRST. proxy.js now turns that param into the
// cookie on the first request that carries it, so the cookie exists before any
// of this runs and the param has nothing left to add. Mirrors the server-side
// resolveShellMode and isShellClient, which made the same move for the same
// reason: one question deserves one answer.
export function isShellMode() {
  if (!inBrowser()) return false;
  return document.cookie.split('; ').includes(`${SHELL_COOKIE}=${SHELL_VALUE}`);
}

// The native shell exposes Capacitor (and, on iOS, WKWebView messageHandlers) —
// the same signal the main app uses (components/BackToAppBar.js:34). In a plain
// browser neither exists: we still log in dev, but post nothing.
function hasContainer() {
  return inBrowser() && !!(window.Capacitor || (window.webkit && window.webkit.messageHandlers));
}

const HAPTIC_KINDS = new Set(['light', 'heavy', 'notify', 'tick']);

export function sendHaptic(kind) {
  if (!isShellMode() || !HAPTIC_KINDS.has(kind)) return;
  const msg = { type: 'haptic', kind };
  if (isDev) console.log('[shell:bridge]', msg, hasContainer() ? '(posted)' : '(no container)');
  if (!hasContainer()) return;
  try { window.postMessage(msg, '*'); } catch { /* never throw into the room */ }
}

// Returns true when the native share was dispatched (caller should suppress its
// web fallback); false on web / non-shell / no container, where the caller keeps
// its existing behavior (e.g. opening the share-card URL in a new tab).
export function sendShare({ url, title } = {}) {
  if (!isShellMode() || !url) return false;
  const msg = { type: 'share', url, title: title || '' };
  if (isDev) console.log('[shell:bridge]', msg, hasContainer() ? '(posted)' : '(no container)');
  if (!hasContainer()) return false;
  try { window.postMessage(msg, '*'); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// THE WIDGETS' TWO NUDGES (sun-24). The iOS widgets read /api/widget/v1 on a
// timeline iOS budgets; these tell the native side WHEN to reload it, so a pick
// shows on the home screen without waiting for the next slot.
//
//   window.postMessage({ type: 'picksChanged', game }, '*')
//     after a pick / lineup / roster save the SERVER ACCEPTED - never on a
//     refusal or a throw. `game` names the door: 'pickem', 'series', 'weekly',
//     'draft', 'october', 'run', 'six', 'epl5', 'daily'.
//   window.postMessage({ type: 'sessionChanged', signedIn }, '*')
//     when the shell's account state differs from the last one this device
//     saw (sign-in, sign-out, a different account) - see sessionNudge().
//
// Same rules as haptic/share above: shell mode only, a container present, and
// never a throw into the page. docs/widgets/feed-v1.md is the contract.
// ---------------------------------------------------------------------------

export const PICK_GAMES = Object.freeze(['pickem', 'series', 'weekly', 'draft', 'october', 'run', 'six', 'epl5', 'daily']);

function post(msg) {
  if (!isShellMode()) return false;
  if (isDev) console.log('[shell:bridge]', msg, hasContainer() ? '(posted)' : '(no container)');
  if (!hasContainer()) return false;
  try { window.postMessage(msg, '*'); return true; } catch { return false; }
}

/** After a SAVED pick or lineup. Unknown game keys are refused, not guessed. */
export function sendPicksChanged(game) {
  if (!PICK_GAMES.includes(game)) return false;
  return post({ type: 'picksChanged', game });
}

export const SESSION_SEEN_KEY = 'sv_widget_session';

/**
 * THE SESSION NUDGE, PURE. `prev` is what this device last stored (a string,
 * or null the first time), `me` is /api/me's answer. Returns the value to
 * store and whether to post. The first observation posts too: a fresh install
 * that is already signed in is exactly when the native side needs to copy the
 * token into the app group.
 */
export function sessionNudge(prev, me) {
  if (!me) return { store: prev, post: false };
  const next = me.signedIn ? `in:${me.handle ?? ''}` : 'out';
  return { store: next, post: prev !== next, signedIn: !!me.signedIn };
}

/** The shell header calls this with /api/me's answer, once per mount. */
export function sendSessionChangedIfNew(me, storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  let prev = null;
  try { prev = storage?.getItem(SESSION_SEEN_KEY) ?? null; } catch { /* private mode */ }
  const n = sessionNudge(prev, me);
  if (!n.post) return false;
  try { storage?.setItem(SESSION_SEEN_KEY, n.store); } catch { /* private mode */ }
  return post({ type: 'sessionChanged', signedIn: n.signedIn });
}
