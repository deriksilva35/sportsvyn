'use client';

// App chrome: the fixed bottom tab bar for the sim surfaces (mobile web + native
// shell). Ink, volt active state, JetBrains Mono labels, safe-area padding. It is
// NOT rendered inside an active draft room (the room's own pager owns the bottom)
// and it is hidden on desktop via CSS. Active tab is derived from the path, so one
// component serves every sim page.
//
// RANKINGS has no live destination yet - the Sportsvyn rankings ship with the
// August board (see the setup console's locked SPORTSVYN row) - so it is an
// honest, non-navigating "coming August" tab rather than a link into the unlinked
// /nfl dev shell.

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isShellClient } from '@/lib/shell/appTabs';

const TABS = [
  { key: 'draft', label: 'DRAFT', icon: '▦', href: '/sim' },
  // TRACKER sits between DRAFT and HISTORY: the two live surfaces first, the
  // archive after. Its href resolves resume-or-setup server-side (see
  // app/sim/tracker/page.js) rather than here - the tab bar has no data access,
  // and giving it a draft query would bill every sim page for it on every render.
  // Icon stays in the existing register: geometric mono glyphs, one per tab.
  { key: 'tracker', label: 'TRACKER', icon: '◍', href: '/sim/tracker' },
  { key: 'history', label: 'HISTORY', icon: '≡', href: '/sim/history' },
  { key: 'rankings', label: 'RANKINGS', icon: '▲', soon: true },
  { key: 'account', label: 'ACCOUNT', icon: '●', href: '/sim/account' },
];

// TWO BOTTOM BARS IS ONE TOO MANY. The app container now carries a global tab
// bar (components/shell/AppTabBar), and this one stacked directly on top of it
// on every /sim screen - a defect introduced by adding the app bar, caught in
// the chrome sweep. In the container the global bar wins: it owns PRACTICE and
// TRACKER, and history is moving to PROFILE, so nothing here is unreachable
// without it. On the WEB this bar is unchanged and still the only sim nav.
const subscribe = () => () => {};
const getSnapshot = () => isShellClient({
  cookie: document.cookie, search: window.location.search,
});
const getServerSnapshot = () => false;

export default function SimTabBar() {
  const pathname = usePathname() || '';
  const inShell = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const active =
    pathname === '/sim' ? 'draft'
      : pathname.startsWith('/sim/tracker') ? 'tracker'
        : pathname.startsWith('/sim/history') ? 'history'
          : pathname.startsWith('/sim/account') ? 'account'
            : null; // results / other sim pages: no tab highlighted

  if (inShell) return null;

  return (
    <nav className="simtab" aria-label="Sim navigation">
      {TABS.map((t) => (t.soon ? (
        <span key={t.key} className="simtab-i soon" aria-disabled="true" title="Coming August">
          <span className="ic">{t.icon}</span>
          <span className="lb">{t.label}</span>
          <span className="soon-badge">AUG</span>
        </span>
      ) : (
        <Link key={t.key} href={t.href} className={`simtab-i${active === t.key ? ' on' : ''}`} aria-current={active === t.key ? 'page' : undefined}>
          <span className="ic">{t.icon}</span>
          <span className="lb">{t.label}</span>
        </Link>
      )))}
    </nav>
  );
}
