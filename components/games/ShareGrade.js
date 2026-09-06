'use client';

/**
 * components/games/ShareGrade.js - the one share module for the Weekly's,
 * the Draft's and Pick'em's grade screens (relay 2b item 5): glyph row +
 * caption + URL, navigator.share where available, clipboard fallback
 * otherwise. Modeled on the Daily's own inline share
 * (components/daily/season/SeasonBoard.js's GradeScreen) - same text shape,
 * same clipboard-then-flash pattern - with navigator.share layered on top,
 * which nothing in this codebase used before (a repo-wide grep for
 * navigator.share came back empty). The Daily's own inline copy is left
 * alone; this is a new, standalone module for the three surfaces that need
 * one, not a refactor of a working, unrelated screen.
 */

import { useState } from 'react';

/**
 * @param {string} glyph    the emoji glyph row, already built by the caller
 * @param {string} caption  everything under the glyph row, newline-joined -
 *   the caller owns its own wording (points/pct/rank differ per game)
 * @param {string} url      e.g. 'sportsvyn.com/weekly'
 */
export default function ShareGrade({ glyph, caption, url }) {
  const [copied, setCopied] = useState(false);
  const shareText = [glyph, caption, url].filter(Boolean).join('\n');

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch {
        // Cancelled or unsupported mid-call - fall through to clipboard so
        // the tap never does nothing.
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable - the text is still
      // visible on screen to select by hand.
    }
  };

  return (
    <div className="gg-share">
      <div className="gg-g">{glyph}</div>
      <div className="gg-cap">{caption}<br />{url}</div>
      <button type="button" className="gg-share-btn" onClick={handleShare}>
        {copied ? 'Copied' : 'Share'}
      </button>
    </div>
  );
}
