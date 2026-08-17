// components/home/DraftModule.js - The Draft's doorway on the Daily Card.
//
// THE WEEKLY MODULE'S MARKUP, REUSED WHOLESALE - which is itself the Daily
// module's. Three games stacked on one card that styled themselves differently
// would read as three products, and they are one.
//
// `drafting` IS THE ONE STATE NEITHER SIBLING HAS, and it is the only one on
// this card that is genuinely urgent: a room is open, a clock is involved, and
// the reader is mid-session. It gets the primary; every other state here is a
// quiet link or nothing at all.

import { shellSigninHref } from '@/lib/shell/signinHref';

const ET = { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' };
const deadline = (iso) => {
  const d = new Date(iso ?? NaN);
  return Number.isFinite(d.getTime()) ? `${d.toLocaleString('en-US', ET)} ET` : 'first kickoff';
};

export default function DraftModule({ view, isShell = false, signedIn = false }) {
  if (!view) return null;

  const eyebrow = (
    <div className="dly-eyebrow">
      <span className="dly-sq" aria-hidden="true" />
      <span className="dly-kick">The Draft</span>
      {view.week != null && <span className="dly-ed">Week {view.week}</span>}
    </div>
  );

  if (view.state === 'rules') {
    const href = signedIn ? '/draft' : shellSigninHref('/draft', isShell);
    return (
      <section className="dly" data-surface="ink" data-state="play">
        {eyebrow}
        <h3 className="dly-hook">Eight rounds. No bench.</h3>
        <p className="dly-sub">
          Draft against the room on a 30-second clock, then best ball scores your best
          six automatically. Every pick counts &mdash; there is nowhere to hide a miss.
        </p>
        <a className="dly-cta" href={href}>Take a seat</a>
        <div className="dly-foot">
          Locks {deadline(view.locksAt)} · Results Tuesday morning · Best ball, PPR
        </div>
      </section>
    );
  }

  // THE ONLY URGENT STATE ON THIS CARD. A room is open and a clock is involved.
  if (view.state === 'drafting') {
    return (
      <section className="dly" data-surface="ink" data-state="drafting">
        {eyebrow}
        <h3 className="dly-hook">You&rsquo;re on the clock.</h3>
        <p className="dly-sub">
          Your room is still open. It waits for you &mdash; the clock only runs while
          you are in it.
        </p>
        <a className="dly-cta" href={view.href}>Back to the room</a>
        <div className="dly-foot">Locks {deadline(view.locksAt)}</div>
      </section>
    );
  }

  if (view.state === 'waiting') {
    return (
      <section className="dly" data-surface="ink" data-state="waiting">
        {eyebrow}
        <div className="dly-rcpt">
          <div className="dly-score">{view.picks}</div>
          <div className="dly-of">picks in</div>
        </div>
        <p className="dly-sub">
          Drafted. Nothing else to do &mdash; best ball sets your lineup from what your
          players actually do.
        </p>
        <a className="dly-link" href={view.href}>See your draft &rarr;</a>
        <div className="dly-foot">Locks {deadline(view.locksAt)} · Results Tuesday morning</div>
      </section>
    );
  }

  if (view.state === 'locked') {
    return (
      <section className="dly" data-surface="ink" data-state="locked">
        {eyebrow}
        <h3 className="dly-hook">
          {view.entered ? 'Your roster is locked.' : 'This week has locked.'}
        </h3>
        <p className="dly-sub">
          {view.entered
            ? 'The games are under way. Best ball picks your six once the last one is final.'
            : 'You did not have a roster in for this one. The next rooms open Tuesday morning.'}
        </p>
        <a className="dly-link" href={view.href}>
          {view.entered ? 'See your roster →' : 'See the room →'}
        </a>
        <div className="dly-foot">Results Tuesday morning</div>
      </section>
    );
  }

  const pctWidth = Math.max(0, Math.min(100, Number(view.pct ?? 0)));
  return (
    <section className="dly" data-surface="ink" data-state="settled">
      {eyebrow}
      <div className="dly-ans"><span className="dly-yr">{view.season}</span>
        {view.tier && <span className="dly-chip dly-chip--tier">{view.tier}</span>}
      </div>
      {view.played ? (
        <>
          <div className="dly-vs">
            <div className="dly-cell"><div className="n">{view.score}</div><div className="k">best six</div></div>
            <div className="dly-cell dly-cell--dim"><div className="n">{view.perfect}</div><div className="k">perfect lineup</div></div>
            {view.pct != null && (
              <div className="dly-cell"><div className="n">{view.pct}%</div><div className="k">of perfect</div></div>
            )}
          </div>
          <div className="dly-bar"><i style={{ width: `${pctWidth}%` }} /></div>
        </>
      ) : (
        <p className="dly-sub">This week is final. The perfect lineup scored {view.perfect ?? '—'}.</p>
      )}
      <a className="dly-link" href={view.href}>See your draft and the perfect six &rarr;</a>
    </section>
  );
}
