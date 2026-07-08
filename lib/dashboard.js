// lib/dashboard.js
//
// Data layer for the /my route (My Sportsvyn). All functions take a
// followed-teams collection (Set or array) and short-circuit on empty
// input so the page can call them unconditionally without a guard.
//
// Read-only. Scoped to the fifa-wc-2026 league at launch; broader
// league support is a Phase 2 concern once the schema for follows
// supports league scoping.
//
// Shaping helpers (shapeFixture, shapeArticle) intentionally duplicate
// the read-time + kicker logic in lib/articles.js so this module stays
// self-contained. When the article reader and dashboard reader settle
// on identical shapes, the helpers can consolidate; until then,
// duplication is cheaper than coupling.

import { sql } from './db.js';
import { getGroupStandings } from './bracket.js';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';
const WORDS_PER_MIN = 250;
const CHARS_PER_WORD = 5;

function normalizeIds(followedTeamIds) {
  if (followedTeamIds == null) return [];
  if (Array.isArray(followedTeamIds)) return followedTeamIds;
  return Array.from(followedTeamIds);
}

function shapeFixture(r) {
  return {
    id: r.id,
    slug: r.slug,
    kickoff_at: r.kickoff_at,
    status: r.status,
    stage: r.stage,
    group_code: r.group_code,
    venue: r.venue,
    home_score: r.home_score,
    away_score: r.away_score,
    // Shootout tally; present on the recent-final query, null on scheduled rows
    // (and any non-shootout final). penSuffix() treats null as "no shootout".
    home_penalties: r.home_penalties ?? null,
    away_penalties: r.away_penalties ?? null,
    // Day-peak Watch Score; present only on the recent-final query (scheduled
    // fixtures have no ticks yet), null otherwise -- the panel omits it then.
    watch_score: r.watch_score ?? null,
    home: {
      id: r.home_id,
      name: r.home_name,
      slug: r.home_slug,
      abbreviation: r.home_abbr,
      flag_svg_path: r.home_flag,
    },
    away: {
      id: r.away_id,
      name: r.away_name,
      slug: r.away_slug,
      abbreviation: r.away_abbr,
      flag_svg_path: r.away_flag,
    },
  };
}

function deriveKicker(row) {
  if (row.type === 'preview' && row.score_type === 'watch') return 'Watch Score · Pre-match';
  if (row.type === 'preview') return 'Pre-match';
  if (row.type === 'recap')   return 'Match Recap';
  if (row.type === 'feature') return 'Feature';
  return String(row.type ?? 'Article');
}

function deriveReadTimeMin(bodyLen) {
  const words = Math.max(0, Number(bodyLen ?? 0)) / CHARS_PER_WORD;
  return Math.max(1, Math.round(words / WORDS_PER_MIN));
}

function shapeArticle(r) {
  return {
    slug: r.slug,
    match_slug: r.match_slug ?? null,
    home_team_id: r.home_team_id ?? null,
    away_team_id: r.away_team_id ?? null,
    home: { id: r.home_team_id ?? null, name: r.home_name ?? null, flag_svg_path: r.home_flag ?? null, flag_color_primary: r.home_flag_color ?? null },
    away: { id: r.away_team_id ?? null, name: r.away_name ?? null, flag_svg_path: r.away_flag ?? null, flag_color_primary: r.away_flag_color ?? null },
    title: r.title,
    subtitle: r.subtitle,
    kicker: deriveKicker(r),
    read_time_min: deriveReadTimeMin(r.body_len),
    published_at: r.published_at,
  };
}

