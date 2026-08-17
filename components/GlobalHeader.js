'use client';

/**
 * GlobalHeader - the one header, on every route.
 *
 * The site ran two. The paper header (HOME / FOOTBALL / SOCCER / MARKET, with a
 * hamburger drawer and real session state) served the homepage, the articles,
 * the soccer surfaces and /market. The ink gridiron header (TODAY / SCORES /
 * NFL / CFB / SOCCER) served /scores, /nfl, /cfb and the game page. A reader
 * moving from the Daily Card to a box score watched the chrome change shape,
 * and the two navs did not agree about where anything was.
 *
 * This is the gridiron header's look with the paper header's brain.
 *
 * WHAT THE MERGE FIXED, each of which was live:
 *   - TODAY pointed at /nfl from all three gridiron call sites, so on /cfb the
 *     "today" link took you to the other league. It now points at /, the Daily
 *     Card, which is what today means.
 *   - The wordmark landed in three different places depending on the route
 *     (/scores by default, /nfl or /cfb where a caller overrode it). It now
 *     always goes to /.
 *   - The MEMBER chip was hardcoded markup. It rendered for signed-out
 *     visitors on every gridiron page - a badge that was simply false. Member
 *     state is now resolved server-side from the entitlement the rest of the
 *     app gates on, and a non-member sees SIGN IN.
 *   - The gridiron header had no mobile treatment at all, only horizontal
 *     scroll. The drawer comes with the merge.
 *
 * SECTION-LOCAL SUB-NAVS ARE UNTOUCHED. A league's Today / Scores & Schedule /
 * Rankings / Fantasy strip is a different layer answering a different question,
 * and unifying it would flatten the site's only sense of place.
 */

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { signOutTarget } from '@/lib/shell/signOutTarget';
import { logOutPurchases } from '@/lib/shell/purchaseBridge';
import { NAV, resolveActive, accountMenu, signinHrefFor } from '@/lib/nav';
import Link from 'next/link';
import Wordmark from '@/components/gridiron/Wordmark';
import NavDropdown from '@/components/NavDropdown';

import './site-chrome.css';
import '@/components/gridiron/gridiron.css';

function shortLabel(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export default function GlobalHeader({
  activeNav = null, session = null, shell = false, isMember = false,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const isAuthed = !!session?.user;
  const label = isAuthed ? shortLabel(session.user.email) : '';
  const active = resolveActive(activeNav);
  const signinHref = signinHrefFor(pathname);

  // SIGN OUT ALSO LOGS OUT OF REVENUECAT. The sim's SignOutButton has always
  // done this; the header did not, so signing out from the chrome left the
  // SDK holding the previous user's appUserID in the webview. The next person
  // to sign in on the same device would transact under it until a fresh
  // configure() ran - and because the store transfers a non-consumable to
  // whoever last claimed it, that is exactly how a Pass lands on the wrong
  // account. Best-effort and never allowed to block the sign-out itself.
  async function handleSignOut() {
    try { await logOutPurchases(); } catch { /* never block sign-out */ }
    signOut({ redirectTo: signOutTarget(shell) });
  }

  const accountItems = accountMenu({ shell }).map((it) => (it.action === 'signout'
    ? { label: it.label, onClick: handleSignOut }
    : { label: it.label, href: it.href }));

  return (
    <>
      <header className="gi-head gh">
        <Wordmark href="/" />

        <nav className="gi-head-nav gh-nav" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.key} href={n.href} className={active === n.key ? 'active' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="gi-head-right gh-right">
          <Link href="/my" className="gh-my">MY SPORTSVYN</Link>
          {/* The funnel. It is the one thing on this bar a first-time visitor
              can act on, so it keeps the volt and it keeps its place in both
              auth states. */}
          <Link href="/sim" className="gh-cta">MOCK DRAFT</Link>
          {isAuthed
            ? (
              <span className="gh-account">
                {isMember ? <span className="gi-member">MEMBER</span> : null}
                <NavDropdown label={label} items={accountItems} align="right" />
              </span>
            )
            : <Link href={signinHref} className="gh-signin">SIGN IN</Link>}
        </div>

        <button
          type="button"
          className="gh-burger"
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
      </header>

      {drawerOpen && (
        <nav className="gh-drawer" aria-label="Menu">
          {NAV.map((n) => (
            <Link key={n.key} href={n.href} className={active === n.key ? 'active' : undefined}>
              {n.label}
            </Link>
          ))}
          <Link href="/my">MY SPORTSVYN</Link>
          <Link href="/sim" className="gh-cta">MOCK DRAFT</Link>
          {isAuthed ? (
            <>
              <div className="gh-drawer-label">
                {label}{isMember ? <span className="gi-member">MEMBER</span> : null}
              </div>
              {accountItems.map((it) => (it.onClick
                ? <button key={it.label} type="button" className="gh-drawer-sub gh-signout" onClick={it.onClick}>{it.label}</button>
                : <Link key={it.label} href={it.href} className="gh-drawer-sub">{it.label}</Link>))}
            </>
          ) : (
            <Link href={signinHref} className="gh-signin">SIGN IN</Link>
          )}
        </nav>
      )}
    </>
  );
}
