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

/**
 * R5: ONE ROW OF PRODUCTS, ONE ROW OF SMALL PRINT. The four headed columns
 * (Read / Soccer / About / Follow) mapped an editorial site; the product is
 * games now, and the footer says so in two rows. Every link that left still
 * resolves - the routes were not removed, only this list of them - and
 * lib/footerLinks.test.mjs holds that. The three that pointed at "#" (Voice
 * Bible, Newsletter, RSS) were never destinations.
 */
export const FOOTER_PRODUCTS = Object.freeze([
  ['Play', '/games'], ['Scores', '/scores'], ['Market', '/market'],
  ['Rankings', '/rankings'], ['Leagues', '/leagues'],
]);
export const FOOTER_SMALL = Object.freeze([
  ['Methodology', '/methodology'], ['Privacy', '/privacy'], ['Terms', '/terms'],
  ['Contact', 'mailto:hello@sportsvyn.com'],
]);

function siteFooterMarkup() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner site-footer-inner--r5">
        <div className="footer-brand">
          <Wordmark sizeClassName="text-[28px]" />
          <p className="tagline">The arcade of sports games.</p>
        </div>
        <nav className="footer-row" aria-label="Products">
          {FOOTER_PRODUCTS.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <nav className="footer-small" aria-label="About">
          {FOOTER_SMALL.map(([label, href]) => (href.startsWith('mailto:')
            ? <a key={href} href={href}>{label}</a>
            : <Link key={href} href={href}>{label}</Link>))}
        </nav>
        <p className="copyright">© 2026 Sportsvyn</p>
      </div>
      <p className="footer-fine">{NFL_NON_AFFILIATION}</p>
    </footer>
  );
}
