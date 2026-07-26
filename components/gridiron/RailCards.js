// components/gridiron/RailCards.js — league-page rail cards: Suite teasers (NFL,
// FOOTBALL SUITE lock chip + SEE PLANS -> /membership), Upset Watch (CFB, live dog
// probabilities off the h2h de-vig, "Not a play"), and The Read dormant frame.

import { SUITE_TEASERS, UPSET_NOTE, READ_BLANK } from './leagueCopy';

export function SuiteTeasers() {
  return (
    <>
      {SUITE_TEASERS.map((t) => (
        <section key={t.headline} className="gi-rail-card gi-tease" data-surface="ink">
          <span className="gi-tease-lock">{t.lock}</span>
          <div className="gi-tease-h">{t.headline}</div>
          <p className="gi-tease-s">{t.body}</p>
          <a className="gi-tease-cta" href="/membership">SEE PLANS →</a>
        </section>
      ))}
    </>
  );
}

export function UpsetWatch({ dogs = [] }) {
  return (
    <section className="gi-rail-card gi-uw" data-surface="ink">
      <div className="gi-rail-h">Upset Watch</div>
      {dogs.length === 0 ? (
        <div className="gi-rail-empty">Dog probabilities open with the slate.</div>
      ) : (
        <ul className="gi-uw-list">
          {dogs.map((d) => (
            <li key={d.label} className="gi-uw-row">
              <span className="gi-uw-dog">{d.label}</span>
              <span className="gi-uw-p">{d.pct.toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      )}
      <div className="gi-uw-note">{UPSET_NOTE}</div>
    </section>
  );
}

export function TheRead({ league = 'nfl' }) {
  return (
    <section className="gi-instrument gi-read" data-surface="ink">
      <div className="gi-instrument-h gi-ed-h"><span>The Read</span><span className="gi-ed-kick">Every week</span></div>
      <div className="gi-read-blank">
        <div className="gi-read-h">{READ_BLANK.headline}</div>
        <div className="gi-read-s">{READ_BLANK[league] ?? READ_BLANK.nfl}</div>
      </div>
    </section>
  );
}
