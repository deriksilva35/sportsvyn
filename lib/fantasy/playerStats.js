// lib/fantasy/playerStats.js - the ONE interface the draft room reads player
// season stats through. Lives in lib/fantasy/ with the rest of the sim server
// code (drafts / engine / grade / ffc / readWriter).
//
// Backed by the gridiron session 2 layer (migration 049). Handoff:
// docs/gridiron/session-2-nfl-stats.md.
//
// ============================================================================
// JOIN PATH
// ============================================================================
//   sim_player_pool.matched_player_id -> nfl_players.id
//     · real player: nfl_player_game_stats WHERE nfl_player_id = <id>
//     · team defense (nfl_players.is_team_defense): no stat rows of its own.
//       BDL has no team-defense entity, so a DST's line is DERIVED by summing
//       its team's defensive player rows, grouped by game.
//
// ============================================================================
// THE FAN-OUT TRAP - DO NOT JOIN STATS THROUGH sim_player_pool
// ============================================================================
// sim_player_pool holds ONE ROW PER SNAPSHOT per player (4 today: ppr/12,
// half-ppr/10, standard/8, 2qb/12). Joining stats through pool rows fans out
// and multiplies every SUM by the snapshot count - silently, with no error and
// a plausible-looking result (Stafford reads 20,000 passing yards, or 4x the
// games he played). ALWAYS resolve the identity ONCE (DISTINCT ON) and then key
// stats on nfl_player_id / team_id. Pinned by a regression test.
//
// ============================================================================
// REGULAR SEASON ONLY
// ============================================================================
// Stat rows cover both phases (17,777 REG + 855 POST). Every read here filters
// matches.season_phase = 'REG': game logs, totals and PPG alike. A fantasy
// season IS the regular season, and mixing playoff games in would flatter
// exactly the players whose teams went deep. Stafford: 4,707 yds / 46 TD over
// 17 REG games, versus 5,643 / 52 over 20 if POST were included.
//
// NOTE: there is no xpAtt. BDL /nfl/v1/stats has no extra-point-attempts field
// and scoring.js consumes XP makes only. Do not look for an attempts column.

import { sql } from '../db.js';
import { seasonSummary } from './scoring.js';

const SEASON_YEAR = 2025;
const SEASON_PHASE = 'REG';

const num = (x) => (x == null ? null : Number(x));

// snake_case column -> camelCase contract key. The mapping the consumers
// (scoring.js, statView.js) depend on; see the handoff doc's column table.
// Values route through Number() because `sacks` is numeric in Postgres
// (half-sacks are real) and arrives as a string over the driver.
//
// DEFENSIVE COLUMNS ARE DELIBERATELY NOT EMITTED HERE. The stat table carries
// sacks / def_int / fr / def_td on EVERY player row, because they are the raw
// input to the DST aggregation. They are NOT that player's own fantasy stats:
// scoring.js scores `fr` as a DEFENSIVE fumble recovery worth +2, so mapping the
// column onto an offensive line pays a quarterback for recovering his OWN fumble
// (Stafford: fr = 3, a spurious +6 on the season). A fumble he recovers is
// already accounted for by fumbles_lost being 0 for that game. Defensive stats
// reach fantasy scoring through toDefenseLine on a DST identity, and only there.
export function toStatLine(r) {
  return {
    passCmp: num(r.pass_cmp), passAtt: num(r.pass_att), passYds: num(r.pass_yds),
    passTd: num(r.pass_td), int: num(r.pass_int),
    rushAtt: num(r.rush_att), rushYds: num(r.rush_yds), rushTd: num(r.rush_td),
    tgt: num(r.tgt), rec: num(r.rec), recYds: num(r.rec_yds), recTd: num(r.rec_td),
    fumblesLost: num(r.fumbles_lost),
    fgm: num(r.fgm), fga: num(r.fga), fgLong: num(r.fg_long), xp: num(r.xp),
  };
}

