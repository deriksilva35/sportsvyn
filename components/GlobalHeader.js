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

  // ---- THE APP HEADER ------------------------------------------------------
  // IN THE CONTAINER, THE WEB HEADER IS REPLACED RATHER THAN TRIMMED. The
  // burger opens a drawer duplicating navigation the tab bar already owns; MY
  // SPORTSVYN and MOCK DRAFT are funnel links for a first-time WEB visitor, and
  // nobody inside the app is one; the account dropdown is what PROFILE is. Left
  // in place they would be four ways to reach two destinations, three of them
  // worse than the tab bar underneath.
  //
  // SO: the wordmark, centred, and nothing else. The tab bar IS the nav.
  //
  // NOT A LINK. On the web the wordmark goes home; here HOME is a tab, and a
  // header that navigates on tap competes with the bar for the same job.
  if (shell) {
    return (
      <header className="gh gh--app">
        <AppWordmark />
      </header>
    );
  }

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

/**
 * The app container's wordmark: centred, not a link.
 *
 * THE APP IS DRAFTVYN. The bundle is com.sportsvyn.draftvyn and the App Store
 * listing is the sim, so the container wears the product's own mark rather than
 * the publication's.
 *
 * EVERY CONSTANT BELOW WAS MEASURED FROM THIS FILE, not inherited. The two
 * exports came off different pipelines and they do not share geometry:
 *
 *                    SPORTSVYN            DRAFTVYN
 *   file             1568x336             1500x300
 *   caps             133px = 0.3958       125px = 0.4167
 *   structure        macron+caps+rule     macron+caps, NO underline
 *   ink box          full width, bottom   x 293..1213, y 82..233
 *                    flush                (39% of the width is padding)
 *
 * Note the SPORTSVYN filename says 3000x600 and the file is 1568x336 - which is
 * why these are measured rather than read off a name.
 *
 * WHY 1.71em AND NOT 1.8em. The header was built around a cap height of
 * 0.3958 x 1.8em = 0.7125em. Draftvyn's caps are a larger fraction of its box,
 * so the same 1.8em would set the type visibly bigger. 0.7125 / 0.4167 = 1.71em
 * reproduces the cap height exactly: 12.11px at this header's 17px font size,
 * against Sportsvyn's 12.11px. The MARK will read lighter regardless, because
 * this lockup has no underline - that is the mark being different, not the
 * sizing being wrong.
 *
 * THE HORIZONTAL PADDING IS HARMLESS HERE and would not be elsewhere: 293px
 * left and 286px right of empty pixels make the element ~60% wider than the
 * visible mark. In a centred header with nothing beside it that costs nothing,
 * and the padding is near-symmetric so the mark still centres true. Anywhere
 * this mark sits NEXT to something, measure again.
 *
 * PLAIN <img>, MATCHING components/gridiron/Wordmark.js - ratified. The
 * established wordmark rule is a plain tag with a locked aspect and an em-based
 * height; next/image's layout handling fights a lockup rather than helping it.
 */
function AppWordmark() {
  return (
    <span className="gh-app-mark" aria-label="DRAFTVYN">
      <img
        src="/brand/draftvynwordmarkwhite1500x300transparent.png"
        alt="DRAFTVYN"
        width={1500}
        height={300}
        fetchPriority="high"
        decoding="async"
        style={{ height: '1.71em', width: 'auto', display: 'block' }}
      />
    </span>
  );
}