// =============================================================================
// getFollowedFixtures(ids, { limit = 8 })
// Upcoming (scheduled or live) matches involving any followed team.
// Ordered by kickoff_at ascending. Empty array on empty input.
// =============================================================================
export async function getFollowedFixtures(followedTeamIds, { limit = 8 } = {}) {
  const ids = normalizeIds(followedTeamIds);
  if (ids.length === 0) return [];
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.status, m.stage, m.group_code, m.venue,
      m.home_score, m.away_score,
      h.id AS home_id, h.name AS home_name, h.slug AS home_slug,
      h.abbreviation AS home_abbr, h.flag_svg_path AS home_flag,
      a.id AS away_id, a.name AS away_name, a.slug AS away_slug,
      a.abbreviation AS away_abbr, a.flag_svg_path AS away_flag
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    JOIN leagues lg ON lg.id = m.league_id
    WHERE lg.slug = ${WC_LEAGUE_SLUG}
      AND m.status IN ('scheduled', 'live')
      AND (m.home_team_id = ANY(${ids}) OR m.away_team_id = ANY(${ids}))
    ORDER BY m.kickoff_at ASC
    LIMIT ${limit}
  `;
  return rows.map(shapeFixture);
}

// =============================================================================
// getTodayAndNext(ids)
// { recent, next } pair.
//   recent: the most recent final from today PT involving a followed team
//           (single shaped fixture or null)
//   next:   the next two scheduled fixtures involving a followed team
//
// Pulled in one round-trip alongside getFollowedFixtures so the page can
// pass next-2 to TodayNext and the remainder to Schedule without
// double-fetching.
// =============================================================================
export async function getTodayAndNext(followedTeamIds) {
  const ids = normalizeIds(followedTeamIds);
  if (ids.length === 0) return { recent: null, next: [] };

  const [recentRows, upcoming] = await Promise.all([
    sql`
      SELECT
        m.id, m.slug, m.kickoff_at, m.status, m.stage, m.group_code, m.venue,
        m.home_score, m.away_score,
        m.home_penalties, m.away_penalties,
        h.id AS home_id, h.name AS home_name, h.slug AS home_slug,
        h.abbreviation AS home_abbr, h.flag_svg_path AS home_flag,
        a.id AS away_id, a.name AS away_name, a.slug AS away_slug,
        a.abbreviation AS away_abbr, a.flag_svg_path AS away_flag,
        ws.composite::float AS watch_score
      FROM matches m
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
      JOIN leagues lg ON lg.id = m.league_id
      LEFT JOIN LATERAL (
        SELECT MAX(hh.composite_score)::float AS composite
          FROM match_watch_score_history hh
         WHERE hh.match_id = m.id
      ) ws ON true
      WHERE lg.slug = ${WC_LEAGUE_SLUG}
        AND m.status IN ('live', 'final')
        AND (m.home_team_id = ANY(${ids}) OR m.away_team_id = ANY(${ids}))
        AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date
            = (now() AT TIME ZONE 'America/Los_Angeles')::date
      ORDER BY (m.status = 'live') DESC, m.kickoff_at DESC
      LIMIT 1
    `,
    getFollowedFixtures(ids, { limit: 8 }),
  ]);

  const recent = recentRows.length ? shapeFixture(recentRows[0]) : null;
  const next = upcoming.filter((f) => f.status === 'scheduled').slice(0, 2);
  return { recent, next };
}

// =============================================================================
// getFollowedGroups(ids)
// The distinct WC group letters that contain at least one followed team,
// each mapped to its already-ordered standings (reuses getGroupStandings).
// Empty Map on empty input.
// =============================================================================
export async function getFollowedGroups(followedTeamIds) {
  const ids = normalizeIds(followedTeamIds);
  if (ids.length === 0) return new Map();
  const idSet = new Set(ids);
  const standings = await getGroupStandings();
  const result = new Map();
  for (const [letter, teams] of standings.entries()) {
    if (teams.some((t) => idSet.has(t.team_id))) {
      result.set(letter, teams);
    }
  }
  return result;
}

// =============================================================================
// getMentionedReads(ids, { limit = 5 })
// Published WC articles attached to a match whose home or away team is
// followed. Newest first by published_at. Shape mirrors getTodaysReads
// rows so renderers can swap between rails without prop-drilling
// different field names.
// =============================================================================
export async function getMentionedReads(followedTeamIds, { limit = 5 } = {}) {
  const ids = normalizeIds(followedTeamIds);
  if (ids.length === 0) return [];
  const rows = await sql`
    SELECT a.id, a.slug, a.title, a.subtitle, a.type, a.score_type,
           a.published_at, a.pinned_at, a.composite_score,
           coalesce(length(a.body), 0) AS body_len,
           m.slug AS match_slug,
           m.home_team_id, m.away_team_id,
           ht.name AS home_name, ht.flag_svg_path AS home_flag, ht.flag_color_primary AS home_flag_color,
           at.name AS away_name, at.flag_svg_path AS away_flag, at.flag_color_primary AS away_flag_color
      FROM articles a
      JOIN matches m ON m.id = a.match_id
      JOIN leagues lg ON lg.id = m.league_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE a.status = 'published'
       AND a.body IS NOT NULL
       AND lg.slug = ${WC_LEAGUE_SLUG}
       AND (m.home_team_id = ANY(${ids}) OR m.away_team_id = ANY(${ids}))
     ORDER BY a.published_at DESC NULLS LAST
     LIMIT ${limit}
  `;
  return rows.map(shapeArticle);
}

// =============================================================================
// getLiveNow(ids)
// Currently live matches involving a followed team. Returns the same
// shape as getFollowedFixtures rows.
// =============================================================================
export async function getLiveNow(followedTeamIds) {
  const ids = normalizeIds(followedTeamIds);
  if (ids.length === 0) return [];
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.status, m.stage, m.group_code, m.venue,
      m.home_score, m.away_score,
      h.id AS home_id, h.name AS home_name, h.slug AS home_slug,
      h.abbreviation AS home_abbr, h.flag_svg_path AS home_flag,
      a.id AS away_id, a.name AS away_name, a.slug AS away_slug,
      a.abbreviation AS away_abbr, a.flag_svg_path AS away_flag
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    JOIN leagues lg ON lg.id = m.league_id
    WHERE lg.slug = ${WC_LEAGUE_SLUG}
      AND m.status = 'live'
      AND (m.home_team_id = ANY(${ids}) OR m.away_team_id = ANY(${ids}))
    ORDER BY m.kickoff_at ASC
  `;
  return rows.map(shapeFixture);
}

