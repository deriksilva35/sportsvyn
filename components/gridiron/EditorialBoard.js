// components/gridiron/EditorialBoard.js — a hand-seeded Edition 0 board (Power
// Rankings, MVP, Sportsvyn 25, Heisman). PRESEASON · EDITION N kicker, rank + name
// (+ team tag for player boards) + serif read. A DARK HORSES band divides the
// dark-horse ranks; rank-only rows render without a read by design. No movement
// chips (Edition 0 has no prior). Renders null when the board isn't seeded.

// Render markdown **bold** inline (the footer's team names) -> <strong>.
function inlineBold(text) {
  return text.split('**').map((seg, i) => (i % 2 === 1 ? <strong key={i}>{seg}</strong> : seg));
}

export default function EditorialBoard({ title, board }) {
  if (!board || !board.entries.length) return null;
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
      <div className="gi-instrument-h gi-ed-h">
        <span>{title}</span>
        <span className="gi-ed-kick">Preseason · Edition {board.editionNumber}</span>
      </div>
      <ol className="gi-ed-list">{rows}</ol>
      {board.footer && <div className="gi-ed-footer">{inlineBold(board.footer)}</div>}
    </section>
  );
}
