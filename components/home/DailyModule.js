// components/home/DailyModule.js — the Daily's doorway on the Daily Card.
//
// AN INK BLOCK ON THE CARD, per the Surface Rule: the Daily is an instrument,
// and instruments have one rendering. The paper treatment is mocked and banked
// in docs/design/daily-home-module-v1.html for the surface migration after
// preseason Week 1; nothing here assumes it.
//
// SERVER COMPONENT, NO CLOCK. The state is decided once, server-side, from
// (does an entry exist, has the day closed) - see dailyHomeView(). There is no
// ticking countdown: a live timer on an editorial page is a client island, a
// hydration cost and a re-render every second, to say something a static line
// says just as well. "Answer unlocks at midnight ET" does not need a clock.
//
// EYEBROW READS "TODAY'S BOARD", NOT "THE DAILY". The page it sits on is called
// The Daily Card, and two different things wearing one word on the same screen
// is a naming bug, not a style choice.
//
// WHAT IS NOT HERE IS THE POINT. States 1 and 2 carry no season, no week and no
// player name, because this page renders for signed-out strangers and half the
// internet. The view function enforces that and homeModule.test.mjs asserts it;
// this file only prints what it is handed.

import { shellSigninHref } from '@/lib/shell/signinHref';

export default function DailyModule({ view, isShell = false, signedIn = false }) {
  if (!view) return null;                      // pending / missing: render nothing

  const eyebrow = (
    <div className="dly-eyebrow">
      <span className="dly-sq" aria-hidden="true" />
      <span className="dly-kick">Today&rsquo;s Board</span>
      {view.edition && <span className="dly-ed">Edition No. {view.edition}</span>}
    </div>
  );

  // ---- 1. NOT PLAYED -------------------------------------------------------
  if (view.state === 'play') {
    const href = signedIn ? '/daily' : shellSigninHref('/daily', isShell);
    return (
      <section className="dly" data-surface="ink" data-state="play">
        {eyebrow}
        <h3 className="dly-hook">One board. Six slots. Three minutes.</h3>
        <p className="dly-sub">
          Sixty-four real performances from one real week of NFL history. Build the best
          six-man lineup you can before the clock runs out. Your worst pick is dropped.
        </p>
        <a className="dly-cta" href={href}>Play today&rsquo;s board</a>
        <div className="dly-foot">Closes midnight ET · One board a day · PPR, drop worst</div>
      </section>
    );
  }

  // ---- 2. THE RECEIPT ------------------------------------------------------
  if (view.state === 'receipt') {
    return (
      <section className="dly" data-surface="ink" data-state="receipt">
        {eyebrow}
        <div className="dly-rcpt">
          <div className="dly-score">{view.score}</div>
          <div className="dly-of">your score</div>
          {view.band && <div className="dly-bandwrap"><span className="dly-chip">{view.band}</span></div>}
        </div>
        <div className="dly-meta">
          {view.guessSeason != null && (
            <><span className="k">You guessed</span> {view.guessSeason} · Wk {view.guessWeek}</>
          )}
          {view.entrants != null && (
            <><span className="k dly-meta-gap">Entries today</span> {view.entrants}</>
          )}
        </div>
        <div className="dly-rule" />
        <div className="dly-foot">The answer and the perfect lineup unlock at midnight ET</div>
      </section>
    );
  }

  // ---- 3. REVEALED ---------------------------------------------------------
  // NO BUTTON. There is nothing to play until midnight, and a dead call to
  // action at the top of the homepage is worse than none. One link out.
  const pctWidth = Math.max(0, Math.min(100, Number(view.pct ?? 0)));
  return (
    <section className="dly" data-surface="ink" data-state="revealed">
      {eyebrow}
      <div className="dly-ans">
        <span className="dly-yr">{view.season}</span>
        <span className="dly-wk">Week {view.week}</span>
        {view.tier && <span className="dly-chip dly-chip--tier">{view.tier}</span>}
      </div>

      {view.played ? (
        <>
          <div className="dly-vs">
            <div className="dly-cell"><div className="n">{view.score}</div><div className="k">your score</div></div>
            <div className="dly-cell dly-cell--dim"><div className="n">{view.perfect}</div><div className="k">perfect lineup</div></div>
            {view.pct != null && (
              <div className="dly-cell"><div className="n">{view.pct}%</div><div className="k">of perfect</div></div>
            )}
          </div>
          <div className="dly-bar"><i style={{ width: `${pctWidth}%` }} /></div>
          {view.guessed && view.seasonRight && (
            <div className="dly-meta">
              <span className="dly-chip dly-chip--quiet">
                {view.weekRight ? 'season and week right' : 'season right, week wrong'}
              </span>
            </div>
          )}
        </>
      ) : (
        <p className="dly-sub">
          Today&rsquo;s board is closed. The perfect lineup scored {view.perfect}.
        </p>
      )}

      <a className="dly-link" href={`/daily/${view.date}`}>
        See the perfect lineup and the whole board →
      </a>
    </section>
  );
}
