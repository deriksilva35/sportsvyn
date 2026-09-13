// components/league/RankRail.js — the ranking rail, one component for both codes.
//
// LEAGUE-SHAPED BY DATA, NOT BY CODE. It is handed chips and a tail link and
// has no idea whether it is drawing the AP Top 25 or the Sportsvyn power
// rankings; the difference is which reader filled the array (lib/gridiron/
// leagueRail.js). That is what keeps a third code from becoming a branch here.
//
// NO CHIPS, NO RAIL. An empty rail is furniture announcing an absence - it
// takes a row of the screen to say nothing. The surface renders null instead.

import Link from 'next/link';

export default function RankRail({ chips, title, allHref, allLabel, followed = null }) {
  if (!chips?.length) return null;
  // THE TEAM ID WAS ALREADY ON THE CHIP and nothing read it - railChip() has
  // set it since the rail was written (lib/gridiron/leagueLanding.js). A
  // followed team is outlined in volt, per the mock; a signed-out reader is
  // handed an empty set and every chip draws plain.
  const mine = (id) => id != null && followed?.has?.(id) === true;
  return (
    <section className="lgr" aria-label={title}>
      <div className="lgr-h">{title}</div>
      <div className="lgr-scroll">
        {chips.map((c) => (
          <div className={`lgr-chip${mine(c.teamId) ? ' mine' : ''}`} key={`${c.rank}-${c.abbr}`} data-team-id={c.teamId ?? undefined}>
            <span className="lgr-rank">{c.rank}</span>
            <span className="lgr-abbr">{c.abbr}</span>
            {/* AN ARROW MEANS CHANGED. No prior ranking and a held rank both
                render nothing - see railMovement(). */}
            {c.movement ? (
              <span className={`lgr-mv ${c.movement}`} aria-hidden="true">
                {c.movement === 'up' ? '▲' : '▼'}
              </span>
            ) : null}
            {/* A chip may only claim knowledge: no record, no record slot. */}
            {c.record ? <span className="lgr-rec">{c.record}</span> : null}
          </div>
        ))}
        {allHref ? (
          <Link className="lgr-chip lgr-all" href={allHref}>{allLabel}</Link>
        ) : null}
      </div>
    </section>
  );
}
