// components/gridiron/EditorialBoard.js — a hand-seeded Edition 0 board (Power
// Rankings, MVP, Sportsvyn 25, Heisman).
//   preview: top 5 (compact, no reads) + a "+ N dark horses" teaser + "Full board
//            ->" to the hub tab. No footer. Used on the Today page.
//   full:    every row with its serif read, the DARK HORSES band, rank-only rows
//            without a read, and the "Named and left off" footer. Used on the hub.
// PRESEASON · EDITION N kicker; no movement chips (Edition 0 has no prior).

import { previewEntries, darkHorseCount } from '@/lib/gridiron/rankingsHub';

// Render markdown **bold** inline (the footer's team names) -> <strong>.
function inlineBold(text) {
  return text.split('**').map((seg, i) => (i % 2 === 1 ? <strong key={i}>{seg}</strong> : seg));
}

/**
 * The board's own heading.
 *
 * `slice` IS A SEPARATE LINE, not part of the title, because the two are
 * different facts: which board this is, and how much of it you are looking at.
 * Glued together as "The Sportsvyn 25 · Top 5" they wrapped mid-phrase in a
 * narrow column - a phone rail broke it as "THE SPORTSVYN 25 · TOP / 5", which
 * reads as a title that ran out of room rather than as a deliberate label.
 * Callers that pass no slice (the league Today pages, the rankings hub) render
 * exactly as before.
 */
function Head({ title, slice, editionNumber }) {
  return (
    <div className="gi-instrument-h gi-ed-h">
      <span className="gi-ed-name">
        <span className="gi-ed-title">{title}</span>
        {slice ? <span className="gi-ed-slice">{slice}</span> : null}
      </span>
      <span className="gi-ed-kick">Preseason · Edition {editionNumber}</span>
    </div>
  );
}

export default function EditorialBoard({ title, slice = null, board, preview = false, href = null }) {
  if (!board || !board.entries.length) return null;

  if (preview) {
    const top = previewEntries(board.entries, 5);
    const dh = darkHorseCount(board.entries);
    return (
      <section className="gi-instrument gi-ed" data-surface="ink">
        <Head title={title} slice={slice} editionNumber={board.editionNumber} />
        <ol className="gi-ed-list gi-ed-list--compact">
          {top.map((e) => (
            <li key={e.rank} className="gi-ed-row compact">
              <span className="gi-ed-rk">{e.rank}</span>
              <span className="gi-ed-nm">{e.label}{e.teamTag && <span className="gi-ed-tag">{e.teamTag}</span>}</span>
            </li>
          ))}
        </ol>
        <div className="gi-ed-more">
          {dh > 0 && <span className="gi-ed-teaser">+ {dh} dark horses</span>}
          {href && <a className="gi-ed-full" href={href}>Full board →</a>}
        </div>
      </section>
    );
  }

  const firstDH = board.entries.findIndex((e) => e.band === 'dark_horse');
  const rows = [];
  board.entries.forEach((e, i) => {
    if (i === firstDH) rows.push(<li key="dh-band" className="gi-ed-band">Dark Horses</li>);
    rows.push(
      <li key={e.rank} className={`gi-ed-row${e.read ? '' : ' rank-only'}`}>
        <span className="gi-ed-rk">{e.rank}</span>
        <div className="gi-ed-main">
          <div className="gi-ed-nm">{e.label}{e.teamTag && <span className="gi-ed-tag">{e.teamTag}</span>}</div>
          {e.read && <div className="gi-ed-read">{e.read}</div>}
        </div>
      </li>,
    );
  });

  return (
    <section className="gi-instrument gi-ed" data-surface="ink">
      <Head title={title} slice={slice} editionNumber={board.editionNumber} />
      <ol className="gi-ed-list">{rows}</ol>
      {board.footer && <div className="gi-ed-footer">{inlineBold(board.footer)}</div>}
    </section>
  );
}
