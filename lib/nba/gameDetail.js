// lib/nba/gameDetail.js - the NBA game's reads (nba-card, thu-37): the row,
// the box (nba_player_game_stats), the plays (`plays`). Small, named, and each
// caught by its caller - a module whose read fails is a module not drawn.

import { sql } from '../db.js';
import { teamColors } from '../gridiron/readers.js';
import { QUIET_PLAY } from './card.js';

/** One NBA game by slug, in the shape the shared card reads (rowToGame's, plus detail). */
export async function getNbaGame(slug, { db = sql } = {}) {
  const [m] = await db`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, m.week,
           m.home_score, m.away_score, m.metadata,
           l.slug AS league_slug,
           h.id AS home_id, h.name AS home_name, h.short_name AS home_short, h.abbreviation AS home_abbr,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.id AS away_id, a.name AS away_name, a.short_name AS away_short, a.abbreviation AS away_abbr,
           a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.slug = ${slug} AND l.slug = 'nba'
     LIMIT 1`;
  if (!m) return null;
  const meta = m.metadata ?? {};
  const side = (p) => ({
    id: m[`${p}_id`], name: m[`${p}_name`], shortName: m[`${p}_short`] ?? null, short_name: m[`${p}_short`] ?? null,
    abbreviation: m[`${p}_abbr`], resolved: m[`${p}_id`] != null, colors: teamColors(m[`${p}_c1`], m[`${p}_c2`]),
  });
  return {
    id: m.id, slug: m.slug, leagueSlug: m.league_slug, status: m.status, kickoffAt: m.kickoff_at,
    seasonYear: m.season_year, seasonPhase: m.season_phase, week: m.week,
    homeScore: m.home_score, awayScore: m.away_score,
    liveState: meta.live_state ?? null,
    // THE NBA'S DETAIL, nested (lib/nba/detail.js): line_score, timeouts,
    // bonus, last_play, final_seen_at.
    detail: meta.detail && typeof meta.detail === 'object' ? meta.detail : {},
    // THE CLOSING LINE, if anything ever froze one (lib/winprob/live.js writes
    // it for football only today). Null for every NBA game now - and the card
    // then says nothing about a line.
    marketPrior: meta.market_prior ?? null,
    home: side('home'), away: side('away'),
  };
}

/** The box, every line of one game. */
export async function nbaBoxRows(matchId, { db = sql } = {}) {
  return db`
    SELECT team_id, player_name, position, seconds, dnp, pts, fgm, fga, fg3m, fg3a, ftm, fta,
           oreb, dreb, reb, ast, stl, blk, turnovers, pf, plus_minus
      FROM nba_player_game_stats WHERE match_id = ${matchId}`;
}

/** The lines the board's foot needs, for many games in one read. Map(match id -> rows). */
export async function nbaPerformerRows(ids, { db = sql } = {}) {
  if (!ids?.length) return new Map();
  const rows = await db`
    SELECT match_id, team_id, player_name, pts, reb, ast, dnp
      FROM nba_player_game_stats WHERE match_id = ANY(${ids}) AND NOT dnp AND pts > 0`;
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.match_id)) out.set(r.match_id, []);
    out.get(r.match_id).push(r);
  }
  return out;
}

/**
 * THE PLAYS LIST: the latest `limit` (latest first) and the count - or every
 * play when `all`. Substitutions are not in either (card.js QUIET_PLAY): the
 * count is the plays a reader would scroll.
 */
export async function nbaPlays(matchId, { db = sql, limit = 5, all = false } = {}) {
  const quiet = QUIET_PLAY.source.replace(/^\^|\$$/g, '');
  const [rows, cnt] = await Promise.all([
    db`SELECT play_number, period, clock, play_type, text, home_score, away_score, scoring, offense_team_id
         FROM plays WHERE match_id = ${matchId} AND COALESCE(play_type, '') !~* ${`^${quiet}$`}
        ORDER BY play_number DESC NULLS LAST, id DESC
        LIMIT ${all ? 2000 : limit}`,
    db`SELECT count(*)::int AS n FROM plays WHERE match_id = ${matchId} AND COALESCE(play_type, '') !~* ${`^${quiet}$`}`,
  ]);
  return {
    latest: rows.map((r) => ({
      playNumber: r.play_number, period: r.period, clock: r.clock, playType: r.play_type, text: r.text,
      homeScore: r.home_score, awayScore: r.away_score, scoring: r.scoring, offenseTeamId: r.offense_team_id,
    })),
    total: Number(cnt[0]?.n ?? 0),
  };
}
