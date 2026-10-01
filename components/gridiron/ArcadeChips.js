'use client';
// components/gridiron/ArcadeChips.js - the live game page's chip row (arcade):
// Plays | Box | Stats | Market. Every section is rendered on the server and
// handed in; this only says which one is showing. No fetch, no effect.
import { useState } from 'react';

export default function ArcadeChips({ panels, nodes }) {
  const [active, setActive] = useState(panels[0]?.key ?? null);
  if (!panels.length) return null;
  return (
    <section className="gpa-sect" aria-label="Game detail">
      <div className="gpa-chips" role="tablist">
        {panels.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={active === p.key}
            className={`gpa-chip${active === p.key ? ' on' : ''}`} data-chip={p.key}
            onClick={() => setActive(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {panels.map((p) => (
        <div key={p.key} role="tabpanel" data-panel={p.key} hidden={active !== p.key}>{nodes[p.key]}</div>
      ))}
    </section>
  );
}
