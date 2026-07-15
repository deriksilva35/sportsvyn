// lib/gridiron/readers.js — read-only DEV readers for the gridiron surfaces
// (/scores, /nfl, /cfb). Server-component readers, mirror lib/scheduleData.js:
// one round-trip per query, day grouping done in Postgres via AT TIME ZONE.
// Everything is league-scoped. NO writes.
//
// Football is Eastern-centric, so the slate "day" is an America/New_York
// calendar day (soccer uses PT; gridiron uses ET — the natural football day so
// a Sunday's 1pm-to-1am-ET slate lands together).

import { sql } from './../db.js';

const ET = 'America/New_York';
const NFL = 'nfl';
const CFB = 'cfb';

// Shared SELECT list + team joins. `m` = matches, `l` = leagues.
function rowToGame(r) {
  const meta = r.metadata ?? {};
  return {
    id: r.id,
    slug: r.slug,
    leagueSlug: r.league_slug,
    status: r.status,
    kickoffAt: r.kickoff_at,
    seasonYear: r.season_year,
    seasonPhase: r.season_phase,
    week: r.week,
    homeScore: r.home_score,
    awayScore: r.away_score,
    lineScores: meta.line_scores ?? null,
    home: {
      id: r.home_id, name: r.home_name, abbreviation: r.home_abbr,
      conference: r.home_conf, division: r.home_div, resolved: r.home_id != null,
    },
    away: {
      id: r.away_id, name: r.away_name, abbreviation: r.away_abbr,
      conference: r.away_conf, division: r.away_div, resolved: r.away_id != null,
    },
    // display day (ET weekday) for grouping
    etDay: r.et_day,
    etWeekday: r.et_weekday,
  };
}

// ---------------------------------------------------------------------------
// (1) getSlateByDate — every football match (nfl + cfb) on one ET calendar day,
//     ordered live-first then kickoff. Returns { date, byLeague: { nfl, cfb } }.
// ---------------------------------------------------------------------------
export async function getSlateByDate(date) {
  const rows = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, m.week,
           m.home_score, m.away_score, m.metadata,
           l.slug AS league_slug,
           to_char((m.kickoff_at AT TIME ZONE ${ET})::date, 'YYYY-MM-DD') AS et_day,
           to_char(m.kickoff_at AT TIME ZONE ${ET}, 'Dy') AS et_weekday,
           h.id AS home_id, h.name AS home_name, h.abbreviation AS home_abbr,
           h.current_conference AS home_conf, h.current_division AS home_div,
           a.id AS away_id, a.name AS away_name, a.abbreviation AS away_abbr,
           a.current_conference AS away_conf, a.current_division AS away_div
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE l.slug IN (${NFL}, ${CFB})
       AND (m.kickoff_at AT TIME ZONE ${ET})::date = ${date}::date
     ORDER BY (m.status = 'live') DESC, m.kickoff_at ASC, m.id ASC`;
  const games = rows.map(rowToGame);
  return {
    date,
    byLeague: {
      nfl: games.filter((g) => g.leagueSlug === NFL),
      cfb: games.filter((g) => g.leagueSlug === CFB),
    },
  };
}

// ---------------------------------------------------------------------------
// (2) getWeekSlate — one league's week, grouped by ET day (Thu/Sat/Sun/Mon).
// ---------------------------------------------------------------------------
export async function getWeekSlate(leagueSlug, seasonYear, seasonPhase, week) {
  const rows = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, m.week,
           m.home_score, m.away_score, m.metadata,
           l.slug AS league_slug,
           to_char((m.kickoff_at AT TIME ZONE ${ET})::date, 'YYYY-MM-DD') AS et_day,
           to_char(m.kickoff_at AT TIME ZONE ${ET}, 'Dy') AS et_weekday,
           h.id AS home_id, h.name AS home_name, h.abbreviation AS home_abbr,
           h.current_conference AS home_conf, h.current_division AS home_div,
           a.id AS away_id, a.name AS away_name, a.abbreviation AS away_abbr,
           a.current_conference AS away_conf, a.current_division AS away_div
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE l.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
       AND m.season_phase = ${seasonPhase} AND m.week = ${week}
     ORDER BY m.kickoff_at ASC, m.id ASC`;
  const games = rows.map(rowToGame);
  // Group by ET calendar day, preserving kickoff order.
  const byDay = [];
  const idx = new Map();
  for (const g of games) {
    if (!idx.has(g.etDay)) {
      idx.set(g.etDay, byDay.length);
      byDay.push({ etDay: g.etDay, weekday: g.etWeekday, games: [] });
    }
    byDay[idx.get(g.etDay)].games.push(g);
  }
  return { leagueSlug, seasonYear, seasonPhase, week, total: games.length, byDay };
}

