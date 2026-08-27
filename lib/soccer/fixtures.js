// lib/soccer/fixtures.js - EPL results and fixtures for the Today band.
//
// THE DAY BOUNDARY IS EASTERN, STATED HERE ON PURPOSE. lib/scheduleData.js's
// readFixturesByPtDay windows in PACIFIC, because it serves the World Cup
// scrubber whose day-strings are built in PT. Every gridiron surface in this
// codebase - /scores, the pollers, the week resolver, getSlateByDate - measures
// a sports day in ET, and this band sits on a page whose other bands already
// do. Mixing the two on one screen is how a 10pm PT Saturday kickoff shows up
// under Sunday's heading for three hours.
//
// So: ET, matching getSlateByDate, and the band is honest about it.
//
// RESULTS LOOK BACK, FIXTURES LOOK FORWARD, and both are bounded by count
// rather than by a date range - a band shows a handful either way, and a range
// would render nothing at all in an international break.

import { sql } from '../db.js';
import { EPL_SLUG } from './epl.js';

const ET = 'America/New_York';

const SELECT = `
    m.id, m.slug, m.kickoff_at, m.status, m.home_score, m.away_score,
    to_char(m.kickoff_at AT TIME ZONE '${ET}', 'Dy')       AS et_weekday,
    to_char(m.kickoff_at AT TIME ZONE '${ET}', 'HH12:MIam') AS et_time,
    h.name AS home_name, h.short_name AS home_short, h.abbreviation AS home_abbr,
    a.name AS away_name, a.short_name AS away_short, a.abbreviation AS away_abbr`;

const FROM = `
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id`;

/**
 * The most recent finals and the next scheduled fixtures, newest-first for
 * results and soonest-first for fixtures, merged into one chronological list
 * the band renders top to bottom.
 */
export async function eplBandFixtures({ now = new Date(), back = 2, forward = 3 } = {}) {
  const iso = new Date(now).toISOString();
  const [recent, upcoming] = await Promise.all([
    sql.query(
      `SELECT ${SELECT} ${FROM}
        WHERE l.slug = $1 AND m.status = 'final' AND m.kickoff_at < $2
        ORDER BY m.kickoff_at DESC LIMIT $3`,
      [EPL_SLUG, iso, back],
    ),
    sql.query(
      `SELECT ${SELECT} ${FROM}
        WHERE l.slug = $1 AND m.status <> 'final' AND m.kickoff_at >= $2
        ORDER BY m.kickoff_at ASC LIMIT $3`,
      [EPL_SLUG, iso, forward],
    ),
  ]);
  // Results first, then what is coming - the order the mock reads in, and the
  // order a reader asks in.
  return [...recent, ...upcoming].map((r) => ({
    id: r.id,
    slug: r.slug,
    status: r.status,
    kickoffAt: r.kickoff_at,
    when: r.status === 'final' ? { day: r.et_weekday, time: 'Final' }
                               : { day: r.et_weekday, time: (r.et_time || '').toLowerCase() },
    home: r.home_short || r.home_name,
    away: r.away_short || r.away_name,
    homeScore: r.home_score,
    awayScore: r.away_score,
    isFinal: r.status === 'final',
  }));
}
