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

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { key: 'draft', label: 'DRAFT', icon: '▦', href: '/sim' },
  { key: 'history', label: 'HISTORY', icon: '≡', href: '/sim/history' },
  { key: 'rankings', label: 'RANKINGS', icon: '▲', soon: true },
  { key: 'account', label: 'ACCOUNT', icon: '●', href: '/sim/account' },
];

export default function SimTabBar() {
  const pathname = usePathname() || '';
  const active =
    pathname === '/sim' ? 'draft'
      : pathname.startsWith('/sim/history') ? 'history'
        : pathname.startsWith('/sim/account') ? 'account'
          : null; // results / other sim pages: no tab highlighted

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
