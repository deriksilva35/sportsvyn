// components/rankings/Module.js - the card every ranking sits in.
// NO ROWS, NO MODULE - the same law the league landing follows. A heading
// over an empty list reads as a feature that failed to load.

import Link from 'next/link';

export default function Module({ title, sub = null, children, href = null, cta = null, note = null, section }) {
  return (
    <section className="rk-mod" data-module={section}>
      <div className="rk-hd">
        <span className="rk-eb">{title}</span>
        {sub ? <span className="rk-sub">{sub}</span> : null}
      </div>
      {children}
      {note ? <p className="rk-note">{note}</p> : null}
      {href ? <Link className="rk-ghost" href={href}>{cta}</Link> : null}
    </section>
  );
}
