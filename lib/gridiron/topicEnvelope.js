/**
 * lib/gridiron/topicEnvelope.js - the internal data envelope a topic draft gets
 * when the league is NFL or CFB.
 *
 * The soccer envelope in lib/topicDraft.js reads confederation, fifa_rank,
 * group_code, tournament_wins/draws/losses, tournament_goals_for/against, and
 * match_watch_score_history. Every one of those is NULL or empty for a gridiron
 * row - they are soccer columns on shared tables. Pointing the existing builders
 * at an NFL team would return a shape full of nulls, the model would have
 * nothing to ground on, and validateTopicDraft would fail the draft for a
 * grounding violation that was really a schema mismatch.
 *
 * So gridiron gets its own readers, here, next to the other gridiron readers.
 * The soccer path is untouched.
 *
 * WHAT GRIDIRON ACTUALLY HAS, and therefore what goes in the envelope:
 *   · teams: name, abbreviation, conference, division (season-accurate via
 *     team_season_membership, which is the source of truth - CFB realignment
 *     makes teams.current_* a denorm of the CURRENT season only)
 *   · matches: season_year + season_phase + week, scores, status
 *   · ranking_entries: the Edition 0 editorial boards, read through the same
 *     getEditorialBoard the league pages use
 *   · nfl_players + nfl_player_game_stats: NFL only
 *
 * WHAT IT DOES NOT HAVE, and is therefore absent rather than nulled:
 *   · Watch Scores. match_watch_score_history is soccer-only.
 *   · Editorial blurbs. Zero rows exist for any gridiron team.
 *   · College players. There is no CFB player table; a CFB prompt naming a
 *     player returns it unresolved so the editor sees the gap.
 *
 * SEASON SELECTION. Reads anchor to the most recent season that has actually
 * been PLAYED, not max(season_year). PROD carries a full 2026 schedule with
 * zero results; anchoring on it would produce an envelope of empty records
 * under a season label that has not started. A scheduled-only season is
 * reported separately as `upcoming_season` so the model can say a season is
 * about to begin without being handed 0-0 records to reason about.
 *
 * PRESEASON NEVER REACHES THE MODEL. matches.season_phase allows REG, PRE and
 * POST. Nothing in the database is PRE today - the ingest has only ever pulled
 * REG and POST, for any season - so every query here was written filtering on
 * season_year alone and was correct by accident. The day a preseason import
 * lands, that accident ends silently and in three places at once: a team's
 * record absorbs exhibition wins, a player's season line absorbs exhibition
 * snaps, and seasonAnchor decides a season has "started" on the strength of a
 * Hall of Fame game in early August.
 *
 * So the phase is filtered explicitly everywhere, and the two lists differ on
 * purpose:
 *
 *   SEASON_PHASES = REG + POST   records, game results, the anchor
 *   STAT_PHASE    = REG only     player stat lines
 *
 * The player rule matches lib/fantasy/playerStats.js, which pins REG for a
 * reason worth restating: including the postseason flatters exactly the players
 * whose teams went deep. Stafford is 4,707 yards and 46 touchdowns over 17
 * regular-season games, or 5,643 and 52 over 20 with the playoffs folded in.
 * One of those is a season; the other is a season plus a run.
 *
 * A team's record keeps POST because it is already reported as a distinct
 * count (postseason_games) rather than blended away. Neither list has ever
 * included PRE and neither should: an exhibition result is not a result.
 */

import { sql } from '../db.js';
import { getEditorialBoard } from './readers.js';
import { leagueConfig } from '../topicDraftLeagues.js';
import { COMPETITIVE_PHASES } from './ingest.js';

const RECENT_GAMES = 8;
const BOARD_DEPTH = 10;

// Exported so the guard can be asserted directly rather than by grepping SQL.
// The record list is the shared one from the ingest boundary - the same
// distinction the odds readers and the Today lede make, kept in one place.
export const SEASON_PHASES = COMPETITIVE_PHASES;
export const STAT_PHASE = 'REG';