// A defense's line carries only what scoring.js scores for a DST. Deliberately
// NOT passed through toStatLine: a DST has no passing/rushing line, and emitting
// nulls for them would imply we looked and found nothing.
export function toDefenseLine(r) {
  return { sacks: num(r.sacks), defInt: num(r.def_int), fr: num(r.fr), defTd: num(r.def_td) };
}

// Opponent label from the player's team and the match. '@X' = away at X.
export function oppFor(teamId, m) {
  return Number(teamId) === Number(m.home_team_id) ? m.away_abbr : `@${m.home_abbr}`;
}

export function sumStats(games) {
  return games.reduce((acc, g) => {
    for (const [k, v] of Object.entries(g.stats)) {
      if (v == null) continue; // null = nothing recorded; never counts as a 0
      acc[k] = (acc[k] ?? 0) + Number(v);
    }
    return acc;
  }, {});
}

// Resolve ffcPlayerId -> identity, ONCE per player. DISTINCT ON collapses the
// snapshot fan-out described above. Verified in DEV: no ffc_player_id maps to
// more than one matched_player_id, so collapsing cannot lose information.
async function resolveIdentities(ffcPlayerIds) {
  const rows = await sql`
    SELECT DISTINCT ON (p.ffc_player_id)
           p.ffc_player_id, np.id AS nfl_player_id, np.position,
           np.is_team_defense, np.team_id
      FROM sim_player_pool p
      JOIN nfl_players np ON p.matched_player_id = np.id
     WHERE p.ffc_player_id = ANY(${ffcPlayerIds})
     ORDER BY p.ffc_player_id, p.id`;
  const out = new Map();
  for (const r of rows) out.set(String(r.ffc_player_id), r);
  return out;
}

/**
 * Season stats for one player of the sim's ADP pool, keyed by FFC player id.
 * @param {string} ffcPlayerId
 * @returns {Promise<null|object>} SeasonStats, or null when the player has no
 *   2025 regular-season line (unmatched, or matched-but-no-stats: 17 rookies /
 *   injured identities today). null means "unknown", NOT "zero" - the room
 *   renders an honest empty state rather than a line of noughts.
 */
export async function getPlayerSeasonStats(ffcPlayerId) {
  const id = String(ffcPlayerId);
  const ident = (await resolveIdentities([id])).get(id);
  if (!ident) return null;

  const games = ident.is_team_defense
    ? await defenseGames(ident.team_id)
    : await playerGames(ident.nfl_player_id);
  if (!games.length) return null;

  return {
    season: SEASON_YEAR,
    source: 'db',
    position: ident.position,
    games,
    totals: sumStats(games),
  };
}

async function playerGames(nflPlayerId) {
  const rows = await sql`
    SELECT m.week, m.home_team_id, s.team_id,
           ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
           s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td, s.pass_int,
           s.rush_att, s.rush_yds, s.rush_td,
           s.tgt, s.rec, s.rec_yds, s.rec_td, s.fumbles_lost,
           s.fgm, s.fga, s.fg_long, s.xp,
           s.sacks, s.def_int, s.fr, s.def_td
      FROM nfl_player_game_stats s
      JOIN matches m ON s.match_id = m.id
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at ON m.away_team_id = at.id
     WHERE s.nfl_player_id = ${nflPlayerId}
       AND m.season_phase = ${SEASON_PHASE} AND m.season_year = ${SEASON_YEAR}
     ORDER BY m.week`;
  return rows.map((r) => ({ week: r.week, opp: oppFor(r.team_id, r), stats: toStatLine(r) }));
}

