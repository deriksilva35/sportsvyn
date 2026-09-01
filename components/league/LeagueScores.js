// components/league/LeagueScores.js — the scores module on a league landing.
//
// THE SAME CARD, NOT A SECOND ONE. This wraps the /scores v1.2 Scoreboard
// verbatim - records, network foot, LIVE pill, winner white and loser muted -
// filtered to one league and capped. A league landing that drew its own score
// card would be a second grammar for the same fact, and the two would drift the
// first time either was touched.
//
// LIVE FIRST, THEN UPCOMING, THEN FINAL - the reader's priority, not the
// clock's. A game in progress is why somebody opened this screen. See
// scoresSlice(); the ordering is decided there so it can be tested.
//
// THE UNIT IS THE LEAGUE'S. College counts a day and the NFL counts a week,
// because that is how each code's schedule is actually shaped, and the overflow
// link says so.

import Link from 'next/link';
import Scoreboard from '@/components/gridiron/Scoreboard';
import { scoresSlice, leagueUnit, moduleHeading } from '@/lib/gridiron/leagueLanding';

export default function LeagueScores({ leagueSlug, label, games, records, cap = 6, initialTz = null, now = new Date() }) {
  const { shown, total, overflow } = scoresSlice(games, cap);
  if (!shown.length) return null;
  const unit = leagueUnit(leagueSlug);
  return (
    <section className="lgsc" aria-label={`${label} scores`}>
      <div className="lgsc-h">
        {/* "TODAY" HAS TO BE TRUE, and it took two passes to make it so. It
            first read the LEAGUE'S unit - CFB counts a day - while being handed
            the whole week's slate, so a CFB landing titled four days of
            football "Today". Fixing that made the heading ask the GAMES, which
            was right and still not enough: one day on screen is not the same
            claim as today, and /cfb went on reading "Today" over six cards
            dated Thu Sep 3, on Sep 1. So the heading takes the CLOCK too, in
            the reader's own zone - Today, Tomorrow, the named day, or This
            week - and it is the same tz and the same day grammar the sticky
            headers below use, so the two cannot word a day differently. */}
        <h2>{moduleHeading(unit, shown, initialTz ?? undefined, now)}</h2>
        {overflow ? (
          <Link className="lgsc-all" href={`/${leagueSlug}/scores`}>
            All {total} games →
          </Link>
        ) : null}
      </div>
      {/* PINNED: this module is already one league by construction, so the
          ALL · NFL · CFB · EPL chips would be a way out of the page dressed as
          a filter. */}
      <Scoreboard
        byLeague={{ [leagueSlug]: shown }}
        sport={leagueSlug}
        records={records}
        pinned
        initialTz={initialTz}
      />
    </section>
  );
}
