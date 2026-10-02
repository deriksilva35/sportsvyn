// components/boards/BoardChips.js - National + the reader's own leagues, the
// mock's chip row. ONE chip row for every board that filters by league: it was
// LiveBoard's inline <nav> (the Weekly and Draft boards) and moved here so the
// Pick'em grade screen draws the same control rather than a second one.
//
// PURE PRESENTATION and NO STYLESHEET IMPORT - the page loads app/boards/board.css
// (a render test imports this file in node, where a .css import would throw).
// The chips' colours are the .lb tokens, so outside a LiveBoard the row is
// drawn inside `.lb.lb-embed` (the same wrapper the YouCard uses on /october).
//
// One chip (National alone - a reader in no league) draws nothing: a filter
// with one choice is not a control.

import Link from 'next/link';

export default function BoardChips({ chips = [], embed = false }) {
  if (chips.length < 2) return null;
  const nav = (
    <nav className="lb-chips" aria-label="Which board">
      {chips.map((c) => (
        <Link key={c.href} className={`lb-chip${c.on ? ' on' : ''}`} href={c.href} aria-current={c.on ? 'page' : undefined}>{c.label}</Link>
      ))}
    </nav>
  );
  return embed ? <div className="lb lb-embed">{nav}</div> : nav;
}