// =============================================================================
// getFollowedPlayers(playerIds)
// Stat line for the Your Players panel: the player_match_stats aggregate
// (SUM goals/assists/minutes, COUNT appearances) joined to identity (name,
// slug, position, national-team abbr + flag), plus the current player-power
// edition rank/score. Ordered by MVP rank ASC (nulls last), then goals DESC.
// Empty array on empty input. The pms lateral and the ranking join both hit
// indexed columns (player_id).
// =============================================================================
export async function getFollowedPlayers(playerIds) {
  const ids = normalizeIds(playerIds);
  if (ids.length === 0) return [];
  const rows = await sql`
    SELECT
      p.id                              AS player_id,
      COALESCE(p.known_as, p.full_name) AS player_name,
      p.slug                            AS player_slug,
      p.position                        AS position,
      nt.abbreviation                   AS team_abbr,
      nt.flag_svg_path                  AS team_flag_svg_path,
      nt.flag_color_primary             AS team_flag_color_primary,
      COALESCE(agg.goals, 0)            AS goals,
      COALESCE(agg.assists, 0)          AS assists,
      COALESCE(agg.minutes, 0)          AS minutes,
      COALESCE(agg.apps, 0)             AS apps,
      re.rank                           AS mvp_rank,
      re.score::float                   AS mvp_score
    FROM players p
    LEFT JOIN teams nt ON nt.id = p.current_team_id
    LEFT JOIN LATERAL (
      SELECT sum(pms.goals)::int          AS goals,
             sum(pms.assists)::int        AS assists,
             sum(pms.minutes_played)::int AS minutes,
             count(*)::int                AS apps
        FROM player_match_stats pms
       WHERE pms.player_id = p.id
    ) agg ON true
    LEFT JOIN ranking_entries re
           ON re.player_id = p.id
          AND re.ranking_edition_id = (
            SELECT ed.id
              FROM ranking_editions ed
              JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
              JOIN leagues lg       ON lg.id = rl.league_id
             WHERE rl.slug = 'player-power'
               AND lg.slug = ${WC_LEAGUE_SLUG}
               AND ed.is_current = true
               AND ed.status = 'published'
             LIMIT 1
          )
    WHERE p.id = ANY(${ids})
    ORDER BY re.rank ASC NULLS LAST, COALESCE(agg.goals, 0) DESC
  `;
  return rows;
}
