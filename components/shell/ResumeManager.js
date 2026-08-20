'use client';

// components/shell/ResumeManager.js - the app opens on GAMES, including the
// opens that never load a document.
//
// The /app 307 only fires when the webview LOADS /app - a cold start. iOS
// mostly hands back the live webview exactly where it was, hours later, and
// no server code runs at all. This listener is that path's owner: it stamps
// the clock when the app backgrounds and asks lib/shell/resumeRule where the
// activation should land. The DECISION is pure and tested there; this file
// only wires events to it.
//
// EVENT SOURCE, feature-detected: Capacitor's App plugin (appStateChange) when
// the binary carries it, else document.visibilitychange - which WKWebView
// fires reliably on background/foreground and which needs no plugin at all.
// Both feed the same handler, so a binary without @capacitor/app still gets
// the behavior.
//
// THE CLOCK LIVES IN sessionStorage (mirrored in memory): it survives soft
// and hard navigations within the webview session - so a mid-session page
// load does not masquerade as a cold start - and dies with the webview
// process, which is exactly the definition of a cold start. localStorage
// would survive the process and break that definition.
//
// PUSH-TAP PRECEDENCE is implemented here too, and doubles as the queued
// deep-link listener: a pushNotificationActionPerformed tap navigates to the
// payload's url and flags the activation so the staleness rule stands down.
// The reader chose a destination; the default must not race them for it.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isShellClient } from '@/lib/shell/appTabs';
import { resumeDecision } from '@/lib/shell/resumeRule';

const TS_KEY = 'sv-bg-at';
const LOG_KEY = 'sv-resume-log';

export default function ResumeManager() {
  const router = useRouter();
  const [debug, setDebug] = useState(null);

  useEffect(() => {
    if (!isShellClient({ cookie: document.cookie, search: window.location.search })) return undefined;

    let deepLinkPending = false;

    const stamp = () => {
      try { sessionStorage.setItem(TS_KEY, String(Date.now())); } catch { /* private mode */ }
    };
    const readStamp = () => {
      try {
        const v = sessionStorage.getItem(TS_KEY);
        return v ? Number(v) : null;
      } catch { return null; }
    };
    // THE DEBUG SURFACE (temporary, owner-facing): every evaluation writes its
    // inputs and verdict to data attributes on <html> and to sessionStorage,
    // and ?debug=resume renders the log as an on-screen strip - a device's
    // state becomes readable instead of guessed.
    const log = (src, gapMs, dest) => {
      const line = `${src} gap=${gapMs == null ? 'none' : Math.round(gapMs / 1000) + 's'} -> ${dest ?? 'stay'} @${new Date().toISOString().slice(11, 19)}`;
      try {
        const el = document.documentElement;
        el.setAttribute('data-resume-last', line);
        sessionStorage.setItem(LOG_KEY, `${line}\n${(sessionStorage.getItem(LOG_KEY) ?? '').slice(0, 400)}`);
      } catch { /* private mode */ }
      if (new URLSearchParams(window.location.search).get('debug') === 'resume') {
        setDebug(line);
      }
    };

    const evaluate = (src) => {
      const at = readStamp();
      const gapMs = at == null ? null : Date.now() - at;
      const dest = resumeDecision({
        gapMs,
        dataTab: document.documentElement.getAttribute('data-tab'),
        deepLinkPending,
        pathname: window.location.pathname + window.location.search,
      });
      deepLinkPending = false;
      stamp();  // re-arm: a second activation without a background reads fresh
      log(src, gapMs, dest);
      if (dest) router.push(dest);
    };

    // ========================================================================
    // MOUNT IS AN ACTIVATION TOO - the fix for "still lands on Mock"
    // ========================================================================
    // The first version only evaluated on EVENTS (appStateChange /
    // visibilitychange). A launch that RELOADS the document on its old URL -
    // WKWebView evicting the page and restoring it on foreground, or
    // restoration bypassing /app entirely - fires no activation event at all:
    // the page loads already-visible and the manager sat silent. Mount now
    // evaluates once, and the stamp discipline below keeps it honest:
    // pagehide stamps BEFORE every document teardown, so a mid-session hard
    // navigation arrives with a seconds-old stamp and reads fresh (stay put),
    // while an eviction-reload arrives with the backgrounding stamp and reads
    // stale (go home), and a true cold start has no stamp at all (go home -
    // the belt to the /app 307's suspenders).
    evaluate('mount');

    const cleanups = [];

    // pagehide covers BOTH backgrounding and document teardown in WKWebView,
    // and fires more reliably than visibilitychange on process eviction.
    const onHide = () => stamp();
    window.addEventListener('pagehide', onHide);
    cleanups.push(() => window.removeEventListener('pagehide', onHide));

    // BFCACHE RESTORATION (the classic WKWebView trap): a page restored with
    // persisted=true re-runs NO effects and fires NO visibilitychange - this
    // event is the only signal it happened.
    const onShow = (e) => { if (e.persisted) evaluate('pageshow'); };
    window.addEventListener('pageshow', onShow);
    cleanups.push(() => window.removeEventListener('pageshow', onShow));

    const appPlugin = window.Capacitor?.Plugins?.App;
    if (appPlugin?.addListener) {
      const sub = appPlugin.addListener('appStateChange', ({ isActive }) => {
        if (isActive) evaluate('appState'); else stamp();
      });
      cleanups.push(() => sub?.remove?.());
    }
    // visibilitychange runs REGARDLESS of the plugin now: on devices where
    // both exist the double evaluation is harmless (the first re-stamps, so
    // the second reads a zero gap and stays), and on binaries without
    // @capacitor/app it is the only foreground signal.
    const onVis = () => {
      if (document.visibilityState === 'hidden') stamp(); else evaluate('visibility');
    };
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVis));

    const push = window.Capacitor?.Plugins?.PushNotifications;
    if (push?.addListener) {
      const sub = push.addListener('pushNotificationActionPerformed', (action) => {
        const url = action?.notification?.data?.url;
        deepLinkPending = true;
        if (typeof url === 'string' && url.startsWith('/')) router.push(url);
      });
      cleanups.push(() => sub?.remove?.());
    }

    return () => { for (const c of cleanups) c(); };
  }, [router]);

  if (!debug) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 70, left: 8, right: 8, zIndex: 999,
      background: '#000c', color: '#D4FF00', font: '10px monospace',
      padding: '6px 8px', borderRadius: 6, pointerEvents: 'none',
    }}>{debug}</div>
  );
}
