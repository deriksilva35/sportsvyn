// lib/mlb/gameDetail.js - everything /mlb/game/[slug] reads. One query per
// thing it draws, and the shaping is pure.

import { sql } from '../db.js';
import { shortOf, finalShortOf, BASEBALL } from '../live/vocabulary.js';
import { newestScoringPlay } from './strip.js';
import { playsTab } from './playsTab.js';

/**
 * THE LINE SCORE GRID, padded to the innings actually played and NO FURTHER.
 * A home side that led after the top of the ninth did not bat, so its row is
 * one shorter - and padding it with a 0 invents an inning. The grid keeps the
 * ragged edge and renders a blank cell.
 */
export function lineScoreGrid(line) {
  if (!line?.home || !line?.away) return null;
  const n = Math.max(line.home.innings?.length ?? 0, line.away.innings?.length ?? 0);
  if (!n) return null;
  const row = (side) => ({
    innings: Array.from({ length: n }, (_, i) => side.innings?.[i] ?? null),
    runs: side.runs ?? null, hits: side.hits ?? null, errors: side.errors ?? null,
  });
  return { columns: Array.from({ length: n }, (_, i) => i + 1), home: row(line.home), away: row(line.away) };
}

/** Hitters and pitchers apart, because a box score prints them apart. */
export function splitBox(rows = []) {
  const hitters = []; const pitchers = [];
  for (const r of rows) {
    // A PITCHER IS A ROW THAT RECORDED AN OUT, not a row whose position says
    // "P": a position player who pitched the ninth of a blowout belongs in the
    // pitching table for that game, and a starter who was lifted before an out
    // still has a line.
    if (r.outs_recorded != null || r.batters_faced != null) pitchers.push(r);
    if (r.at_bats != null || r.plate_appearances != null) hitters.push(r);
  }
  return { hitters, pitchers };
}

export async function getMlbGame(slug) {
  const [m] = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.season_phase, l.slug AS league_slug,
           m.home_score, m.away_score, m.venue, m.metadata,
           h.id AS home_id, h.name AS home_name, h.short_name AS home_short, h.slug AS home_slug,
           h.abbreviation AS home_abbr, h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.id AS away_id, a.name AS away_name, a.short_name AS away_short, a.slug AS away_slug,
           a.abbreviation AS away_abbr, a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.slug = ${slug} LIMIT 1`;
  if (!m) return null;
  const live = m.metadata?.live_state ?? null;
  const plays = Array.isArray(m.metadata?.scoring_plays) ? m.metadata.scoring_plays : [];
  const box = await sql`
    SELECT * FROM mlb_player_game_stats WHERE match_id = ${m.id}
     ORDER BY team_id, player_name`.catch(() => []);
  return {
    id: m.id, slug: m.slug, status: m.status, kickoffAt: m.kickoff_at,
    // THE LEAGUE IS PART OF THE GAME, and three readers need it: gameUrlFor()
    // builds the Activity's deep link from it, stateFromMatch() picks the
    // BASEBALL branch off it, and the Alerts sheet words its close row by it.
    // Without it every one of them silently answered as football. READ OFF THE
    // LEAGUE ROW, like the gridiron loader's, never typed: the Live Activity
    // start message carries it as `league`.
    leagueSlug: m.league_slug,
    seasonYear: m.season_year, seasonPhase: m.season_phase, venue: m.venue,
    home: { id: m.home_id, name: m.home_name, shortName: m.home_short, slug: m.home_slug,
      abbreviation: m.home_abbr, colors: { primary: m.home_c1, secondary: m.home_c2 } },
    away: { id: m.away_id, name: m.away_name, shortName: m.away_short, slug: m.away_slug,
      abbreviation: m.away_abbr, colors: { primary: m.away_c1, secondary: m.away_c2 } },
    homeScore: m.home_score, awayScore: m.away_score,
    liveState: live,
    // THE CHIP IS THE SPORT'S. A nine-inning final says "Final"; a tenth says
    // "F/10", which is part of the result rather than decoration.
    chip: m.status === 'live' ? shortOf(live, BASEBALL)
      : m.status === 'final' ? finalShortOf(m.metadata?.line_score?.away?.innings?.length, BASEBALL)
        : null,
    lineScore: lineScoreGrid(m.metadata?.line_score ?? null),
    scoringPlays: plays,
    lastPlay: newestScoringPlay(plays),
    // PROBABLES ARE THE STATSAPI SEAM'S, and absent whenever it is off.
    probables: m.metadata?.probables ?? null,
    box: splitBox(box),
  };
}

/**
 * THE PLAYS TAB'S ROWS, read only when that tab is open.
 *
 * A NINE-INNING GAME IS 500+ ROWS and the other two tabs need none of them, so
 * this is its own reader rather than a fourth thing getMlbGame() always fetches.
 * The batter names come from the box score, which the page has already read for
 * the same match - `plays` carries the provider's id and no name, and a second
 * table of names would be a second answer to what a player is called.
 */
export async function getMlbPlays(matchId, box = []) {
  if (matchId == null) return [];
  const rows = await sql`
    SELECT provider_play_id, play_number, period, inning_type, play_type, text,
           home_score, away_score, scoring, batter_id, pitch_type, pitch_velocity
      FROM plays WHERE match_id = ${matchId}
     ORDER BY play_number ASC`.catch(() => []);
  const names = new Map();
  for (const r of box) {
    if (r?.bdl_player_id != null && r?.player_name) names.set(String(r.bdl_player_id), r.player_name);
  }
  return playsTab(rows, names);
}
