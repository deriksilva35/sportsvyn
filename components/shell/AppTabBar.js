'use client';

/**
 * components/shell/AppTabBar.js - the app container's persistent bottom chrome.
 *
 * SHELL ONLY, AND IT GATES ITSELF. The obvious version gates on the server in
 * the root layout - but resolveShellMode reads cookies(), and cookies() in the
 * root layout makes EVERY page dynamic. The build that tried it turned
 * /privacy, /terms and /signin/check-email from prerendered into
 * server-rendered, to gate a bar only the container sees. So the check lives
 * here: same cookie, read in an effect, and null without it. A web browser gets
 * an empty render and the static pages stay static.
 *
 * ONE FRAME OF NO BAR on the container's first paint is the price, and it is
 * the right side of the trade - the bar is fixed to the bottom of a screen the
 * reader has not finished reading yet.
 *
 * THE LIST IS DATA in lib/shell/appTabs.js and tested there. This file only
 * prints it and asks the path which tab is lit.
 */

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_TABS, activeTabFor, routeSuppressed, isShellClient } from '@/lib/shell/appTabs';

// useSyncExternalStore RATHER THAN useState + useEffect, and not for style:
// setting state in an effect to read something that was already knowable is the
// pattern react-hooks/set-state-in-effect exists to catch, and it renders twice
// to do it. This is React's own primitive for reading a value that lives
// outside React - here, the cookie - with an explicit SERVER snapshot of false
// so the markup a web browser receives is empty and hydration matches it.
const subscribe = () => () => {};
// The DECISION is isShellClient in lib/shell/appTabs.js, pure and tested. This
// only fetches the two strings it needs from the document.
const getSnapshot = () => isShellClient({
  cookie: document.cookie, search: window.location.search,
});
const getServerSnapshot = () => false;

export default function AppTabBar() {
  const pathname = usePathname() || '';
  const inShell = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!inShell) return null;
  if (routeSuppressed(pathname)) return null;
  const active = activeTabFor(pathname);

  return (
    <nav className="apptab" aria-label="App navigation">
      {APP_TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`apptab-i${active === t.key ? ' on' : ''}`}
          aria-current={active === t.key ? 'page' : undefined}
        >
          <span className="ic" aria-hidden="true">{t.icon}</span>
          <span className="lb">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
