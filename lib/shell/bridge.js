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
