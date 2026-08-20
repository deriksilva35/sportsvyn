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

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isShellClient } from '@/lib/shell/appTabs';
import { resumeDecision } from '@/lib/shell/resumeRule';

const TS_KEY = 'sv-bg-at';

export default function ResumeManager() {
  const router = useRouter();

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

    const onActive = () => {
      const at = readStamp();
      const dest = resumeDecision({
        gapMs: at == null ? null : Date.now() - at,
        dataTab: document.documentElement.getAttribute('data-tab'),
        deepLinkPending,
        pathname: window.location.pathname + window.location.search,
      });
      deepLinkPending = false;
      // Re-stamp so a second activation without an intervening background
      // (some iOS versions double-fire) reads as fresh, not cold.
      stamp();
      if (dest) router.push(dest);
    };

    // ---- event sources ----
    const cleanups = [];

    const appPlugin = window.Capacitor?.Plugins?.App;
    if (appPlugin?.addListener) {
      const sub = appPlugin.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onActive(); else stamp();
      });
      cleanups.push(() => sub?.remove?.());
    } else {
      const onVis = () => {
        if (document.visibilityState === 'hidden') stamp(); else onActive();
      };
      document.addEventListener('visibilitychange', onVis);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
    }

    // Push-tap deep link: the payload's url is the winner (see lib/push/copy -
    // every event carries an in-app path).
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

  return null;
}