/**
 * The most recent season with completed games, plus any season that is
 * scheduled but unplayed. Both can be null (a league with no data at all).
 */
export async function seasonAnchor(leagueSlug) {
  // Preseason is excluded from BOTH counts. A season has not started because a
  // Hall of Fame game was played in the first week of August, and a season that
  // is "upcoming" should be counted by its real schedule, not its exhibitions.
  const rows = await sql`
    SELECT m.season_year AS yr,
           count(*) FILTER (WHERE m.status = 'final')::int AS played,
           count(*)::int AS total
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${leagueSlug} AND m.season_year IS NOT NULL
       AND m.season_phase = ANY(${SEASON_PHASES}::text[])
     GROUP BY m.season_year
     ORDER BY m.season_year DESC`;
  const played = rows.find((r) => r.played > 0) ?? null;
  // "Upcoming" only counts when it is LATER than the season we are reporting on;
  // an older unplayed season is a data gap, not a season about to start.
  const upcoming = rows.find((r) => r.played === 0 && (!played || r.yr > played.yr)) ?? null;
  return {
    seasonYear: played?.yr ?? null,
    gamesPlayed: played?.played ?? 0,
    upcomingSeason: upcoming ? { season_year: upcoming.yr, games_scheduled: upcoming.total } : null,
  };
}

/**
 * Team names for the planner prompt. Full names only - the planner is asked to
 * name entities the way a reader writes them, and abbreviations invite it to
 * emit "KC" as an entity nobody can resolve.
 */
export async function gridironTeamList(leagueSlug) {
  return sql`
    SELECT t.name, t.slug FROM teams t
    JOIN leagues l ON l.id = t.league_id
    WHERE l.slug = ${leagueSlug}
    ORDER BY t.name`;
}

/**
 * Resolve planner entities against the CHOSEN league.
 *
 * The league filter is the whole point: without it "Washington" resolves to
 * whichever of the Commanders, the Huskies, or a soccer side happens to sort
 * first, and the envelope silently describes the wrong team.
 */
export async function resolveGridironEntities(leagueSlug, entities) {
  const cfg = leagueConfig(leagueSlug);
  const teams = await sql`
    SELECT t.id, t.name, t.slug, t.abbreviation FROM teams t
    JOIN leagues l ON l.id = t.league_id WHERE l.slug = ${leagueSlug}`;

  const resolved = [];
  const unresolved = [];
  for (const e of entities ?? []) {
    const name = (e.name ?? '').trim();
    if (!name) continue;

    if (e.kind === 'team') {
      const hit = matchTeam(teams, name);
      if (hit) resolved.push({ kind: 'team', name, id: hit.id, matched_name: hit.name, slug: hit.slug });
      else unresolved.push({ kind: 'team', name });
    } else if (e.kind === 'player') {
      if (!cfg.hasPlayers) {
        // CFB. Recorded as unresolved with the reason, so the draft carries the
        // gap visibly instead of the editor wondering why a named player never
        // appears in the envelope.
        unresolved.push({ kind: 'player', name, reason: 'no college player table' });
        continue;
      }
      const hit = await resolveNflPlayer(name);
      if (hit) resolved.push({ kind: 'player', name, id: hit.id, matched_name: hit.full_name, slug: null });
      else unresolved.push({ kind: 'player', name });
    } else {
      resolved.push({ kind: 'match', name });
    }
  }
  return { resolved, unresolved };
}

// Exact name, then slug, then containment in either direction. Exported so the
// ordering is testable without a database - "Los Angeles Rams" must not match
// "Los Angeles Chargers" merely because both contain "Los Angeles".
export function matchTeam(teams, name) {
  const lc = name.toLowerCase().trim();
  return teams.find((t) => t.name.toLowerCase() === lc || t.slug === lc)
    ?? teams.find((t) => t.abbreviation && t.abbreviation.toLowerCase() === lc)
    ?? teams.find((t) => t.name.toLowerCase().includes(lc) && lc.length >= 4)
    ?? null;
}

