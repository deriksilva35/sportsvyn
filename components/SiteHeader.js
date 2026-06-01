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
 * Rankings, Reads, Sign In, Become a Member). State is local — closes
 * naturally on link clicks because the links are <a href="…">, which
 * trigger full page navigation and remount the component.
 *
 * Active prop: pages pass activeNav="bracket" (etc.) to apply the
 * paper-warm active style; absent prop = no active highlight.
 *
 * Team page intentionally NOT migrated — that header is a divergent
 * variant (.site-header-inner wrapper, no CTA cluster, breadcrumb
 * instead of nav). Separate slice to reconcile.
 */

import { useState } from 'react';
import Wordmark from '@/components/Wordmark';

import './site-chrome.css';

function navClass(activeNav, key) {
  return activeNav === key ? 'active' : undefined;
}

export default function SiteHeader({ activeNav = null }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <div className="brand-row">
          <Wordmark sizeClassName="text-[22px]" />
        </div>
        <div className="nav">
          <a href="/" className={navClass(activeNav, 'home')}>Home</a>
          <a href="/bracket" className={navClass(activeNav, 'bracket')}>Bracket</a>
          <a href="#" className={navClass(activeNav, 'rankings')}>Rankings</a>
          <a href="#" className={navClass(activeNav, 'reads')}>Reads</a>
        </div>
        <div className="header-cta">
          <a href="#" className="signin">Sign In</a>
          <button type="button" className="member-btn">Become a Member</button>
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
          <a href="/bracket" className={navClass(activeNav, 'bracket')}>Bracket</a>
          <a href="#" className={navClass(activeNav, 'rankings')}>Rankings</a>
          <a href="#" className={navClass(activeNav, 'reads')}>Reads</a>
          <a href="#" className="signin">Sign In</a>
          <button type="button" className="member-btn">Become a Member</button>
        </nav>
      )}
    </>
  );
}
