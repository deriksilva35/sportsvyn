// lib/gridiron/regLines.js - THE PLAYER LINES PANEL FOR A REGULAR-SEASON GAME.
//
// THIS IS HOW THE PANEL WORKS. Not a bridge, not a fallback waiting for a
// provider to come back: the regular season is the season, and this module is
// the path its player lines take. lib/gridiron/gameDetail.js linesByGroup() is
// the LEGACY, PROVIDER-SHAPED case - it renders the 49 stored preseason games
// from gridiron_player_lines, a table nothing writes to any more.
//
// WHY THE SPLIT EXISTS AT ALL. The two phases arrived from two providers and
// two id namespaces, and the seam is in the match rows themselves:
//
//   NFL 2026 PRE  49 games   external_ids.apisports_game_id   (API-Sports)
//   NFL 2026 REG 272 games   external_ids.bdl_game_id         (balldontlie)
//
// fetchGameDetail() - the writer behind gridiron_player_lines - can only ask
// API-Sports, and a REG match carries no id it would recognise. So REG lines
// were never going to come from that table. They come from where the rest of
// the app already gets its football: nfl_player_game_stats, written per game,
// live and at final, by lib/gridiron/gameStatsSync.js off the live poller.
//
// NO NEW FETCH AND NO NEW TABLE. Every row this module reads is already being
// written while the game is on. The panel was dark because nothing read it.
//
// ONE SCORING MODULE, STILL. Points come from lib/fantasy/scoring.js by way of
// the same `parsed` shape the preseason path feeds it, so the FPTS column on a
// September Sunday and the FPTS column on an August Saturday are the same
// number computed by the same function. A second implementation here would be
// the one users actually see, which is the argument against having one.
//
// THE SHAPE PROBLEM, AND THE RULE THAT SOLVES IT. gridiron_player_lines is ONE
// ROW PER (player, stat_group) - the provider already decided that a man
// belongs in the passing table. nfl_player_game_stats is ONE WIDE ROW PER
// PLAYER carrying every column. So the groups have to be DERIVED, and the rule
// is stated once, in groupsForRow(), and pinned by tests:
//
//   passing    pass_att > 0            a man who threw
//   rushing    rush_att > 0            a man who carried
//   receiving  tgt > 0 OR rec > 0      a man who was thrown to
//   kicking    fga > 0 OR xp > 0       a man who kicked
//
// TARGETS COUNT, CATCHES ARE NOT REQUIRED. A receiver targeted four times who
// caught none belongs in the receiving table at 0 for 4; leaving him out would
// report the night as though nobody had thrown at him.
//
// A PLAYER CAN BE IN TWO TABLES and should be - a back with eleven carries and
// three catches is a rushing line and a receiving line, exactly as the provider
// would have sent him. A player with no offensive touches is in none.
//
// DEFENSIVE COLUMNS ARE NOT HERE, DELIBERATELY. sacks / def_int / fr / def_td
// sit on every player row in that table as the raw input to the DST
// aggregation; they are NOT that player's own fantasy stats, and
// lib/fantasy/playerStats.js:60 spells out the bug that reading them as such
// produces. So this path renders four groups, never a DEFENSE table. The
// preseason path still shows one, because API-Sports sent it as a real group.

import { sql } from '../db.js';
import { ABSENT } from './lineScore.js';
import { PRIMARY_GROUPS, pointsAllFormats, proseLine } from './gameDetail.js';

/** The four groups this path can derive, in the order the panel shows them. */
export const REG_GROUPS = Object.freeze(['passing', 'rushing', 'receiving', 'kicking']);

/** FPTS belongs where the number means something - the same three as preseason. */
const FPTS_GROUPS = new Set(['passing', 'rushing', 'receiving']);

const GROUP_LABELS = Object.freeze({
  passing: 'PASSING', rushing: 'RUSHING', receiving: 'RECEIVING', kicking: 'KICKING',
});

/**
 * The headings, matched to lib/gridiron/gameDetail.js GROUP_COLUMNS so a reader
 * moving between a preseason game and a regular-season one sees one table.
 *
 * RTG AND LONG ARE ABSENT RATHER THAN INVENTED. nfl_player_game_stats carries
 * no passer rating and no longest-rush/longest-reception column, and a computed
 * stand-in would be a number we made up sitting in a column the reader will
 * read as the provider's. fg_long IS stored, so KICKING's LONG is real.
 */
