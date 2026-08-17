// components/home/WeeklyModule.js - the Weekly's doorway on the Daily Card.
//
// THE DAILY MODULE'S MARKUP, REUSED WHOLESALE. Every class below is
// components/home/DailyModule.js's - .dly, .dly-eyebrow, .dly-hook, .dly-cta,
// .dly-foot, .dly-vs, .dly-bar. Two modules stacked on one card that styled
// themselves differently would read as two products, and they are one.
//
// SERVER COMPONENT, NO CLOCK - and the argument is stronger here than on the
// Daily's module. The Daily declined a ticking clock because a static line says
// it as well; the Weekly's deadline is DAYS away, so a second-by-second
// countdown on the homepage would be an animation of nothing.

import { shellSigninHref } from '@/lib/shell/signinHref';

const ET = { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' };
const deadline = (iso) => {
  const d = new Date(iso ?? NaN);
  return Number.isFinite(d.getTime()) ? `${d.toLocaleString('en-US', ET)} ET` : 'first kickoff';
};

export default function WeeklyModule({ view, isShell = false, signedIn = false }) {
  if (!view) return null;                      // no board: render nothing

  const eyebrow = (
    <div className="dly-eyebrow">
      <span className="dly-sq" aria-hidden="true" />
      <span className="dly-kick">The Weekly</span>
      {view.week != null && <span className="dly-ed">Week {view.week}</span>}
    </div>
  );

  // ---- PLAY ----------------------------------------------------------------
  if (view.state === 'play') {
    const href = signedIn ? '/weekly' : shellSigninHref('/weekly', isShell);
    return (
      <section className="dly" data-surface="ink" data-state="play">
        {eyebrow}
        <h3 className="dly-hook">Six slots. No clock.</h3>
        <p className="dly-sub">
          One board of this week&rsquo;s actives, the same for everyone. Edit as often as
          you like until the first kickoff. Your worst pick is dropped.
        </p>
        <a className="dly-cta" href={href}>Build your lineup</a>
        <div className="dly-foot">
          Locks {deadline(view.locksAt)} · Results Tuesday morning · PPR, drop worst
        </div>
      </section>
    );
  }

  // ---- BUILDING ------------------------------------------------------------
  // THE UNFINISHED-WORK STATE, and the Daily has no counterpart. The number is
  // what is STILL EMPTY, because that is the only thing a reader can act on -
  // there is no score yet and there will not be one until Tuesday.
  if (view.state === 'building') {
    return (
      <section className="dly" data-surface="ink" data-state="building">
        {eyebrow}
        <div className="dly-rcpt">
          <div className="dly-score">{view.filled}<span className="dly-of-six">/6</span></div>
          <div className="dly-of">slots filled</div>
        </div>
        <p className="dly-sub">
          {view.remaining === 0
            ? 'Your six are in. Change them as often as you like until kickoff.'
            : `${view.remaining} still to fill. Every change saves as you make it.`}
        </p>
        <a className="dly-cta" href={view.href}>
          {view.remaining === 0 ? 'Review your lineup' : 'Finish your lineup'}
        </a>
        <div className="dly-foot">Locks {deadline(view.locksAt)} · Results Tuesday morning</div>
      </section>
    );
  }

  // ---- LOCKED --------------------------------------------------------------
  // NO BUTTON, for the same reason the Daily's revealed state has none: there
  // is nothing to do, and a dead call to action near the top of the homepage is
  // worse than no call to action. One link out.
  if (view.state === 'locked') {
    return (
      <section className="dly" data-surface="ink" data-state="locked">
        {eyebrow}
        <h3 className="dly-hook">
          {view.entered ? 'Your lineup is locked.' : 'This week has locked.'}
        </h3>
        <p className="dly-sub">
          {view.entered
            ? `${view.filled} of 6 slots are in and the games are under way. Scores settle once the last game is final.`
            : 'You did not have a lineup in for this one. The next board opens Tuesday morning.'}
        </p>
        <a className="dly-link" href={view.href}>
          {view.entered ? 'See your lineup →' : 'See this week’s board →'}
        </a>
        <div className="dly-foot">Results Tuesday morning</div>
      </section>
    );
  }

  // ---- SETTLED -------------------------------------------------------------
  const pctWidth = Math.max(0, Math.min(100, Number(view.pct ?? 0)));
  return (
    <section className="dly" data-surface="ink" data-state="settled">
      {eyebrow}
      {/* SEASON ONLY, NO WEEK. The Daily's revealed state prints both here
          because its eyebrow says "Edition No. 002" and the week IS the answer.
          The Weekly's eyebrow already says "Week 1", so repeating it two lines
          later rendered "Week 1 ... 2025 Week 1" - the same fact twice, which is
          how a reader learns to stop reading the eyebrow. The season is the only
          new information on this line. */}
      <div className="dly-ans">
        <span className="dly-yr">{view.season}</span>
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
        </>
      ) : (
        <p className="dly-sub">
          This week is final. The perfect lineup scored {view.perfect ?? '—'}.
        </p>
      )}

      <a className="dly-link" href={view.href}>See the perfect lineup and your six &rarr;</a>
    </section>
  );
}
