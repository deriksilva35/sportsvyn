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

export default function LeagueScores({ leagueSlug, label, games, records, cap = 6, initialTz = null }) {
  const { shown, total, overflow } = scoresSlice(games, cap);
  if (!shown.length) return null;
  const unit = leagueUnit(leagueSlug);
  return (
    <section className="lgsc" aria-label={`${label} scores`}>
      <div className="lgsc-h">
        {/* "TODAY" HAS TO BE TRUE, AND IT WAS NOT. The heading read the
            LEAGUE'S unit - CFB counts a day - while being handed the whole
            week's slate, so a CFB landing titled four days of football
            "Today". The unit is a statement about how a code's schedule is
            shaped; the heading is a statement about what is on this screen,
            and only the second one can honestly title it. moduleHeading
            degrades to "This week" the moment the games span more than one
            day, whatever the league's unit says. */}
        <h2>{moduleHeading(unit, shown)}</h2>
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
