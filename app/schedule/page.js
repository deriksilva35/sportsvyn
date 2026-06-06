/**
 * /schedule — soccer-tuned scores + schedule page.
 *
 * Implements the locked WC mock (Docs/sportsvyn-scores-worldcup-v1.html)
 * pointed at the international-friendlies league for THIS ship. Same
 * reader handles the WC slice — change leagueSlug, the rest of the
 * page composes from the fixtures-table reader.
 *
 * force-dynamic so DB changes (new fixtures, status flips, goals) flow
 * into the next request without rebuild. Same lesson as /bracket.
 *
 * Today + This Week are the live lenses. Following is the lens
 * scaffold for the WC slice (where "all USA matches" pays off against
 * seeded group games); on friendlies it shows an honest placeholder.
 *
 * Dormant WC furniture (stage filter, group chips A–L, standings) is
 * built into ScheduleClient but only renders when the page-level
 * showWcTournamentFurniture prop is true. Activating for the WC slice
 * is a one-line flip.
 */

import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import {
  readFixturesByPtDay,
  readScheduleGoals,
  toPtIsoDate,
  buildScrubberDays,
} from '@/lib/scheduleData';
import ScheduleClient from './ScheduleClient';

import './schedule.css';

export const metadata = {
  title: 'Scores & Schedule — Sportsvyn',
  robots: { index: false, follow: false },
};

// Same force-dynamic discipline as /bracket and /match/[slug]. Without
// this, the schedule prerenders at build time and stale fixtures + old
// statuses freeze in until the next deploy — exactly what bit /bracket
// before we added this export.
export const dynamic = 'force-dynamic';

const LEAGUE_SLUG = 'international-friendlies';

export default async function SchedulePage() {
  // "Today PT" derived server-side from the request moment. This is the
  // default scrubber center; the client may pick a different day from
  // the scrubber, but the server-rendered default is anchored here.
  const todayPt = toPtIsoDate(new Date());
  const scrubberDays = buildScrubberDays(todayPt, 3, 3);
  const ptStart = scrubberDays[0].ptDate;
  const ptEnd = scrubberDays[scrubberDays.length - 1].ptDate;

  // One round-trip for fixtures, one for goals on the visible match
  // set. Goals only populates for live/final matches that have events;
  // scheduled-only matches don't trigger a goals row.
  const fixtures = await readFixturesByPtDay({
    leagueSlug: LEAGUE_SLUG,
    ptStart,
    ptEnd,
  });
  const matchIds = fixtures.map((f) => f.id);
  const goalsByMatch = await readScheduleGoals(matchIds);

  // Attach goals + a render-ready clock label per fixture. The clock
  // text is the localized kickoff stub the card shows when there's no
  // live minute (the live minute itself comes from match data when we
  // wire poll-live's minute into the page; for now scheduled shows the
  // local time via KickoffTime client island, final shows "Full Time",
  // cancelled shows "Cancelled").
  const fixturesWithGoals = fixtures.map((f) => ({
    ...f,
    goals: goalsByMatch.get(f.id) ?? { home: [], away: [] },
  }));

  return (
    <>
      <SiteHeaderServer activeNav="scores" />
      <main className="schedule-wrap">
        <ScheduleClient
          fixtures={fixturesWithGoals}
          scrubberDays={scrubberDays}
          defaultPtDay={todayPt}
          leagueSlug={LEAGUE_SLUG}
          // Tournament furniture hidden for friendlies; flip to true on
          // the WC slice. The scaffold (stage chips, group A–L row,
          // standings table) is built but skipped at render-time here.
          showWcTournamentFurniture={false}
          // Stub header copy. The WC slice supplies its own (the
          // "48 nations. 12 groups." subhead from the mock).
          kickerText="Read the Game"
          subheadText={null}
        />
      </main>
      <SiteFooter />
    </>
  );
}
