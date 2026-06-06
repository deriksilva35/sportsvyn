// lib/scheduleData.js — fixtures-table reader for /schedule.
//
// Generalized league + date-range reader. THIS ship is wired to
// league=international-friendlies; the same reader handles the WC slice
// by changing the leagueSlug arg — no rewrite. The page composes the
// view (lens, scrubber, filters) on top of these primitives.
//
// PT-day grouping is the load-bearing detail. Two seeded fixtures
// (Curaçao-Aruba, Argentina-Honduras) have 2026-06-07 slugs because
// their UTC kickoff is 00:00Z, but they're PT-June-6 evening games. If
// we grouped by slug-date they'd fall onto the wrong scrubber day and
// look missing. We compute `pt_day` server-side via Postgres timezone
// conversion (AT TIME ZONE 'America/Los_Angeles') and group on THAT,
// not the slug substring.

import { sql } from './db.js';

// Read scheduled / live / final / cancelled matches for one league
// within a PT calendar-day range. Inclusive on both ends:
//   ptStart = 'YYYY-MM-DD' (the earliest PT day to include)
//   ptEnd   = 'YYYY-MM-DD' (the latest PT day to include)
//
// Returns an array of fixture rows, each shaped:
//   {
//     id, slug, status, kickoff_at, stage, group_code,
//     home_score, away_score, pt_day (YYYY-MM-DD),
//     home: { id, name, abbreviation, flag_svg_path, flag_color },
//     away: { id, name, abbreviation, flag_svg_path, flag_color },
//   }
//
// Goals are loaded separately by readScheduleGoals (one query, then
// grouped in JS) so this query stays one round-trip and the goals
// payload is only fetched for matches that actually have events.
export async function readFixturesByPtDay({ leagueSlug, ptStart, ptEnd }) {
  const rows = await sql`
    SELECT
      m.id,
      m.slug,
      m.status,
      m.kickoff_at,
      m.stage,
      m.group_code,
      m.home_score,
      m.away_score,
      to_char((m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS pt_day,
      h.id   AS home_id,
      h.name AS home_name,
      h.abbreviation AS home_abbreviation,
      h.flag_svg_path AS home_flag_svg,
      h.flag_color_primary AS home_flag_color,
      a.id   AS away_id,
      a.name AS away_name,
      a.abbreviation AS away_abbreviation,
      a.flag_svg_path AS away_flag_svg,
      a.flag_color_primary AS away_flag_color
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    WHERE l.slug = ${leagueSlug}
      AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date >= ${ptStart}::date
      AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date <= ${ptEnd}::date
    ORDER BY m.kickoff_at ASC, m.id ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    status: r.status,
    kickoff_at: r.kickoff_at,
    stage: r.stage,
    group_code: r.group_code,
    home_score: r.home_score,
    away_score: r.away_score,
    pt_day: r.pt_day,
    home: {
      id: r.home_id,
      name: r.home_name,
      abbreviation: r.home_abbreviation,
      flag_svg_path: r.home_flag_svg,
      flag_color: r.home_flag_color,
    },
    away: {
      id: r.away_id,
      name: r.away_name,
      abbreviation: r.away_abbreviation,
      flag_svg_path: r.away_flag_svg,
      flag_color: r.away_flag_color,
    },
  }));
}

// Pull goal events for a set of match ids, returns Map<match_id, {home, away}>
// where each side is an array of "Player MM'" strings ready to render.
// is_current=true so VAR-cancelled goals don't surface. Missed Penalty is
// excluded — it's a chance, not a scoring event. Own goals are credited
// to the SCORING team (team_side as stored — verified empirically; see
// lib/liveGloss.js scoreAt for the same discipline).
export async function readScheduleGoals(matchIds) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return new Map();
  }
  const rows = await sql`
    SELECT
      match_id, minute, minute_extra, team_side, player_name, detail
    FROM match_events
    WHERE match_id = ANY(${matchIds})
      AND is_current = true
      AND event_type = 'Goal'
      AND (detail IS NULL OR detail <> 'Missed Penalty')
    ORDER BY match_id, minute ASC, COALESCE(minute_extra, 0) ASC, id ASC
  `;
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.match_id)) out.set(r.match_id, { home: [], away: [] });
    const bucket = out.get(r.match_id);
    const minute = r.minute_extra
      ? `${r.minute}+${r.minute_extra}′`
      : `${r.minute}′`;
    const ownGoal = r.detail === 'Own Goal' ? ' (og)' : '';
    const line = `${r.player_name ?? '—'}${ownGoal} ${minute}`;
    (r.team_side === 'home' ? bucket.home : bucket.away).push(line);
  }
  return out;
}

// Helper: format a Date object to 'YYYY-MM-DD' in America/Los_Angeles.
// Server-side only — uses Intl.DateTimeFormat with en-CA which yields
// the ISO-shaped date string. Used to compute the 7-day scrubber window
// around "today PT" without hardcoding offsets.
export function toPtIsoDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Build the 7-day scrubber window centered on `centerPtDate`, returns
// [{ ptDate, weekday, day }] suitable for the date scrubber UI. Default:
// today PT in the center, with 3 days before and 3 after.
export function buildScrubberDays(centerPtDate, beforeDays = 3, afterDays = 3) {
  // Parse the PT date string as a LOCAL date (no TZ shift) so we can
  // add/subtract days arithmetically. We only use this for label
  // generation; comparisons against the DB go back through the
  // PT-string round-trip.
  const [y, m, d] = centerPtDate.split('-').map(Number);
  const center = new Date(Date.UTC(y, m - 1, d));
  const days = [];
  for (let i = -beforeDays; i <= afterDays; i++) {
    const d2 = new Date(center.getTime() + i * 86400000);
    const ptDate = `${d2.getUTCFullYear()}-${String(d2.getUTCMonth() + 1).padStart(2, '0')}-${String(d2.getUTCDate()).padStart(2, '0')}`;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d2.getUTCDay()];
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d2.getUTCMonth()];
    days.push({
      ptDate,
      weekday,
      label: `${month} ${d2.getUTCDate()}`,
      isCenter: i === 0,
    });
  }
  return days;
}
