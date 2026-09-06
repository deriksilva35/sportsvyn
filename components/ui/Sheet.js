'use client';

/**
 * components/ui/Sheet.js - the Daily's centered modal sheet, extracted so a
 * second surface can use it without a second implementation.
 *
 * THIS IS components/daily/season/SeasonBoard.js's OWN SHEET, lifted whole:
 * same .sbd-back backdrop, same .sbd-sheet panel, same portal-to-body, same
 * .sbd-sh sticky volt header. The Daily is left on its own inline copy for
 * now - it has two sheet modes wired into its own state machine and moving
 * it is a refactor with no user-visible payoff today - but the MARKUP and
 * the CSS are the Daily's, not a lookalike, so the two cannot drift into
 * different-looking modals.
 *
 * WHY A PORTAL TO document.body, and it is load-bearing rather than tidy:
 * position:fixed inside a subtree that has ANY ancestor with a CSS
 * transform stops being viewport-relative and behaves like absolute
 * positioning on that ancestor instead - which reads as a drawer stuck to
 * the middle of the page rather than a centered sheet. The app's shell
 * chrome does use transforms. seasonBoard.css says the same thing above
 * .sbd-sheet; this is the same fix for the same reason.
 *
 * DISMISSIBLE, UNLIKE THE DAILY'S. The Daily's backdrop is deliberately
 * inert while a pick is pending - that omission is its "no way out" rule
 * mid-round. A Weekly slot has no clock and nothing is consumed by opening
 * it, so backdrop-tap and Escape both close.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function Sheet({ open, onClose, title, subtitle, children }) {
  const [mountNode] = useState(() => (typeof document !== 'undefined' ? document.body : null));

  // ESCAPE CLOSES. A sheet with no keyboard exit is a trap on the web, and
  // this one is genuinely dismissible.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mountNode) return null;

  return createPortal(
    <>
      <div className="sbd-back" onClick={onClose} />
      <div className="sbd-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sbd-sh">
          <b>{title}</b>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {children}
      </div>
    </>,
    mountNode,
  );
}