// ---------------------------------------------------------------------------
// (3) getCurrentWeek — the current REGULAR-season week: the max REG week whose
//     games have started (kickoff <= now + 7d), clamped to the REG phase (the
//     playoffs are a separate view, so "current week" never jumps to a 1-game
//     Super Bowl slate). Against 2025 data in July 2026 this is the final REG
//     week — the shells demo on 2025 season state.
// ---------------------------------------------------------------------------
export async function getCurrentWeek(leagueSlug, seasonYear) {
  const rows = await sql`
    SELECT m.season_phase, m.week
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
       AND m.season_phase = 'REG'
       AND m.kickoff_at <= now() + interval '7 days'
     ORDER BY m.week DESC, m.kickoff_at DESC
     LIMIT 1`;
  if (!rows[0]) return null;
  return { seasonPhase: rows[0].season_phase, week: rows[0].week };
}

// ---------------------------------------------------------------------------
// (4) getSeasonState — sub-nav readout. Derives the league's latest season_year,
//     then the current phase/week. label e.g. "2025 SEASON · WEEK 18" (REG) or
//     "2025 POSTSEASON · RD 1" (POST).
// ---------------------------------------------------------------------------
export async function getSeasonState(leagueSlug) {
  const yr = (await sql`
    SELECT max(m.season_year) AS y
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${leagueSlug} AND m.season_year IS NOT NULL`)[0];
  const seasonYear = yr?.y ?? null;
  if (seasonYear == null) return null;
  const cur = await getCurrentWeek(leagueSlug, seasonYear);
  const phase = cur?.seasonPhase ?? 'REG';
  const week = cur?.week ?? null;
  const label = phase === 'POST'
    ? `${seasonYear} POSTSEASON · RD ${week}`
    : `${seasonYear} SEASON · WEEK ${week}`;
  return { seasonYear, phase, week, label };
}

// ---------------------------------------------------------------------------
// (5) getStandings — W-L per team from final results, grouped by
//     conference/division (season-accurate via team_season_membership). Used by
//     the /nfl (division) and /cfb (conference) standings rails.
// ---------------------------------------------------------------------------
export async function getStandings(leagueSlug, seasonYear, seasonPhase = 'REG') {
  const rows = await sql`
    WITH sides AS (
      SELECT m.home_team_id AS tid,
             (m.home_score > m.away_score)::int AS w,
             (m.home_score < m.away_score)::int AS l,
             (m.home_score = m.away_score)::int AS t
        FROM matches m JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
         AND m.season_phase = ${seasonPhase} AND m.status = 'final'
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      UNION ALL
      SELECT m.away_team_id,
             (m.away_score > m.home_score)::int,
             (m.away_score < m.home_score)::int,
             (m.away_score = m.home_score)::int
        FROM matches m JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
         AND m.season_phase = ${seasonPhase} AND m.status = 'final'
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
    )
    SELECT tm.id, tm.name, tm.abbreviation,
           tsm.conference, tsm.division,
           sum(s.w) AS wins, sum(s.l) AS losses, sum(s.t) AS ties
      FROM sides s
      JOIN teams tm ON tm.id = s.tid
      JOIN leagues lg2 ON lg2.id = tm.league_id AND lg2.slug = ${leagueSlug}
      JOIN team_season_membership tsm
        ON tsm.team_id = tm.id AND tsm.league_id = tm.league_id AND tsm.season_year = ${seasonYear}
     GROUP BY tm.id, tm.name, tm.abbreviation, tsm.conference, tsm.division
     ORDER BY tsm.conference NULLS LAST, tsm.division NULLS LAST, wins DESC, losses ASC, tm.name ASC`;
  // Group conference -> division -> teams[].
  const groups = [];
  const cidx = new Map();
  for (const r of rows) {
    const conf = r.conference ?? 'Independent';
    const div = r.division ?? '';
    if (!cidx.has(conf)) { cidx.set(conf, { conference: conf, divisions: [], _d: new Map() }); groups.push(cidx.get(conf)); }
    const cg = cidx.get(conf);
    if (!cg._d.has(div)) { cg._d.set(div, { division: div, teams: [] }); cg.divisions.push(cg._d.get(div)); }
    cg._d.get(div).teams.push({
      id: r.id, name: r.name, abbreviation: r.abbreviation,
      wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties),
    });
  }
  for (const g of groups) delete g._d;
  return groups;
}
