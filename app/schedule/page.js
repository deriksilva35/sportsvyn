/**
 * /schedule — soccer-tuned scores + schedule page.
 *
 * Pointed at fifa-wc-2026. force-dynamic so DB changes (new fixtures,
 * status flips, goals) flow into the next request without rebuild.
 *
 * STEP 2.5 — loads the FULL tournament fixture set up front (it's tiny:
 * 72 group-stage rows over 18 days plus future knockouts). The client
 * scrubs over the loaded fixtures via a 7-day window with ‹ › arrows,
 * so paging through days is instant — no re-fetch on every arrow tap.
 *
 * WC tournament furniture (stage + group filters) render as inline
 * dropdowns next to the scrubber. Initial filter state hydrates from
 * ?stage and ?group; selection round-trips back to the URL.
 */

import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import {
  readFixturesByPtDay,
  readScheduleGoals,
  toPtIsoDate,
} from '@/lib/scheduleData';
import ScheduleClient from './ScheduleClient';

import './schedule.css';

export const metadata = {
  title: 'Scores & Schedule — Sportsvyn',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const LEAGUE_SLUG = 'fifa-wc-2026';

// Generous bounds — the actual WC range is Jun 11 → mid-July; we widen
// to a 3-day pre-buffer and through end-of-July to catch the final +
// any third-place fixture. The DB only returns rows that exist within
// the range, so the buffer is free.
const LOAD_RANGE_START = '2026-06-08';
const LOAD_RANGE_END   = '2026-07-31';

export default async function SchedulePage({ searchParams }) {
  // Next 16 hands searchParams as a Promise — await before reading.
  // ?stage and ?group hydrate the initial filter state on first paint
  // so URLs like /schedule?group=D land directly on the filtered view.
  const sp = (await searchParams) ?? {};
  const pickStr = (v) => (Array.isArray(v) ? v[0] : v) ?? null;
  const initialStageFilter  = pickStr(sp.stage)  ?? 'all';
  const initialGroupFilter  = pickStr(sp.group)  ?? 'all';
  const initialStatusFilter = pickStr(sp.status) ?? 'all';

  const todayPt = toPtIsoDate(new Date());

  const fixtures = await readFixturesByPtDay({
    leagueSlug: LEAGUE_SLUG,
    ptStart: LOAD_RANGE_START,
    ptEnd:   LOAD_RANGE_END,
  });
  const matchIds = fixtures.map((f) => f.id);
  const goalsByMatch = await readScheduleGoals(matchIds);

  const fixturesWithGoals = fixtures.map((f) => ({
    ...f,
    goals: goalsByMatch.get(f.id) ?? { home: [], away: [] },
  }));

  // Derive tournament bounds from the actual loaded fixtures so the
  // scrubber arrows disable at the correct edges. Falls back to the
  // load window when fixtures are empty (defensive — should never be
  // hit pre-launch since the DB is seeded).
  const ptDays = fixturesWithGoals.map((f) => f.pt_day).sort();
  const tournamentStart = ptDays[0] ?? LOAD_RANGE_START;
  const tournamentEnd   = ptDays[ptDays.length - 1] ?? LOAD_RANGE_END;

  return (
    <>
      <SiteHeaderServer activeNav="scores" />
      <main className="schedule-wrap">
        <ScheduleClient
          fixtures={fixturesWithGoals}
          defaultPtDay={todayPt}
          tournamentStart={tournamentStart}
          tournamentEnd={tournamentEnd}
          leagueSlug={LEAGUE_SLUG}
          showWcTournamentFurniture={true}
          initialStageFilter={initialStageFilter}
          initialGroupFilter={initialGroupFilter}
          initialStatusFilter={initialStatusFilter}
          kickerText="Read the Game"
          subheadText="48 nations · 12 groups · one tournament"
        />
      </main>
      <SiteFooter />
    </>
  );
}
