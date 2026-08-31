'use client';

/**
 * components/shell/AppHeader.js - the app container's header, on EVERY route.
 *
 * ONE HEADER DECISION, NOT PER-ROUTE, and that is the whole reason this moved
 * out of GlobalHeader. The shell branch there only ever fired on pages that
 * import GlobalHeaderServer - /games, /account, the Daily surfaces. Every /sim
 * page renders its own `<header className="sim-head">` with the gridiron
 * wordmark and never touches GlobalHeader at all, so the container showed
 * DRAFTVYN on two tabs and SPORTSVYN on the other two, plus a "Lobby" link
 * inside the draft room. Four routes, four answers.
 *
 * Mounted in the root layout beside AppTabBar: header above, bar below, the
 * same gate on both. A route cannot opt out and cannot disagree.
 *
 * THE PER-ROUTE HEADERS HIDE THEMSELVES - GlobalHeader returns null in the
 * shell and the sim headers are wrapped in HideInShell. This one replaces them
 * rather than stacking on top.
 *
 * SAME CLIENT GATE AS THE TAB BAR, for the same reason: a server-side shell
 * read in the ROOT layout calls cookies() and turns every prerendered page
 * dynamic. See components/shell/AppTabBar.js.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { isShellClient } from '@/lib/shell/appTabs';

const subscribe = () => () => {};
const getSnapshot = () => isShellClient({ cookie: document.cookie });
const getServerSnapshot = () => false;

export default function AppHeader() {
  const inShell = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // THE PROFILE CHIP'S ONE FACT. Fetched after mount rather than server-passed,
  // because this component lives in the ROOT layout and the root layout must
  // never call auth()/cookies() - the /privacy-goes-dynamic trap, twice now.
  // Shell-gated so the web never spends the request. null = signed out or
  // handle-less; both render the generic mark, and the generic mark is
  // transient by construction - the onboarding gate closes handle-less and the
  // launch flow closes signed-out.
  const [handle, setHandle] = useState(null);
  useEffect(() => {
    if (!inShell) return;
    let dead = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!dead && j?.handle) setHandle(j.handle); })
      .catch(() => {});
    return () => { dead = true; };
  }, [inShell]);

  if (!inShell) return null;
  return (
    <header className="gh gh--app">
      {/* NOT A LINK. Home is a tab; a header that navigates on tap competes
          with the bar for the same job. */}
      <span className="gh-app-mark" aria-label="DRAFTVYN">
        <img
          src="/brand/draftvynwordmarkwhite1500x300transparent.png"
          alt="DRAFTVYN"
          width={1500}
          height={300}
          fetchPriority="high"
          decoding="async"
          style={{ height: '2.12em', width: 'auto', display: 'block' }}
        />
      </span>
      {/* PROFILE LIVES HERE NOW, not on the bar - the v0.3 trade that freed
          the fourth tab for SPORTSVYN. Absolutely placed so the wordmark stays
          centred whether or not a handle has loaded. */}
      <Link href="/account" className="gh-app-me" aria-label="Your account">
        <span className="in" aria-hidden="true">{handle ? handle[0] : '@'}</span>
        {handle && <span className="hn">@{handle}</span>}
      </Link>
    </header>
  );
}
