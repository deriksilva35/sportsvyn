'use client';

// components/shell/NativeShellCookie.js — marks the request stream as "inside the
// native container" so SERVER components can suppress purchase paths.
//
// WHY THIS EXISTS (App Store Guideline 3.1.1)
// -------------------------------------------
// The shipped binary loads https://sportsvyn.com/app (capacitor.config.ts) with
// allowNavigation: ['sportsvyn.com']. That means a reviewer inside the app can
// reach ANY page on the site - the pricing page, the homepage price band, the
// league rail teasers - not just the routes the app links to.
//
// resolveShellMode() only returned true for ?shell=sim-app or the sv_shell cookie,
// and /app set NEITHER. So every server-side 3.1.1 suppression keyed on shell mode
// would have been INERT inside the very binary Apple rejected. This closes that:
// on mount inside a Capacitor webview, write the same sv_shell cookie the sim
// wrapper uses, so every subsequent server render on any sportsvyn.com route sees
// shell mode and suppresses commerce.
//
// GATED ON window.Capacitor, deliberately. /app is also a real web URL; a browser
// visitor must NOT get the cookie, or the website would silently lose its own
// purchase paths. The detection mirrors components/BackToAppBar.js, which is the
// existing native-container feature-detect in this codebase.
//
// Session cookie (no max-age): the native webview session is long-lived, which is
// what we want; a browser that somehow set it recovers by closing the tab.
//
// LIMIT, stated honestly: this is a CLIENT effect, so the very first server render
// of /app itself happens before the cookie exists. That is safe only because /app
// contains no purchase path of its own (verified: no membership link, no price, no
// checkout in app/app/*). Any future commerce added to /app must not rely on this.

import { useEffect } from 'react';
import { SHELL_COOKIE, SHELL_VALUE } from '@/lib/shell/constants';

export default function NativeShellCookie() {
  useEffect(() => {
    const isNative = typeof window !== 'undefined'
      && !!(window.Capacitor?.isNativePlatform?.() ?? window.Capacitor);
    if (!isNative) return;
    if (document.cookie.includes(`${SHELL_COOKIE}=${SHELL_VALUE}`)) return;
    document.cookie = `${SHELL_COOKIE}=${SHELL_VALUE}; path=/; samesite=lax`;
    // The shell's own first paint rendered pre-cookie. Refresh once so any
    // server-rendered chrome on this page re-resolves with shell mode on.
    window.location.reload();
  }, []);
  return null;
}