const GROUP_HEADINGS = Object.freeze({
  passing: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'RTG'],
  rushing: ['ATT', 'YDS', 'AVG', 'TD', 'LONG'],
  receiving: ['REC', 'YDS', 'AVG', 'TD', 'LONG'],
  kicking: ['FG', 'LONG', 'XP', 'PTS'],
});

const num = (v) => (v == null ? null : Number(v));
const pos = (v) => Number(v ?? 0) > 0;

/** yards per attempt, one decimal. Never a divide by zero, never "NaN". */
function avg(yds, att) {
  const y = num(yds); const a = num(att);
  if (y == null || !a) return ABSENT;
  return (Math.round((y / a) * 10) / 10).toFixed(1);
}

/**
 * WHICH TABLES ONE STAT ROW BELONGS IN. Pure, exported, and the single place
 * the rule lives - see the header for why each clause is what it is.
 * @returns {string[]} zero or more of REG_GROUPS, in panel order
 */
export function groupsForRow(r) {
  if (!r) return [];
  const out = [];
  if (pos(r.pass_att)) out.push('passing');
  if (pos(r.rush_att)) out.push('rushing');
  if (pos(r.tgt) || pos(r.rec)) out.push('receiving');
  if (pos(r.fga) || pos(r.xp)) out.push('kicking');
  return out;
}

/**
 * The cells for one row in one group, in GROUP_HEADINGS order.
 * A column we do not store renders ABSENT, the same mark the preseason path
 * uses for a stat the provider left out.
 */
export function cellsFor(group, r) {
  switch (group) {
    case 'passing':
      return [`${num(r.pass_cmp) ?? 0}/${num(r.pass_att) ?? 0}`,
        num(r.pass_yds) ?? 0, avg(r.pass_yds, r.pass_att),
        num(r.pass_td) ?? 0, num(r.pass_int) ?? 0, ABSENT];
    case 'rushing':
      return [num(r.rush_att) ?? 0, num(r.rush_yds) ?? 0, avg(r.rush_yds, r.rush_att),
        num(r.rush_td) ?? 0, ABSENT];
    case 'receiving':
      return [num(r.rec) ?? 0, num(r.rec_yds) ?? 0, avg(r.rec_yds, r.rec),
        num(r.rec_td) ?? 0, ABSENT];
    case 'kicking':
      return [`${num(r.fgm) ?? 0}/${num(r.fga) ?? 0}`, num(r.fg_long) ?? ABSENT,
        num(r.xp) ?? 0, ((num(r.fgm) ?? 0) * 3) + (num(r.xp) ?? 0)];
    default:
      return [];
  }
}

/**
 * The `parsed` object for ONE GROUP, in the key names lib/fantasy/scoring.js
 * and proseLine() read.
 *
 * SCOPED TO THE GROUP ON PURPOSE. The preseason path scores a rushing row from
 * a rushing-only `parsed`, because that is the row the provider sent; a back's
 * rushing table FPTS is his rushing points, not his night. This reproduces
 * that exactly. Fumbles are in no group's object for the same reason - the
 * preseason path keeps fumbles as its own group, which is not an FPTS group.
 */
export function parsedFor(group, r) {
  switch (group) {
    case 'passing':
      return { completions: num(r.pass_cmp), attempts: num(r.pass_att), passYds: num(r.pass_yds),
        passTd: num(r.pass_td), int: num(r.pass_int) };
    case 'rushing':
      return { rushAtt: num(r.rush_att), rushYds: num(r.rush_yds), rushTd: num(r.rush_td) };
    case 'receiving':
      return { rec: num(r.rec), recYds: num(r.rec_yds), recTd: num(r.rec_td) };
    default:
      return {};
  }
}

/**
 * A player's WHOLE offensive line, merged across groups - what the fantasy
 * leaders table ranks on. Kicking is excluded, matching the preseason path's
 * SCORED_GROUPS and the note printed under that table.
 */
export function leaderParsed(r) {
  return {
    ...parsedFor('passing', r), ...parsedFor('rushing', r), ...parsedFor('receiving', r),
    fumblesLost: num(r.fumbles_lost),
  };
}

