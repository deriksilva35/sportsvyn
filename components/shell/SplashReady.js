'use client';

// components/shell/SplashReady.js - hide the native splash after the first
// paint, on every page, in the shell only.
//
// THE SPLASH WAITED FOR A 4 s BACKSTOP. The container shows its launch splash
// until something tells it to go; nothing did, so every cold launch sat on it
// for the native timeout. The Mac named the call (SplashScreen.hide, Capacitor's
// plugin); this is the one place the web side makes it.
//
// AFTER PAINT, NOT ON MOUNT. A mount effect runs before the browser has drawn
// the page, and hiding the splash then shows a blank webview for a frame. Two
// requestAnimationFrame ticks is the standard "the first frame has been
// painted" signal: the first callback runs before that frame's paint, the
// second after it.
//
// EVERY PAGE, /signin INCLUDED - mounted in the ROOT layout beside
// ResumeManager, so an unauthenticated launch (which lands on /signin) is not
// left on the splash either.
//
// SHELL ONLY, AND NO DEPENDENCY. isShellClient reads the sv_shell cookie; the
// optional chaining is the web guard (and the 1.4(1) guard: a binary without
// the plugin has no Plugins.SplashScreen, so this is a no-op there). ONCE PER
// PAGE LOAD: a module-level flag, so a client navigation's re-mount does not
// call it again.

import { useEffect } from 'react';
import { isShellClient } from '@/lib/shell/appTabs';

let fired = false;

export function hideSplashAfterPaint(win = window, doc = document) {
  if (fired) return false;
  if (!isShellClient({ cookie: doc.cookie })) return false;
  fired = true;
  win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
    win.Capacitor?.Plugins?.SplashScreen?.hide?.({ fadeOutDuration: 200 });
  }));
  return true;
}

/** Test seam: a fresh page load. */
export function _resetSplashReady() { fired = false; }

export default function SplashReady() {
  useEffect(() => { hideSplashAfterPaint(); }, []);
  return null;
}