// A DST's game log: its team's defensive production, summed per match.
async function defenseGames(teamId) {
  const rows = await sql`
    SELECT m.week, m.home_team_id,
           ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
           sum(s.sacks) AS sacks, sum(s.def_int) AS def_int,
           sum(s.fr) AS fr, sum(s.def_td) AS def_td
      FROM nfl_player_game_stats s
      JOIN matches m ON s.match_id = m.id
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at ON m.away_team_id = at.id
     WHERE s.team_id = ${teamId}
       AND m.season_phase = ${SEASON_PHASE} AND m.season_year = ${SEASON_YEAR}
     GROUP BY m.id, m.week, m.home_team_id, ht.abbreviation, at.abbreviation
     ORDER BY m.week`;
  return rows.map((r) => ({ week: r.week, opp: oppFor(teamId, r), stats: toDefenseLine(r) }));
}

/**
 * Season fantasy summaries for MANY players at once, for the collapsed rows'
 * quick stats. Batched on purpose: the room shows ~120 rows and one call per row
 * would be 120 round trips. Two queries total regardless of list size (one for
 * real players, one for defenses).
 *
 * A MISSING key means "unknown" and the room renders a dim placeholder. Players
 * with an identity but no 2025 REG line are deliberately omitted rather than
 * returned as zeros.
 *
 * Summaries go through the SAME seasonSummary() the expanded strip uses, so the
 * collapsed row's PPG and the strip's PER GAME can never disagree.
 *
 * @param {string[]} ffcPlayerIds
 * @param {string} scoringFormat  from the draft's config row (drives reception value)
 * @returns {Promise<Record<string, {points: number, ppg: number, games: number, totals: object}>>}
 */
export async function getPlayerSeasonSummaries(ffcPlayerIds, scoringFormat) {
  const ids = [...new Set((ffcPlayerIds ?? []).map(String))];
  if (!ids.length) return {};
  const idents = await resolveIdentities(ids);
  if (!idents.size) return {};

  const playerIds = [];
  const teamIds = [];
  for (const i of idents.values()) {
    if (i.is_team_defense) { if (i.team_id != null) teamIds.push(i.team_id); }
    else playerIds.push(i.nfl_player_id);
  }

  const [playerRows, defRows] = await Promise.all([
    playerIds.length ? sql`
      SELECT s.nfl_player_id,
             s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td, s.pass_int,
             s.rush_att, s.rush_yds, s.rush_td,
             s.tgt, s.rec, s.rec_yds, s.rec_td, s.fumbles_lost,
             s.fgm, s.fga, s.fg_long, s.xp,
             s.sacks, s.def_int, s.fr, s.def_td
        FROM nfl_player_game_stats s
        JOIN matches m ON s.match_id = m.id
       WHERE s.nfl_player_id = ANY(${playerIds})
         AND m.season_phase = ${SEASON_PHASE} AND m.season_year = ${SEASON_YEAR}` : [],
    teamIds.length ? sql`
      SELECT s.team_id, sum(s.sacks) AS sacks, sum(s.def_int) AS def_int,
             sum(s.fr) AS fr, sum(s.def_td) AS def_td
        FROM nfl_player_game_stats s
        JOIN matches m ON s.match_id = m.id
       WHERE s.team_id = ANY(${teamIds})
         AND m.season_phase = ${SEASON_PHASE} AND m.season_year = ${SEASON_YEAR}
       GROUP BY s.team_id, m.id` : [],
  ]);

  const byPlayer = new Map();
  for (const r of playerRows) {
    const k = String(r.nfl_player_id);
    if (!byPlayer.has(k)) byPlayer.set(k, []);
    byPlayer.get(k).push({ stats: toStatLine(r) });
  }
  const byTeam = new Map();
  for (const r of defRows) {
    const k = String(r.team_id);
    if (!byTeam.has(k)) byTeam.set(k, []);
    byTeam.get(k).push({ stats: toDefenseLine(r) });
  }

  const out = {};
  for (const [ffcId, i] of idents) {
    const games = i.is_team_defense
      ? (byTeam.get(String(i.team_id)) ?? [])
      : (byPlayer.get(String(i.nfl_player_id)) ?? []);
    if (!games.length) continue; // unknown, not zero
    out[ffcId] = { ...seasonSummary(games, scoringFormat), totals: sumStats(games) };
  }
  return out;
}