/**
 * Rows for ONE TEAM as render-ready tables - the contract linesByGroup()
 * returns, field for field, so components/gridiron/GameTabs.js needs no branch.
 * @returns {Array<{group,label,primary,headings,showFpts,rows}>}
 */
export function tablesFromRows(rows) {
  const byGroup = new Map();
  for (const r of rows ?? []) {
    for (const g of groupsForRow(r)) {
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push({
        name: r.full_name,
        slug: r.slug ?? null,
        position: r.position ?? null,
        jersey: r.jersey_number ?? null,
        cells: cellsFor(g, r),
        pts: FPTS_GROUPS.has(g) ? pointsAllFormats(parsedFor(g, r)) : null,
      });
    }
  }

  return REG_GROUPS.filter((g) => byGroup.has(g)).map((group) => {
    const groupRows = byGroup.get(group);
    const showFpts = FPTS_GROUPS.has(group);
    // Same sort as the preseason path: points first where they exist, name as
    // the tiebreak so the order is stable between two identical lines.
    if (showFpts) {
      groupRows.sort((a, b) => b.pts.ppr - a.pts.ppr || a.name.localeCompare(b.name));
    }
    return {
      group,
      label: GROUP_LABELS[group],
      primary: PRIMARY_GROUPS.includes(group),
      headings: GROUP_HEADINGS[group],
      showFpts,
      rows: groupRows,
    };
  });
}

/**
 * THE FANTASY LEADERS across both squads, the same shape fantasyLeaders()
 * returns. A player appears once with their groups merged - a quarterback who
 * ran twice is one line worth passing plus rushing.
 */
export function leadersFromRows(rows, scoringFormat = 'ppr', limit = 5) {
  return (rows ?? [])
    .map((r) => {
      const parsed = leaderParsed(r);
      return { teamId: r.team_id, name: r.full_name, line: proseLine({ parsed }), pts: pointsAllFormats(parsed) };
    })
    // A kicker's line is empty prose, which is how kickers stay out of a
    // ranking whose scoring module prices field goals without distances.
    .filter((p) => p.line !== '')
    .sort((a, b) => b.pts[scoringFormat] - a.pts[scoringFormat] || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * ONE READ FOR THE WHOLE PANEL: both squads, both tables and the leaders.
 *
 * THE IDENTITY BRIDGE IS THE STATED ONE and it may not be shortened.
 * nfl_player_game_stats.nfl_player_id -> nfl_players.id, and a profile link
 * only through players.external_ids->>'bdl_player_id' == nfl_players.bdl_player_id
 * (lib/gridiron/playerStats.js:12). The two id spaces COLLIDE - joining
 * `players` directly on an nfl_player_id is what once put soccer players in
 * the NFL Week Leaders module - so the LEFT JOIN below is the only way a
 * /player/ link is allowed to be derived here.
 *
 * @returns {{tables: Map<number, Array>, rows: Array}} tables keyed by team id
 */
export async function regTeamTables(matchId) {
  if (matchId == null) return { tables: new Map(), rows: [] };
  const rows = await sql`
    SELECT g.team_id, np.full_name, np.position, np.jersey_number, pl.slug,
           g.pass_cmp, g.pass_att, g.pass_yds, g.pass_td, g.pass_int,
           g.rush_att, g.rush_yds, g.rush_td,
           g.tgt, g.rec, g.rec_yds, g.rec_td, g.fumbles_lost,
           g.fgm, g.fga, g.fg_long, g.xp
      FROM nfl_player_game_stats g
      JOIN nfl_players np ON np.id = g.nfl_player_id
      LEFT JOIN players pl ON pl.external_ids->>'bdl_player_id' = np.bdl_player_id::text
     WHERE g.match_id = ${matchId}
       AND np.is_team_defense IS NOT TRUE`;

  const tables = new Map();
  for (const r of rows) {
    if (r.team_id == null) continue;
    if (!tables.has(r.team_id)) tables.set(r.team_id, []);
    tables.get(r.team_id).push(r);
  }
  for (const [teamId, teamRows] of tables) tables.set(teamId, tablesFromRows(teamRows));
  return { tables, rows };
}