async function resolveNflPlayer(name) {
  const norm = name.toLowerCase().trim();
  const rows = await sql`
    SELECT id, full_name, normalized_name, position, team_id
      FROM nfl_players
     WHERE normalized_name = ${norm}
        OR full_name ILIKE ${'%' + name + '%'}
     LIMIT 12`;
  // Exact normalized match wins; otherwise the shortest containing name, which
  // prefers "Josh Allen" over "Joshua Allen-Richardson".
  return rows.find((r) => r.normalized_name === norm)
    ?? rows.sort((a, b) => a.full_name.length - b.full_name.length)[0]
    ?? null;
}

// ---------------------------------------------------------------------------
// Team envelope
// ---------------------------------------------------------------------------

export async function buildGridironTeamEnvelope(leagueSlug, teamId, anchor) {
  const rows = await sql`
    SELECT t.id, t.name, t.abbreviation, t.slug, t.current_conference, t.current_division
      FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE t.id = ${teamId} AND l.slug = ${leagueSlug}`;
  const team = rows[0];
  if (!team) return null;

  const { seasonYear } = anchor;

  // Season-accurate conference/division. team_season_membership is the source
  // of truth; teams.current_* is a denorm of the current season only, which is
  // wrong the moment we report on a prior season after realignment.
  const memb = seasonYear == null ? [] : await sql`
    SELECT tsm.conference, tsm.division FROM team_season_membership tsm
     JOIN leagues l ON l.id = tsm.league_id
     WHERE tsm.team_id = ${teamId} AND l.slug = ${leagueSlug} AND tsm.season_year = ${seasonYear}
     LIMIT 1`;

  const record = seasonYear == null ? null : (await sql`
    WITH sides AS (
      SELECT (m.home_score > m.away_score)::int w, (m.home_score < m.away_score)::int l,
             (m.home_score = m.away_score)::int t, m.season_phase
        FROM matches m JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
         AND m.season_phase = ANY(${SEASON_PHASES}::text[])
         AND m.status = 'final' AND m.home_team_id = ${teamId}
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      UNION ALL
      SELECT (m.away_score > m.home_score)::int, (m.away_score < m.home_score)::int,
             (m.away_score = m.home_score)::int, m.season_phase
        FROM matches m JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
         AND m.season_phase = ANY(${SEASON_PHASES}::text[])
         AND m.status = 'final' AND m.away_team_id = ${teamId}
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
    )
    SELECT sum(w)::int wins, sum(l)::int losses, sum(t)::int ties,
           count(*) FILTER (WHERE season_phase = 'POST')::int postseason_games
      FROM sides`)[0] ?? null;

  const games = seasonYear == null ? [] : await sql`
    SELECT m.season_phase, m.week, m.status,
           ht.abbreviation AS home, at.abbreviation AS away,
           m.home_score, m.away_score, (m.home_team_id = ${teamId}) AS at_home
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE l.slug = ${leagueSlug} AND m.season_year = ${seasonYear}
       AND m.season_phase = ANY(${SEASON_PHASES}::text[])
       AND (m.home_team_id = ${teamId} OR m.away_team_id = ${teamId})
       AND m.status = 'final'
     ORDER BY m.season_phase DESC, m.week DESC NULLS LAST, m.kickoff_at DESC
     LIMIT ${RECENT_GAMES}`;

  const placements = await boardPlacementsForTeam(leagueSlug, team.name);

  return {
    kind: 'team',
    name: team.name,
    abbreviation: team.abbreviation,
    season: seasonYear,
    profile: {
      conference: memb[0]?.conference ?? team.current_conference ?? null,
      division: memb[0]?.division ?? team.current_division ?? null,
    },
    // Named season_record, not tournament_record: there is no bracket here and
    // the model should not reach for one.
    season_record: record && (record.wins != null) ? {
      wins: record.wins, losses: record.losses, ties: record.ties,
      postseason_games: record.postseason_games,
    } : null,
    ranking_placements: placements,
    recent_games: games.map((g) => ({
      phase: g.season_phase, week: g.week,
      matchup: `${g.home} ${g.home_score}-${g.away_score} ${g.away}`,
      venue: g.at_home ? 'home' : 'away',
    })),
  };
}

