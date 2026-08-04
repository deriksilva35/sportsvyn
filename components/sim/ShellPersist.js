'use client';
// components/sim/ShellPersist.js — writes the sim-app shell cookie client-side
// when shell mode is active, so client navigations within /sim keep the
// server-side chrome mode without re-threading ?shell=sim-app.
//
// Session cookie (no max-age): scoped to the browser session, so a web visitor
// who stumbles onto ?shell=sim-app is not stuck chromeless after closing the tab.
// The native webview session is long-lived, which is exactly what we want there.
//
// IT ALSO OWNS THE BFCACHE-RESTORE RELOAD. That lives here rather than in
// IapConfigure because IapConfigure is mounted on /sim, /sim/account and
// /sim/tracker but NOT on /sim/draft/[id] - the draft room, which is the one
// screen the restore failure was reported on. ShellPersist is mounted on every
// sim route including both branches of the room, and every caller already gates
// it behind `isShell`, so it is the only component with the coverage this needs.
import { useEffect } from 'react';
import { SHELL_COOKIE, SHELL_VALUE } from '@/lib/shell/constants';

// True only inside the native container. window.Capacitor is injected by the
// shell; iOS also exposes webkit.messageHandlers. This is the gate that keeps
// the reload below OFF the web: desktop Safari and Firefox fire
// pageshow{persisted:true} on ordinary back/forward navigation, and reloading
// there would turn a working BFCache restore into a pointless round trip.
function inNativeContainer() {
  if (typeof window === 'undefined') return false;
  return !!(window.Capacitor || (window.webkit && window.webkit.messageHandlers));
}

export default function ShellPersist() {
  useEffect(() => {
    document.cookie = `${SHELL_COOKIE}=${SHELL_VALUE}; path=/; samesite=lax`;
  }, []);

  useEffect(() => {
    if (!inNativeContainer()) return undefined;

    // PAGESHOW WITH event.persisted ONLY.
    //
    // persisted === true means the document came out of the back/forward cache:
    // the DOM and JS heap were frozen and thawed rather than rebuilt. In the
    // native container that is the case where the page can look alive while the
    // bridge it was talking to is not, so a reload re-enters through the server
    // and rebuilds room state from the draft row - the same path a cold open
    // takes, which is the one that already works.
    //
    // Deliberately NOT bound to appStateChange or visibilitychange. Backgrounding
    // for a few seconds and returning to a WebView that was never evicted fires
    // those constantly, and reloading then would throw away a live room - a typed
    // search, a scrolled board, an in-flight pick - to fix nothing. `persisted`
    // is the narrowest signal that actually means "this document was suspended".
    //
    // SCOPE, stated plainly: this covers BFCache restore. It does NOT cover iOS
    // terminating the web content process outright - there the document is gone,
    // pageshow never fires, and Capacitor's own
    // webViewWebContentProcessDidTerminate -> webView.reload() is what runs.
    // The bundled error page is the net for that path.
    const onPageShow = (e) => {
      if (!e.persisted) return;
      window.location.reload();
    };

    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return null;
}
