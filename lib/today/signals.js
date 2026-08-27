// lib/today/signals.js - the reads behind the band order.
//
// SPLIT FROM THE RANKING ON PURPOSE. rankLeagues() in ./leagues.js is pure and
// takes a list of signals; this file is the half that touches the database.
// Same discipline alertSummary got after a test that stubbed `sql` sent twenty
// real emails: the function that reaches out is never the unit you want to test
// ordering with.
//
// "IN GAME WEEK" IS NOT "THE CALENDAR WEEK TURNED", and CFB proves it this
// season: 2026 week 1 opens Saturday Aug 29 and does not finish until Monday
// Sep 7 - 99 games across ten days. A ranker keyed on "which calendar week is
// it" would drop CFB down the page on Sep 1 while week 1 was still being
// played. So the signals are about GAMES: is one on today, and how many days
// until the next one.

import { sql } from '../db.js';
import { LEAGUES, daysBetween } from './leagues.js';

// THIS IS NOT THE FORBIDDEN CONVERSION. The rule bans ad-hoc AT TIME ZONE for
// PROVIDER time - turning a provider's ET-local string into UTC, which belongs
// to easternLocalToUtc() alone. This is the opposite direction: a stored UTC
// timestamptz rendered to the ET calendar date a football day is measured in.
// It is the same expression getSlateByDate() already uses, deliberately, so the
// two agree on what "today's games" means.
const ET = 'America/New_York';

/** The ET day-string a football day is measured in, everywhere in this codebase. */
export function etDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * One row per league: does it play today, and when is its next game.
 *
 * ONE QUERY FOR EVERY LEAGUE, not one per league. Four round trips to answer
 * "who is playing" on a page that already makes ten reads is four too many,
 * and the shape is the same for all of them.
 *
 * `status` matters: a game that is final today still means the league PLAYED
 * today, which is what a reader means by "CFB is on". Only future kickoffs
 * count toward daysToNext.
 *
 * PRESEASON DOES NOT MOVE THE PAGE. Caught by running the ranker against real
 * dates: on Aug 26 it put NFL above CFB, because the NFL's next game is an
 * Aug 27 exhibition while CFB's opener is the 29th. getNearestUpcomingWeek
 * already refuses preseason for exactly this reason - "football does not start
 * with an exhibition in which the starters play a quarter" - and a ranker that
 * disagreed with the countdown would put a preseason game above a real opener
 * on the same page.
 *
 * IS DISTINCT FROM, not <>: EPL rows carry a NULL season_phase and `<> 'PRE'`
 * is NULL for them, which would silently drop every soccer fixture.
 * Preseason stays visible on /scores, badged; it just does not order Today.
 */
export async function gatherSignals({ now = new Date() } = {}) {
  const day = etDay(now);
  const slugs = LEAGUES.map((l) => l.slug);

  const rows = await sql`
    SELECT lg.slug AS league_slug,
           bool_or((m.kickoff_at AT TIME ZONE ${ET})::date = ${day}::date) AS plays_today,
           min(m.kickoff_at) FILTER (WHERE m.kickoff_at >= ${now.toISOString()}) AS next_ko,
           bool_or(m.kickoff_at >= ${now.toISOString()}) AS has_upcoming,
           -- IS A GAME ON RIGHT NOW? Feeds the live dot on the tuner chip. It
           -- rides the query that was already grouping per league rather than
           -- adding a second read for one boolean.
           bool_or(m.status = 'live') AS is_live,
           -- IS TODAY INSIDE SOME WEEK'S SPAN? CFB week 1 runs Aug 29 to Sep 7,
           -- so a league can be mid-week with its next game days away and still
           -- plainly be playing this week. One game before now and one after,
           -- within the same (season, phase, week), is exactly that.
           bool_or(m.week IS NOT NULL AND EXISTS (
             SELECT 1 FROM matches m2
              WHERE m2.league_id = m.league_id AND m2.season_year = m.season_year
                AND m2.season_phase IS NOT DISTINCT FROM m.season_phase
                AND m2.week = m.week
                AND m2.season_phase IS DISTINCT FROM 'PRE'
              HAVING min(m2.kickoff_at) <= ${now.toISOString()}
                 AND max(m2.kickoff_at) >= ${now.toISOString()}
           )) AS in_week_span
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = ANY(${slugs})
       AND m.season_phase IS DISTINCT FROM 'PRE'
     GROUP BY lg.slug`;

  const byLeagueSlug = new Map(rows.map((r) => [r.league_slug, r]));
  return LEAGUES.map((l) => {
    const r = byLeagueSlug.get(l.slug);
    const nextKo = r?.next_ko ?? null;
    return {
      id: l.id,
      playsToday: !!r?.plays_today,
      daysToNext: nextKo ? daysBetween(day, nextKo) : null,
      inSeason: !!r?.has_upcoming,
      inWeekSpan: !!r?.in_week_span,
      isLive: !!r?.is_live,
      nextKickoff: nextKo,
    };
  });
}
