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
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import Wordmark from '@/components/Wordmark';

import './site-chrome.css';

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
  const router = useRouter();
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

  // Right-side cluster as a small render function so desktop + mobile
  // drawer reuse identical markup (and stay in sync if the auth state
  // changes between renders).
  function rightCluster() {
    if (isAuthed) {
      return (
        <>
          <span className="signin">{label}</span>
          <button
            type="button"
            className="signin"
            onClick={() => signOut({ redirectTo: '/' })}
          >
            Sign out
          </button>
        </>
      );
    }
    return (
      <>
        <a href={signinHref} className="signin">Sign In</a>
        <button
          type="button"
          className="member-btn"
          onClick={() => router.push(signinHref)}
        >
          Become a Member
        </button>
      </>
    );
  }

  return (
    <>
      <header className="site-header">
        <div className="brand-row">
          <a href="/" className="wordmark-home" aria-label="Sportsvyn home">
            <Wordmark sizeClassName="text-[28px]" />
          </a>
        </div>
        <div className="nav">
          <a href="/" className={navClass(activeNav, 'home')}>Home</a>
          <a href="/schedule" className={navClass(activeNav, 'schedule')}>Schedule</a>
          <a href="/bracket" className={navClass(activeNav, 'bracket')}>Bracket</a>
          <a href="/power-rankings" className={navClass(activeNav, 'power-rankings')}>Rankings</a>
          {/* Reads dead-link still removed until that route ships.
              Daily Card kept since href="/" resolves (links into the same
              surface Daily Card lives on). */}
          <a href="/" className={navClass(activeNav, 'daily-card')}>Daily Card</a>
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
          <a href="/" className={navClass(activeNav, 'home')}>Home</a>
          <a href="/schedule" className={navClass(activeNav, 'schedule')}>Schedule</a>
          <a href="/bracket" className={navClass(activeNav, 'bracket')}>Bracket</a>
          <a href="/power-rankings" className={navClass(activeNav, 'power-rankings')}>Rankings</a>
          {/* Reads dead-link still removed; Daily Card kept (href="/"
              resolves to the same surface). */}
          <a href="/" className={navClass(activeNav, 'daily-card')}>Daily Card</a>
          {rightCluster()}
        </nav>
      )}
    </>
  );
}
