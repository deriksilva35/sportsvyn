'use client';

// components/league/LeagueSwitcher.js — the title is the switcher.
//
// THE SMALLEST CLIENT BOUNDARY THAT DOES THE JOB, and <details> was the first
// thing tried. It cannot do this: the mock needs a backdrop that dims the page
// and closes on tap, Escape to close, and dialog semantics with focus returned
// to the trigger. <details> gives none of those, and faking them with CSS ends
// up as more code than this with worse keyboard behaviour.
//
// EVERYTHING IT RENDERS IS PRECOMPUTED ON THE SERVER. Rows, hrefs and week
// eyebrows all arrive as props - this component decides one thing, whether the
// sheet is open, and knows nothing about leagues or routes.
//
// THE WAY HOME LIVES INSIDE THE SHEET. The title used to be a link to the
// league's landing; now it opens the sheet, and the sheet's current-league row
// carries that link. One tap target rather than a split hitbox where the left
// half navigates and the right half opens something.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function LeagueSwitcher({ label, rows }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); return; }
      if (e.key !== 'Tab') return;
      // FOCUS TRAP. Inside a modal the tab order must not walk out into a page
      // the reader cannot see - it is dimmed and inert behind the backdrop.
      const items = sheetRef.current?.querySelectorAll('a[href]');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    sheetRef.current?.querySelector('a[href]')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="lsw"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lgh-h1">{label}</span>
        <span className="lsw-chev" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>

      {open ? (
        <>
          {/* TAP-OUT CLOSES. The backdrop is the affordance; it dims the page
              behind so the sheet is plainly the only live thing on screen. */}
          <button type="button" className="lsw-back" aria-label="Close league switcher" onClick={() => setOpen(false)} />
          <div className="lsw-sheet" role="dialog" aria-modal="true" aria-label="Leagues" ref={sheetRef}>
            <div className="lsw-hd">Leagues</div>
            {rows.map((r) => (
              <Link
                key={r.slug}
                href={r.href}
                className={`lsw-row${r.current ? ' on' : ''}`}
                aria-current={r.current ? 'true' : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="lsw-nm">{r.label}</span>
                {r.eyebrow ? <span className="lsw-ctx">{r.eyebrow}</span> : null}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
