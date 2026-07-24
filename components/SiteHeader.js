'use client';

/**
 * SiteHeader — shared chrome for /match/[slug] and /bracket.
 *
 * Desktop (≥768px): renders the exact markup the inline SiteHeader
 * functions on both pages used before this extraction — wordmark + 4
 * nav links + Sign In + Become a Member, single flex row.
 *
 * Mobile (<768px): the desktop nav and CTA cluster collapse to
 * display:none; a hamburger button appears and toggles a drawer below
 * the header bar that stacks the same 6 actions (Home, Bracket,
 * Rankings, Reads, + the right-side cluster). State is local — closes
 * naturally on link clicks because the links are <a href="…">, which
 * trigger full page navigation and remount the component.
 *
 * Active prop: pages pass activeNav="bracket" (etc.) to apply the
 * paper-warm active style; absent prop = no active highlight.
 *
 * Session prop: passed by SiteHeaderServer (the server shell that
 * calls await auth()). When session?.user exists, the right-side
 * cluster flips from "Sign In · Become a Member" to
 * "{email-local-part} · Sign out". No SessionProvider, no
 * useSession() — session is resolved server-side and prop-drilled.
 * Sign out fires client-side via signOut() from 'next-auth/react' and
 * redirects to '/'. The Become a Member button routes into the same
 * magic-link flow (/signin) by design — passwordless = no separate
 * signup UX.
 *
 * /team/[slug] and /player/[slug] also use this SiteHeader since the
 * divergent inline-crumb variant was retired. They drop the
 * decorative "WORLD CUP 2026 / TEAM | PLAYER" pill in favor of the
 * in-body breadcrumb they were already rendering.
 *
 * Wordmark is wrapped in <a href="/"> so a tap on the brand routes
 * home from every route. The .wordmark-home tap-target rule lives in
 * components/site-chrome.css.
 */

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import NavDropdown from '@/components/NavDropdown';

import './site-chrome.css';

// FOOTBALL + SOCCER menu contents. Routes are NOT renamed to /soccer/* — nav
// labels only. World Cup lands on the bracket (the existing WC hub). Premier
// League is a non-interactive "coming soon" item (no link, no dead href).
const FOOTBALL_ITEMS = [
  { label: 'Scores', href: '/scores' },
  { label: 'NFL', href: '/nfl' },
  { label: 'CFB', href: '/cfb' },
];
const SOCCER_ITEMS = [
  { label: 'World Cup', href: '/world-cup-2026/bracket' },
  { label: 'Schedule', href: '/schedule' },
  { label: 'Rankings', href: '/world-cup-2026/rankings' },
  { label: 'Stats', href: '/stats' },
  { label: 'Premier League', comingSoon: true },
];
// Map the per-page activeNav keys onto the new top-level groups so existing call
// sites (activeNav="bracket" etc.) still light the right tab.
const FOOTBALL_ACTIVE = new Set(['football', 'scores', 'nfl', 'cfb']);
const SOCCER_ACTIVE = new Set(['soccer', 'bracket', 'rankings', 'stats', 'schedule']);

function navClass(activeNav, key) {
  return activeNav === key ? 'active' : undefined;
}

function shortLabel(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export default function SiteHeader({ activeNav = null, session = null }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const isAuthed = !!session?.user;
  const label = isAuthed ? shortLabel(session.user.email) : '';

  // Preserve where the user is when they click Sign In, so the
  // magic-link click returns them HERE instead of '/' — passed through
  // as ?callbackUrl=, read by /signin, forwarded as signIn's redirectTo.
  // Guard against ?callbackUrl=/signin loops if Sign In is somehow
  // clicked while already on the signin surface.
  const signinHref =
    pathname && !pathname.startsWith('/signin')
      ? `/signin?callbackUrl=${encodeURIComponent(pathname)}`
      : '/signin';

  // Signed-in account items (used by the desktop dropdown + the mobile drawer).
  const accountItems = [
    { label: 'My Sportsvyn', href: '/my' },
    { label: 'Membership', href: '/membership' },
    { label: 'Sign Out', onClick: () => signOut({ redirectTo: '/' }) },
  ];

  // Desktop right cluster: the single volt CTA (both auth states) + either the
  // account menu (signed in) or Sign In (signed out).
  function rightCluster() {
    return (
      <>
        <a href="/sim" className="nav-cta">Mock Draft</a>
        {isAuthed
          ? <NavDropdown label={label} items={accountItems} align="right" />
          : <a href={signinHref} className="signin">Sign In</a>}
      </>
    );
  }

  return (
    <>
      <header className="site-header">
        <div className="brand-row">
          <Link href="/" className="wordmark-home" aria-label="Sportsvyn home">
            <Wordmark sizeClassName="text-[28px]" />
          </Link>
        </div>
        <div className="nav">
          <Link href="/" className={navClass(activeNav, 'home')}>Home</Link>
          <NavDropdown label="Football" items={FOOTBALL_ITEMS} active={FOOTBALL_ACTIVE.has(activeNav)} />
          <NavDropdown label="Soccer" items={SOCCER_ITEMS} active={SOCCER_ACTIVE.has(activeNav)} />
          <a href="/market" className={navClass(activeNav, 'market')}>Market</a>
        </div>
        <div className="header-cta">
          {rightCluster()}
        </div>
        <button
          type="button"
          className="hamburger-btn"
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
      </header>

      {drawerOpen && (
        <nav className="mobile-drawer" aria-label="Mobile menu">
          {/* Same condensation as desktop: HOME, then the two sport groups
              flattened under muted group labels, MARKET, the volt CTA, and the
              account block. The dropdowns collapse to labelled link lists on
              mobile (no nested disclosure). */}
          <Link href="/" className={navClass(activeNav, 'home')}>Home</Link>

          <div className="drawer-group-label">Football</div>
          {FOOTBALL_ITEMS.map((it) => <a key={it.label} href={it.href} className="drawer-sub">{it.label}</a>)}

          <div className="drawer-group-label">Soccer</div>
          {SOCCER_ITEMS.map((it) => (it.comingSoon
            ? <span key={it.label} className="drawer-sub is-soon">{it.label}<span className="nav-dd-soon">coming soon</span></span>
            : <a key={it.label} href={it.href} className="drawer-sub">{it.label}</a>))}

          <a href="/market" className={navClass(activeNav, 'market')}>Market</a>

          <a href="/sim" className="nav-cta">Mock Draft</a>

          {isAuthed ? (
            <>
              <div className="drawer-group-label">{label}</div>
              {accountItems.map((it) => (it.onClick
                ? <button key={it.label} type="button" className="drawer-sub signout" onClick={it.onClick}>{it.label}</button>
                : <a key={it.label} href={it.href} className="drawer-sub">{it.label}</a>))}
            </>
          ) : (
            <a href={signinHref} className="signin">Sign In</a>
          )}
        </nav>
      )}
    </>
  );
}
