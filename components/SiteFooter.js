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

import Wordmark from '@/components/Wordmark';
import { NFL_NON_AFFILIATION } from '@/lib/legal';

import './site-chrome.css';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">
          <Wordmark sizeClassName="text-[28px]" />
          <p className="tagline">Read the Game. Editorial sports coverage that takes the reader seriously.</p>
          <p className="copyright">© 2026 Sportsvyn · Considered Network</p>
        </div>
        <div className="footer-links">
          <div className="footer-col">
            <h4>Read</h4>
            <a href="#">Daily Card</a>
            <a href="/world-cup-2026/bracket">Bracket</a>
            <a href="/sim">Mock Draft</a>
            <a href="#">Rankings</a>
            <a href="#">Stats</a>
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