// Where this team sits on each editorial board that names it. Boards store a
// selection_label, not a team_id, so the match is on the label - which is exact
// for the team boards (verified: 32/32 NFL, 25/25 CFB) and correctly finds
// nothing on the player boards.
async function boardPlacementsForTeam(leagueSlug, teamName) {
  const cfg = leagueConfig(leagueSlug);
  const out = [];
  for (const b of cfg.boards ?? []) {
    const board = await getEditorialBoard(b.list, leagueSlug);
    if (!board) continue;
    const hit = board.entries.find((e) => (e.label ?? '').toLowerCase() === teamName.toLowerCase());
    if (hit) out.push({ board: b.label, rank: hit.rank, of: board.entries.length, edition: board.editionNumber, band: hit.band ?? null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Player envelope (NFL only)
// ---------------------------------------------------------------------------

export async function buildGridironPlayerEnvelope(leagueSlug, playerId, anchor) {
  const cfg = leagueConfig(leagueSlug);
  if (!cfg.hasPlayers) return null;

  const rows = await sql`
    SELECT p.id, p.full_name, p.position, p.jersey_number, p.rookie_season, t.name AS team_name, t.abbreviation AS team_abbr
      FROM nfl_players p LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.id = ${playerId}`;
  const p = rows[0];
  if (!p) return null;

  const { seasonYear } = anchor;
  // REGULAR SEASON ONLY, on both queries, matching lib/fantasy/playerStats.js.
  // A stat line labelled with a season has to BE the season: the postseason
  // flatters whoever went deep, and the preseason counts snaps taken against
  // players who were cut in the same week.
  const totals = seasonYear == null ? null : (await sql`
    SELECT count(*)::int games,
           sum(s.pass_yds)::int pass_yds, sum(s.pass_td)::int pass_td, sum(s.pass_int)::int pass_int,
           sum(s.rush_yds)::int rush_yds, sum(s.rush_td)::int rush_td,
           sum(s.rec)::int rec, sum(s.rec_yds)::int rec_yds, sum(s.rec_td)::int rec_td,
           sum(s.sacks)::int sacks, sum(s.def_int)::int def_int
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id
     WHERE s.nfl_player_id = ${playerId} AND l.slug = ${leagueSlug}
       AND m.season_year = ${seasonYear} AND m.season_phase = ${STAT_PHASE}`)[0] ?? null;

  const recent = seasonYear == null ? [] : await sql`
    SELECT m.week, m.season_phase, ht.abbreviation AS home, at.abbreviation AS away,
           s.pass_yds, s.pass_td, s.rush_yds, s.rush_td, s.rec, s.rec_yds, s.rec_td
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE s.nfl_player_id = ${playerId} AND l.slug = ${leagueSlug}
       AND m.season_year = ${seasonYear} AND m.season_phase = ${STAT_PHASE}
     ORDER BY m.week DESC NULLS LAST
     LIMIT ${RECENT_GAMES}`;

  const placements = await boardPlacementsForPlayer(leagueSlug, p.full_name);

  return {
    kind: 'player',
    name: p.full_name,
    position: p.position,
    team: p.team_name,
    team_abbreviation: p.team_abbr,
    jersey: p.jersey_number,
    rookie_season: p.rookie_season,
    season: seasonYear,
    // Only the stat families this player actually accumulated. A wide receiver
    // handed `pass_yds: 0` invites a sentence about his passing.
    season_totals: totals && totals.games > 0 ? pruneZeroStats(totals) : null,
    ranking_placements: placements,
    recent_games: recent.map((g) => ({
      phase: g.season_phase, week: g.week, matchup: `${g.home} v ${g.away}`,
      ...pruneZeroStats({
        pass_yds: g.pass_yds, pass_td: g.pass_td, rush_yds: g.rush_yds,
        rush_td: g.rush_td, rec: g.rec, rec_yds: g.rec_yds, rec_td: g.rec_td,
      }),
    })),
  };
}

// Drop null and zero stat keys, keep `games`. Exported for the unit test: the
// pruning is the difference between an envelope a model can read and a wall of
// zeroes it will try to explain.
export function pruneZeroStats(row) {
  const out = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    if (k === 'games') { out[k] = v; continue; }
    if (v == null || v === 0) continue;
    out[k] = v;
  }
  return out;
}

async function boardPlacementsForPlayer(leagueSlug, fullName) {
  const cfg = leagueConfig(leagueSlug);
  const out = [];
  for (const b of cfg.boards ?? []) {
    const board = await getEditorialBoard(b.list, leagueSlug);
    if (!board) continue;
    const hit = board.entries.find((e) => (e.label ?? '').toLowerCase() === fullName.toLowerCase());
    if (hit) out.push({ board: b.label, rank: hit.rank, of: board.entries.length, edition: board.editionNumber, team_tag: hit.teamTag ?? null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// League-scope envelope (the "no named entity" fallback)
// ---------------------------------------------------------------------------

/**
 * The gridiron counterpart to buildTournamentEnvelope. Same contract: when the
 * planner resolves no team or player, the envelope must still be full, because
 * Sportsvyn does have league-wide data - the editorial boards and the completed
 * schedule. An empty envelope here is what makes a grounding failure look like a
 * model problem when it is a reader problem.
 */
export async function buildGridironLeagueEnvelope(leagueSlug, anchor) {
  const cfg = leagueConfig(leagueSlug);
  const { seasonYear, upcomingSeason } = anchor;

  const boards = [];
  for (const b of cfg.boards ?? []) {
    const board = await getEditorialBoard(b.list, leagueSlug);
    if (!board) continue;
    boards.push({
      board: b.label,
      edition: board.editionNumber,
      edition_label: board.editionLabel,
      entries: board.entries.slice(0, BOARD_DEPTH).map((e) => ({
        rank: e.rank, name: e.label, team_tag: e.teamTag ?? null, band: e.band ?? null,
      })),
    });
  }

  const recent = seasonYear == null ? [] : await sql`
    SELECT m.season_phase, m.week, m.home_score, m.away_score,
           ht.abbreviation AS home, at.abbreviation AS away
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE l.slug = ${leagueSlug} AND m.season_year = ${seasonYear} AND m.status = 'final'
       AND m.season_phase = ANY(${SEASON_PHASES}::text[])
     ORDER BY m.season_phase DESC, m.week DESC NULLS LAST, m.kickoff_at DESC
     LIMIT 12`;

  return {
    kind: 'league',
    league: cfg.label,
    season: seasonYear,
    upcoming_season: upcomingSeason,
    ranking_boards: boards,
    recent_games: recent.map((g) => ({
      phase: g.season_phase, week: g.week,
      matchup: `${g.home} ${g.home_score}-${g.away_score} ${g.away}`,
    })),
  };
}

/**
 * Assemble the whole gridiron envelope for a set of resolved entities. Mirrors
 * buildInternalEnvelope's contract exactly, including the fall back to a
 * league-scope envelope when nothing named resolved.
 */
export async function buildGridironEnvelope(leagueSlug, resolved) {
  const anchor = await seasonAnchor(leagueSlug);
  const out = [];
  for (const e of resolved) {
    if (e.kind === 'team' && e.id) {
      const t = await buildGridironTeamEnvelope(leagueSlug, e.id, anchor);
      if (t) out.push(t);
    } else if (e.kind === 'player' && e.id) {
      const p = await buildGridironPlayerEnvelope(leagueSlug, e.id, anchor);
      if (p) out.push(p);
    }
  }
  if (out.length === 0) {
    const l = await buildGridironLeagueEnvelope(leagueSlug, anchor);
    if (l) out.push(l);
  }
  return out;
}
