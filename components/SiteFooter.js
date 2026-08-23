/**
 * SiteFooter — shared chrome for /match/[slug] and /bracket. Server
 * component (no state). Markup verbatim from the inline SiteFooter
 * functions both pages defined before this extraction.
 *
 * One link target normalized: the "Bracket" link in the Read column
 * now points to /bracket (matching the bracket page's pre-extraction
 * version). The match page's pre-extraction footer had it as "#" — a
 * stale placeholder from when /bracket didn't exist yet. Both pages
 * now share the corrected target.
 */

import Link from 'next/link';
import Wordmark from '@/components/Wordmark';
import HideInShell from '@/components/shell/HideInShell';
import { NFL_NON_AFFILIATION } from '@/lib/legal';

import './site-chrome.css';

/**
 * NOT RENDERED IN THE APP CONTAINER. It is the largest web artifact left in the
 * shell - a full column of site navigation and legal, sitting above a tab bar
 * that already owns navigation. Wrapped here rather than at each of the twenty
 * call sites, so no page can forget.
 *
 * PRIVACY AND TERMS MOVED TO PROFILE rather than disappearing. The App Store
 * expects legal to be reachable in-app, and two ghost links in the account
 * section is the native pattern for it.
 */
export default function SiteFooter() {
  return (
    <HideInShell>{siteFooterMarkup()}</HideInShell>
  );
}

function siteFooterMarkup() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">
          <Wordmark sizeClassName="text-[28px]" />
          <p className="tagline">Read the Game. Editorial sports coverage that takes the reader seriously.</p>
          <p className="copyright">© 2026 Sportsvyn · Considered Network</p>
        </div>
        <div className="footer-links">
          {/* THE DEAD SLOTS ARE WIRED. Daily Card, Rankings and Stats sat on
              href="#" while the routes behind them existed, and the global-nav
              unification took the last link to /schedule and /stats with it -
              both were reachable only from the retiring header. A route with no
              way in is not a decision anyone made, so the footer is where they
              land. Market moves here for the same reason: it dropped out of the
              top-level nav and had only the /my panel link left. */}
          <div className="footer-col">
            <h4>Read</h4>
            <Link href="/">Daily Card</Link>
            <Link href="/scores">Scores</Link>
            <Link href="/nfl/fantasy">Fantasy</Link>
            <Link href="/sim">Mock Draft</Link>
            <Link href="/nfl/rankings">Rankings</Link>
            <Link href="/market">Market</Link>
          </div>
          <div className="footer-col">
            {/* The World Cup links retired with the tournament (final
                19 Jul); the routes still serve for anyone holding a link. */}
            <h4>Soccer</h4>
            <Link href="/epl/standings">Premier League</Link>
            <Link href="/schedule">Schedule</Link>
            <Link href="/stats">Stats</Link>
          </div>
          <div className="footer-col">
            <h4>About</h4>
            <a href="#">Methodology</a>
            <a href="#">Voice Bible</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
          <div className="footer-col">
            <h4>Follow</h4>
            <a href="#">Newsletter</a>
            <a href="#">RSS</a>
          </div>
        </div>
      </div>
      <p className="footer-fine">{NFL_NON_AFFILIATION}</p>
    </footer>
  );
}
