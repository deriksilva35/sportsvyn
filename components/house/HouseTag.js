// components/house/HouseTag.js - the marker and the method line.
//
// OPENLY THE HOUSE. Every house row on every leaderboard carries both halves:
// a marker beside the handle so a reader knows in one glance that the row is
// us, and the method line so they know what rule produced the number they are
// being beaten by. One without the other is the part that reads as a cheat -
// a marked row with no method is a mystery, and a method with no marker is a
// stranger who happens to explain themselves.
//
// IT IS NOT A BADGE OF QUALITY and must not look like one. Muted, small, and
// the same on a row winning the board as on a row losing it.
//
// A ROW WITH NO METHOD STILL GETS THE MARKER. That combination should not
// occur - a persona with no method on a game files no entry there - but if it
// ever does, the honest rendering is "this is the house" with nothing claimed
// about how, rather than a blank row pretending to be a person.

export default function HouseTag({ row = null, inline = false }) {
  if (!row?.house) return null;
  return (
    <span className={`hs${inline ? ' hs--inline' : ''}`} data-house={row.persona ?? 'house'}>
      <span className="hs-mark" title="A Sportsvyn house entry">HOUSE</span>
      {row.method ? <span className="hs-method">{row.method}</span> : null}
    </span>
  );
}

/** The marker alone, for a row too tight to carry the method line. */
export function HouseMark({ row = null }) {
  if (!row?.house) return null;
  return <span className="hs-mark" data-house={row.persona ?? 'house'} title={row.method ?? 'A Sportsvyn house entry'}>HOUSE</span>;
}
