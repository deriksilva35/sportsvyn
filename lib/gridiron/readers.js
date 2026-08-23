// lib/gridiron/readers.js — read-only DEV readers for the gridiron surfaces
// (/scores, /nfl, /cfb). Server-component readers, mirror lib/scheduleData.js:
// one round-trip per query, day grouping done in Postgres via AT TIME ZONE.
// Everything is league-scoped. NO writes.
//
// Football is Eastern-centric, so the slate "day" is an America/New_York
// calendar day (soccer uses PT; gridiron uses ET — the natural football day so
// a Sunday's 1pm-to-1am-ET slate lands together).

import { sql } from './../db.js';
import { COMPETITIVE_PHASES } from './ingest.js';

const ET = 'America/New_York';
const NFL = 'nfl';
const CFB = 'cfb';
// EPL joins the scoreboard as a THIRD league on the same shell (relay 2).
// Every filter below reads this list, so a league is added in one place.
const EPL = 'epl';

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
    liveState: meta.live_state ?? null,
    // Written by the API-Sports importer; absent on the BDL-sourced 2025 rows,
    // where the card simply shows less rather than showing a placeholder.
    weekLabel: meta.apisports_week_label ?? null,
    venue: meta.venue ?? null,
    venueCity: meta.venue_city ?? null,
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
     WHERE l.slug IN (${NFL}, ${CFB}, ${EPL})
       AND (m.kickoff_at AT TIME ZONE ${ET})::date = ${date}::date
     ORDER BY (m.status = 'live') DESC, m.kickoff_at ASC, m.id ASC`;
  const games = rows.map(rowToGame);
  return {
    date,
    byLeague: {
      nfl: games.filter((g) => g.leagueSlug === NFL),
      cfb: games.filter((g) => g.leagueSlug === CFB),
      epl: games.filter((g) => g.leagueSlug === EPL),
    },
  };
}

// ---------------------------------------------------------------------------
// (1b) resolveScoresDate — the DEFAULT /scores day (no ?date= param): today if it
//      has gridiron games, else the nearest day WITH games (forward-looking first,
//      then most recent). In-season this is today (or the next game day on a bare
//      off-day); in the offseason it lands on a real slate instead of an empty room.
// ---------------------------------------------------------------------------
// Pure picker (unit-tested): forward beats back, exact-today beats both, and an
// empty schedule falls back to today.
export function pickScoresDate({ exact, fwd, back }, today) {
  return exact ?? fwd ?? back ?? today;
}

/** Is any game on the ET date BEFORE `dateEt` still live? The sports-day
 * law's (a) clause - one indexed read, caught to false by the caller. */
export async function priorDateHasLive(dateEt) {
  const r = await sql`
    SELECT 1 FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug IN (${NFL}, ${CFB}, ${EPL}) AND m.status = 'live'
       AND (m.kickoff_at AT TIME ZONE ${ET})::date = ${dateEt}::date - 1
     LIMIT 1`;
  return r.length > 0;
}

export async function resolveScoresDate(todayEt) {
  const r = (await sql`
    WITH days AS (
      SELECT DISTINCT (m.kickoff_at AT TIME ZONE ${ET})::date AS d
        FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug IN (${NFL}, ${CFB}, ${EPL})
    )
    SELECT
      to_char((SELECT d FROM days WHERE d = ${todayEt}::date), 'YYYY-MM-DD') AS exact,
      to_char((SELECT min(d) FROM days WHERE d > ${todayEt}::date), 'YYYY-MM-DD') AS fwd,
      to_char((SELECT max(d) FROM days WHERE d < ${todayEt}::date), 'YYYY-MM-DD') AS back`)[0];
  return pickScoresDate(r ?? {}, todayEt);
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
// (3b) getNearestUpcomingWeek — the (phase, week) of the next scheduled kickoff
//      at or after now for a league/season. Lets the Today page pin to the season
//      opener during the offseason instead of the prior season's final slate.
//      Null when the season has no upcoming games (not yet loaded, or complete).
// ---------------------------------------------------------------------------
export async function getNearestUpcomingWeek(leagueSlug, seasonYear) {
  // REGULAR SEASON ONLY. This function's earlier comment predicted the opposite
  // and treated it as a feature: ordering by kickoff_at alone would let an
  // August game outrank September by date, and that was described as making
  // phase logic unnecessary. The prediction came true the moment the API-Sports
  // import landed 49 preseason games, and the result was wrong. The Today lede
  // is the page's answer to "when does football start", and football does not
  // start with an exhibition in which the starters play a quarter. The
  // countdown holds on Week 1 regardless of what is on in August.
  //
  // Preseason is NOT hidden - /scores lists it, badged. It just does not get to
  // move the season's own landmark.
  const rows = await sql`
    SELECT m.season_phase, m.week, m.kickoff_at
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
       AND m.season_phase = 'REG'
       AND m.status = 'scheduled' AND m.kickoff_at >= now()
     ORDER BY m.kickoff_at ASC, m.week ASC
     LIMIT 1`;
  if (!rows[0]) return null;
  return { seasonPhase: rows[0].season_phase, week: rows[0].week, kickoffAt: rows[0].kickoff_at };
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

// League id by slug — used by the Today page to fetch title-futures contenders.
export async function getLeagueIdBySlug(slug) {
  const r = await sql`SELECT id FROM leagues WHERE slug = ${slug} LIMIT 1`;
  return r[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// (6) getEditorialBoard — a hand-seeded Edition 0 board (Power Rankings, MVP,
//     Sportsvyn 25, Heisman). League-scoped via ranking_lists.league_id. Reads
//     name/read straight off the entry (no team/player row dependency).
// ---------------------------------------------------------------------------
export async function getEditorialBoard(listSlug, leagueSlug) {
  const rows = await sql`
    SELECT ed.edition_number, ed.edition_label, ed.notes AS footer,
           e.rank, e.selection_label AS label, e.team_tag, e.band, e.read
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id AND ed.is_current = true AND ed.status = 'published'
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      JOIN leagues lg ON lg.id = rl.league_id
     WHERE rl.slug = ${listSlug} AND lg.slug = ${leagueSlug}
     ORDER BY e.rank ASC`;
  if (!rows.length) return null;
  return {
    editionNumber: rows[0].edition_number,
    editionLabel: rows[0].edition_label,
    footer: rows[0].footer ?? null,
    entries: rows.map((r) => ({ rank: r.rank, label: r.label, teamTag: r.team_tag, band: r.band, read: r.read })),
  };
}

// ---------------------------------------------------------------------------
// (7) getMarketMovers — biggest de-vigged h2h implied-prob moves this cycle for a
//     league's scheduled games (real reads; empty until movement accrues, then
//     the Market Board renders live). One row per moved selection.
// ---------------------------------------------------------------------------
export async function getMarketMovers(leagueSlug, limit = 4) {
  const rows = await sql`
    SELECT o.selection_label, t.abbreviation AS abbr,
           o.implied_probability::float AS now_pct, o.previous_implied_prob::float AS prev_pct,
           o.movement_24h_prob::float AS mv
      FROM odds_markets o
      JOIN matches m ON m.id = o.match_id
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams t ON t.id = o.team_id
     WHERE l.slug = ${leagueSlug} AND o.market_scope = 'match' AND o.market_type = 'h2h'
       AND m.season_phase = ANY(${COMPETITIVE_PHASES}::text[])
       AND o.is_current = true AND m.status = 'scheduled'
       AND o.movement_24h_prob IS NOT NULL AND abs(o.movement_24h_prob) >= 0.5
     ORDER BY abs(o.movement_24h_prob) DESC, o.id ASC
     LIMIT ${limit}`;
  return rows.map((r) => ({
    label: r.abbr ?? r.selection_label,
    nowPct: r.now_pct == null ? null : Number(r.now_pct),
    prevPct: r.prev_pct == null ? null : Number(r.prev_pct),
    move: r.mv == null ? null : Number(r.mv),
  }));
}

// ---------------------------------------------------------------------------
// (8) getUpsetWatch — the underdog (lower de-vigged h2h prob) of each upcoming
//     game, ordered by dog prob DESC (the likeliest upsets). CFB rail. "Not a play".
// ---------------------------------------------------------------------------
export async function getUpsetWatch(leagueSlug, limit = 5) {
  const rows = await sql`
    WITH h2h AS (
      SELECT o.match_id, o.selection_label, o.team_id, o.implied_probability::float AS p
        FROM odds_markets o
        JOIN matches m ON m.id = o.match_id
        JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = ${leagueSlug} AND o.market_scope = 'match' AND o.market_type = 'h2h'
         AND m.season_phase = ANY(${COMPETITIVE_PHASES}::text[])
         AND o.is_current = true AND m.status = 'scheduled' AND m.kickoff_at >= now()
    ), dogs AS (
      SELECT DISTINCT ON (match_id) match_id, selection_label, team_id, p
        FROM h2h ORDER BY match_id, p ASC
    )
    SELECT d.selection_label, d.p, t.abbreviation AS abbr
      FROM dogs d LEFT JOIN teams t ON t.id = d.team_id
     ORDER BY d.p DESC LIMIT ${limit}`;
  return rows.map((r) => ({ label: r.abbr ?? r.selection_label, pct: Number(r.p) }));
}

/**
 * The slate's date extent - the date-jump input's min/max. One cheap
 * aggregate; a picker allowed to wander outside the season would offer
 * six empty Novembers of 2031.
 */
export async function scoresDateRange() {
  // CURRENT SEASON ONLY. matches also holds a decade of history (the Daily's
  // source seasons back to 2015) - a picker spanning that would offer ten
  // years of days this page has no business landing on. The season fact lives
  // on MATCHES for gridiron rows; the football leagues carry season_year NULL
  // (first draft filtered on l.season_year and returned an empty range).
  const r = (await sql`
    SELECT min(kickoff_at)::date AS lo, max(kickoff_at)::date AS hi
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.sport = 'football'
       AND m.season_year = (SELECT max(m2.season_year) FROM matches m2
                             JOIN leagues l2 ON l2.id = m2.league_id
                            WHERE l2.sport = 'football')`)[0] ?? {};
  const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);
  return { min: d(r.lo), max: d(r.hi) };
}
