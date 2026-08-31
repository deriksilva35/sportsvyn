'use client';

// components/shell/NativeShellCookie.js — the FALLBACK that marks the request
// stream as "inside the native container". It is no longer the primary path.
//
// *** DO NOT DELETE THIS FILE YET. The condition for deleting it is named at
// the bottom of this comment and has not been met. ***
//
// WHAT MOVED. proxy.js now sets sv_shell before anything renders, from two
// signals: ?shell=sim-app on the URL, and SHELL_UA_TOKEN in the User-Agent
// (capacitor.config.ts appends it). The App Store 3.1.1 rationale this file
// used to carry — capacitor allowNavigation makes every sportsvyn.com page
// reachable in-app, so every server-side suppression has to see shell mode on
// pages the app never links to — now lives in proxy.js, where the decision is.
//
// WHY IT STAYS ANYWAY. appendUserAgent is baked into the binary. Every copy
// already on a phone was built without it, sends a plain webview UA, matches
// nothing in the proxy, and would lose shell mode entirely — every 3.1.1
// suppression inert in the exact binary Apple already rejected once — if this
// were deleted today. So it keeps running, unchanged, for those copies.
//
// IT IS A NO-OP ON A CURRENT BINARY. The proxy sets the cookie on the first
// request, so the early return below fires and nothing happens: no write, and
// critically no reload. On an old binary it behaves exactly as it always did.
//
// THE CONDITION FOR DELETING IT, stated so nobody has to reconstruct it: when
// a binary carrying SHELL_UA_TOKEN has SHIPPED and the older copies are no
// longer a supported install base. Not when the token is committed — it is
// committed now and that changes nothing on a phone. Until then this file and
// the proxy overlap on purpose, and the overlap is free because the cookie
// check makes the second one silent.

import { useEffect } from 'react';
import { SHELL_COOKIE, SHELL_VALUE } from '@/lib/shell/constants';

export default function NativeShellCookie() {
  useEffect(() => {
    const isNative = typeof window !== 'undefined'
      && !!(window.Capacitor?.isNativePlatform?.() ?? window.Capacitor);
    if (!isNative) return;
    // THE EARLY RETURN IS WHAT MAKES THIS A NO-OP on a binary the proxy can
    // recognise: the cookie is already there, so no write and - the part that
    // matters - no reload. A reload here on top of a proxy that had already
    // done the job would be a visible flash on every cold open.
    if (document.cookie.includes(`${SHELL_COOKIE}=${SHELL_VALUE}`)) return;
    document.cookie = `${SHELL_COOKIE}=${SHELL_VALUE}; path=/; samesite=lax`;
    // Only reached on a binary predating SHELL_UA_TOKEN. That copy's first
    // paint rendered pre-cookie, so refresh once and let the server-rendered
    // chrome re-resolve with shell mode on.
    window.location.reload();
  }, []);
  return null;
}
