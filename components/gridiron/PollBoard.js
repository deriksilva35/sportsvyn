// components/gridiron/PollBoard.js - AP Top 25 / Coaches Poll, per the mock's
// .rrow grammar. A third BOARD KIND beside EditorialBoard and PlayoffPicture,
// not an extension of either: a poll is somebody else's published list, with
// points and first-place votes and no editorial read, and folding it into
// EditorialBoard would have meant a `band` that is always null and a `read`
// that never exists.

/**
 * TIES AND GAPS ARE RENDERED AS PUBLISHED. The 2026 week 1 AP poll ranks USC
 * and BYU joint 14th and has no 15th at all. Nothing here renumbers or
 * de-duplicates - two rows show #14 and the sequence jumps to #16, because
 * that is what the poll says.
 */
/**
 * SURFACE NOTE. The hub shell is data-surface="paper", which sets
 * `color: var(--ink)` - dark text for a light page. These rows paint a DARK
 * background, so the section MUST declare data-surface="ink" or every piece of
 * inherited text renders dark-on-dark and disappears. That is precisely what
 * shipped: team names were invisible while the points column survived, because
 * .pb-v sets its colour explicitly and .pb-t did not. EditorialBoard and
 * PlayoffPicture both declare their own surface; this was the one board that
 * forgot, and a dark background without the matching surface is the bug.
 */
export default function PollBoard({ poll }) {
  if (!poll?.rows?.length) {
    return (
      <div className="pb-empty" data-surface="ink">
        No {poll?.name ?? 'poll'} stored yet. It appears here once the week&rsquo;s poll is published.
      </div>
    );
  }
  return (
    /* data-surface="ink" IS LOAD-BEARING, not decoration - see the note above
       the component. */
    <section className="pb gi-instrument" aria-label={poll.name} data-surface="ink">
      <div className="pb-eyebrow">
        <span>{poll.name}</span>
        <span className="mono">Week {poll.week} · {poll.season} season</span>
      </div>

      {poll.rows.map((r) => (
        <div
          className={`pb-row${r.movement > 0 ? ' mover-up' : ''}${r.movement < 0 ? ' mover-down' : ''}`}
          key={`${r.rank}-${r.teamId}`}
        >
          <div className="pb-rn">{r.rank}</div>
          <div className="pb-nm">
            <div className="pb-t">{r.team}</div>
            <div className="pb-c">
              {/* Movement renders only when a prior week exists to diff
                  against. Week 1 shows nothing - not a zero, not a dash
                  standing in for "unchanged", because neither is true of a
                  first poll. */}
              {r.isNew ? <span className="pb-new">NEW</span> : null}
              {r.movement != null && r.movement !== 0 ? (
                <span className={r.movement > 0 ? 'pb-up' : 'pb-down'}>
                  {r.movement > 0 ? '▲' : '▼'}{Math.abs(r.movement)}
                </span>
              ) : null}
              {r.previousRank != null ? <span className="pb-prev">prev #{r.previousRank}</span> : null}
            </div>
          </div>
          <div className="pb-v">
            {r.points != null ? <>{r.points} pts</> : null}
            {r.firstPlaceVotes ? <><br /><b>{r.firstPlaceVotes}</b> 1st</> : null}
          </div>
        </div>
      ))}
    </section>
  );
}
