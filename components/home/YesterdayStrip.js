// components/home/YesterdayStrip.js — yesterday's answer, on the Daily Card.
//
// WHY THIS IS A SEPARATE PIECE AND NOT A STATE OF THE MODULE ABOVE IT. The
// today-module asks about today, and today's row closes at midnight ET - the
// same instant the date rolls. So it could never render a closed day: on 17 Aug
// edition 002 showed its play state and edition 001's answer appeared nowhere.
// Yesterday is a different question about a different day, so it gets its own
// element.
//
// THE RECRUITING POSTER, NOT THE BOX SCORE. Three rows, muted, one link. It
// exists so a passer-by sees that this game has a real answer, real scores and
// other people playing it. The reveal page is the stats home and already
// carries all sixty-four rows with their box-score lines; duplicating any of
// that here would make the homepage the worse version of a page that exists.
//
// NO LEAK SURFACE: a revealed day is public by definition. This is the same
// data /daily/[date] serves to anyone with the URL.

import { tierClass } from '@/lib/daily/reveal';

export default function YesterdayStrip({ view }) {
  if (!view) return null;

  return (
    <section className="ystr" data-surface="ink">
      <div className="ystr-head">
        <span className="ystr-sq" aria-hidden="true" />
        <span className="ystr-kick">Yesterday&rsquo;s answer</span>
        {view.edition && <span className="ystr-ed">Edition No. {view.edition}</span>}
      </div>

      <div className="ystr-answer">
        <span className="ystr-yr">{view.season}</span>
        <span className="ystr-wk">Week {view.week}</span>
      </div>

      <div className="ystr-rows">
        {view.played ? (
          <div className="ystr-row">
            <span className="k">You</span>
            <span className="v">
              {view.score}
              {view.tier && <span className={`tierbadge ${tierClass(view.tier)}`}>{view.tier}</span>}
              {view.pct != null && <span className="dim"> {view.pct}% of perfect</span>}
            </span>
          </div>
        ) : (
          <div className="ystr-row">
            <span className="k">Perfect lineup</span>
            <span className="v">{view.perfect}</span>
          </div>
        )}

        {view.winner && (
          <div className="ystr-row">
            <span className="k">Top score</span>
            <span className="v">
              <span className={view.winner.name?.startsWith('@') ? '' : 'dim'}>{view.winner.name}</span>
              {' '}{view.winner.score}
            </span>
          </div>
        )}

        {view.played && view.perfect != null && (
          <div className="ystr-row">
            <span className="k">Perfect lineup</span>
            <span className="v dim">{view.perfect}</span>
          </div>
        )}
      </div>

      <a className="ystr-link" href={view.href}>The full board &rarr;</a>
    </section>
  );
}
