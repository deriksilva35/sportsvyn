// components/sim/YourDrafts.js - the "Your drafts" section.
//
// ONE COMPONENT, TWO HOMES. PROFILE carries all three buckets (the brief's
// "nothing reachable only by remembering a URL"); the Tracker tab passes
// `only="tracker"` so its own history sits under its own setup rather than
// making a reader cross to PROFILE to find last Tuesday's room.

import { draftDate, draftAction } from '@/lib/fantasy/yourDrafts';

function Rows({ rows }) {
  return rows.map((d) => (
    <a className="yd-row" key={d.id} href={d.href}>
      <span className="yd-main">
        <span className="yd-label">{d.label}</span>
        <span className="yd-meta">
          {d.seat != null && <>pick {d.seat} · </>}
          {d.picks} picks
          {draftDate(d.completedAt ?? d.startedAt) && <> · {draftDate(d.completedAt ?? d.startedAt)}</>}
        </span>
      </span>
      {d.grade && <span className="yd-grade">{d.grade}</span>}
      <span className="yd-act">{draftAction(d)} &rarr;</span>
    </a>
  ));
}

export default function YourDrafts({ split, only = null }) {
  const { open = [], tracker = [], done = [] } = split ?? {};
  const show = only === 'tracker' ? { open: [], tracker, done: [] } : { open, tracker, done };
  const total = show.open.length + show.tracker.length + show.done.length;

  if (total === 0) {
    // A HEADING OVER NOTHING IS WORSE THAN NO SECTION. It reads as a feature
    // that failed to load rather than one you have not used.
    return null;
  }

  return (
    <>
      {show.open.length > 0 && (
        <section className="acct-mod">
          <h2 className="acct-eyebrow">Unfinished mocks</h2>
          <Rows rows={show.open} />
        </section>
      )}
      {show.tracker.length > 0 && (
        <section className="acct-mod">
          <h2 className="acct-eyebrow">Tracked drafts</h2>
          <Rows rows={show.tracker} />
        </section>
      )}
      {show.done.length > 0 && (
        <section className="acct-mod">
          <h2 className="acct-eyebrow">Completed mocks</h2>
          <Rows rows={show.done} />
        </section>
      )}
    </>
  );
}
