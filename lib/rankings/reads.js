// lib/rankings/reads.js - everything the Rankings tab reads.
//
// WHAT THE RECON FOUND, AND WHAT THE RULINGS DID WITH IT:
//   ap_rankings carries points and first_place_votes, but only ONE poll week
//   exists, so movement, the NEW badge and the dropped-out line are CUT (R1).
//   teams.current_power_rank is empty in both leagues and nothing writes it;
//   the real rankings are ranking_lists -> ranking_editions -> ranking_entries.
//   nfl-power holds 32 scored teams with no previous_rank, so the NFL module
//   drops its movement column (R3). cfb-top25 holds 25 editorial rows, which
//   ship as OUR TOP 25 rather than as a 138-team power ranking (R2).
//
// THE POWER RANKINGS RELAY CHANGED THE GROUND UNDER R1-R3, and the rulings
// above are kept verbatim because they explain what the columns below are FOR.
// lib/rankings/publishGridironEdition.js now publishes a COMPUTED edition per
// league from an Elo ladder over every final PROD holds, so previous_rank,
// rank_movement, elo, ap_rank and the inputs blob all have writers. This query
// therefore selects them.
//
// MOVEMENT IS STILL CONDITIONAL, AND STILL GUARDED. The rule is no longer "no
// module renders a movement glyph" - it is "a movement glyph iff previous_rank
// is set on that row". Edition 1 of each board has no previous and every row
// is new, so the column is present and blank; edition 2 fills it. A test
// asserts exactly that, in both directions.

import { sql } from '../db.js';
import { getLeagueRecords } from '../standings/read.js';

const empty = (v) => (p) => Promise.resolve(p).catch(() => v);

/**
 * The current edition of a named ranking list, with its team rows.
 *
 * previous_rank AND rank_movement ARE BOTH SELECTED, and they are not the same
 * question: previous_rank says whether this team was ON the last edition (and
 * so whether a glyph may be drawn at all), rank_movement says which way it
 * went. A row with previous_rank 4 and rank_movement 0 HELD its place and must
 * render a hold, not a blank - which is indistinguishable from "new" if only
 * the movement is read.
 */
async function editionEntries(listSlug, { limit = null } = {}) {
  const rows = await sql`
    SELECT re.rank, re.score, re.team_id, re.selection_label,
           re.previous_rank, re.rank_movement, re.elo, re.ap_rank, re.inputs,
           t.slug, t.name, t.short_name, t.abbreviation,
           t.color_primary, t.color_secondary
      FROM ranking_lists rl
      JOIN ranking_editions rd ON rd.ranking_list_id = rl.id AND rd.is_current
      JOIN ranking_entries re ON re.ranking_edition_id = rd.id
      LEFT JOIN teams t ON t.id = re.team_id
     WHERE rl.slug = ${listSlug} AND rl.is_active
     ORDER BY re.rank ASC
     -- THE LIMIT IS IN THE QUERY NOW, not in a slice afterwards. The CFB board
     -- is 138 rows and every one carries an inputs blob; the module that wants
     -- five was reading all 138 over the wire to throw 133 away.
     -- LIMIT NULL IS POSTGRES FOR "NO LIMIT" - verified against this driver
     -- rather than assumed - so the caller that wants the whole field passes
     -- no limit and gets it, through the same query and with no branch.
     LIMIT ${limit}`;
  const shaped = rows.map((r) => ({
    rank: r.rank,
    score: r.score == null ? null : Number(r.score),
    teamId: r.team_id ?? null,
    name: r.short_name ?? r.name ?? r.selection_label ?? null,
    fullName: r.name ?? r.selection_label ?? null,
    abbreviation: r.abbreviation ?? null,
    slug: r.slug ?? null,
    colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null },
    previousRank: r.previous_rank ?? null,
    rankMovement: r.rank_movement ?? null,
    elo: r.elo == null ? null : Number(r.elo),
    apRank: r.ap_rank ?? null,
    // AN EMPTY BLOB IS NULL TO A READER. migration 108 defaults inputs to
    // '{}' so no row is ever NULL; a hand-seeded row therefore arrives here as
    // an empty object, which must read as "no working recorded" rather than as
    // a panel with nothing in it.
    inputs: r.inputs && Object.keys(r.inputs).length ? r.inputs : null,
  }));
  return shaped;
}

/**
 * THE MODEL'S CASE: the highest team BY ELO that the editor's list left off.
 *
 * THE GATE HAS AN ARGUMENT AGAINST IT AND THIS IS IT. Ranks 1-25 belong to the
 * editor's twenty-five whatever the model thinks, so the team the model would
 * have put third and the editor did not list at all has nowhere to appear
 * above 26. Publishing its name and its rating under the board is how that
 * disagreement stays visible instead of being quietly resolved.
 *
 * BY ELO, NOT BY COMPOSITE, and that is deliberate: an unlisted team's
 * composite is its result dimension alone, so ordering by composite would be
 * ordering by a monotone function of the same Elo and printing the weaker
 * number. The Elo is the thing the case is actually made of.
 */
export async function modelCase(listSlug) {
  const [row] = await sql`
    SELECT re.elo, re.selection_label, t.short_name, t.name
      FROM ranking_lists rl
      JOIN ranking_editions rd ON rd.ranking_list_id = rl.id AND rd.is_current
      JOIN ranking_entries re ON re.ranking_edition_id = rd.id
      LEFT JOIN teams t ON t.id = re.team_id
     WHERE rl.slug = ${listSlug} AND rl.is_active
       AND re.editor_rank IS NULL AND re.elo IS NOT NULL
     ORDER BY re.elo DESC
     LIMIT 1`;
  if (!row) return null;
  return {
    name: row.short_name ?? row.name ?? row.selection_label ?? null,
    elo: Number(row.elo),
  };
}

/**
 * THE WHOLE FIELD, as a lookup, for the All-teams directory's left column.
 * Returns Map(teamId -> { rank, score, apRank }) off the current edition.
 * A team with no entry is simply absent - an unrated team shows a dash, the
 * same way an unranked one did before there was a power ranking to show.
 */
export async function powerRankByTeam(listSlug) {
  const rows = await sql`
    SELECT re.team_id, re.rank, re.score, re.ap_rank
      FROM ranking_lists rl
      JOIN ranking_editions rd ON rd.ranking_list_id = rl.id AND rd.is_current
      JOIN ranking_entries re ON re.ranking_edition_id = rd.id
     WHERE rl.slug = ${listSlug} AND rl.is_active AND re.team_id IS NOT NULL`;
  return new Map(rows.map((r) => [Number(r.team_id), {
    rank: r.rank, score: r.score == null ? null : Number(r.score), apRank: r.ap_rank ?? null,
  }]));
}

/** The AP poll's current week, and its 25 rows. */
export async function apTop25({ limit = 25 } = {}) {
  const [latest] = await sql`
    SELECT season, max(week) AS week FROM ap_rankings
     WHERE season_type = 'regular'
     GROUP BY season ORDER BY season DESC LIMIT 1`;
  if (!latest) return null;
  const rows = await sql`
    SELECT a.rank, a.points, a.first_place_votes, a.team_id,
           t.slug, t.name, t.short_name, t.abbreviation,
           t.color_primary, t.color_secondary
      FROM ap_rankings a
      LEFT JOIN teams t ON t.id = a.team_id
     WHERE a.season = ${latest.season} AND a.week = ${latest.week}
       AND a.season_type = 'regular'
     ORDER BY a.rank ASC`;
  if (!rows.length) return null;
  return {
    season: latest.season,
    week: latest.week,
    rows: rows.slice(0, limit).map((r) => ({
      rank: r.rank,
      points: r.points ?? null,
      firstPlaceVotes: r.first_place_votes ?? null,
      teamId: r.team_id ?? null,
      name: r.short_name ?? r.name ?? null,
      fullName: r.name ?? null,
      abbreviation: r.abbreviation ?? null,
      slug: r.slug ?? null,
      colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null },
    })),
  };
}

/** NFL power, from nfl-power's current edition. No movement column (R3). */
export const nflPower = (opts = {}) => editionEntries('nfl-power', opts);

/**
 * THE CFB POWER BOARD. Still the cfb-top25 list - the slug is the board's
 * identity and renaming it would orphan every edition already on it - but the
 * edition it serves is computed now, and it holds the whole FBS field rather
 * than 25 editorial picks. Callers asking for the module take limit 5; the
 * All-teams directory takes the lot through powerRankByTeam.
 */
export const ourTop25 = (opts = {}) => editionEntries('cfb-top25', opts);

/**
 * "AP n · we have them higher" - only at a gap of three or more, and only
 * when the AP actually ranks them. Pure so the threshold is testable.
 */
export const OUR_VS_AP_GAP = 3;
export function ourVsAp(ourRank, apRank, gap = OUR_VS_AP_GAP) {
  if (ourRank == null || apRank == null) return null;
  const d = apRank - ourRank;
  if (Math.abs(d) < gap) return null;
  return { apRank, higher: d > 0, text: `AP ${apRank} · we have them ${d > 0 ? 'higher' : 'lower'}` };
}

/**
 * A league's standings grouped for the teams view. CFB groups by conference
 * and shows CONF and OVR; the NFL groups by conference + division.
 */
export async function groupTable(leagueSlug, season, group, { defaultTeamId = null } = {}) {
  const rows = await getLeagueRecords(leagueSlug, season,
    leagueSlug === 'cfb' ? { classification: 'fbs' } : {}).catch(() => []);
  if (!rows.length) return null;
  const label = (r) => (leagueSlug === 'nfl'
    ? [r.conference, r.division].filter(Boolean).join(' ')
    : (r.conference ?? ''));
  // SIGNED OUT, THE DEFAULT IS THE BEST TEAM'S GROUP, not the first row of a
  // standings sort. CFB takes the AP number one's conference and the NFL
  // takes the power number one's division, so a stranger lands on the group
  // worth looking at rather than on whoever happens to sort first.
  const fromTop = defaultTeamId == null ? null
    : label(rows.find((r) => r.team_id === defaultTeamId) ?? {}) || null;
  const want = group ?? fromTop ?? label(rows[0]);
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const mine = rows.filter((r) => same(label(r), want));
  if (!mine.length) return null;
  return {
    group: label(mine[0]) || want,
    isCfb: leagueSlug === 'cfb',
    rows: mine.map((r) => ({
      teamId: r.team_id, name: r.short_name ?? r.name, abbreviation: r.abbreviation ?? null,
      slug: r.slug ?? null,
      colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null },
      overall: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`,
      conf: r.conf_wins == null ? null : `${r.conf_wins}-${r.conf_losses}${r.conf_ties ? `-${r.conf_ties}` : ''}`,
    })),
    groups: [...new Set(rows.map(label).filter(Boolean))],
  };
}

// ---------------------------------------------------------------- players

const NFL_STATS = Object.freeze({
  pass: { col: 'pass_yds', label: 'Pass yds' },
  rush: { col: 'rush_yds', label: 'Rush yds' },
  rec: { col: 'rec_yds', label: 'Rec yds' },
  // THE TOGGLE'S TD IS EVERY TD a player accounted for, quarterbacks
  // included - it is a "who scored the most" list.
  td: { col: '(coalesce(g.pass_td,0) + coalesce(g.rush_td,0) + coalesce(g.rec_td,0))', label: 'TD', raw: true },
  // THE CFB MODULE'S TD IS THE BALL CARRIER'S (R5): rush + rec, no passing.
  // A quarterback throwing eleven is not the same list as a back scoring six,
  // and mixing them buries every runner behind every starting QB.
  scoretd: { col: '(coalesce(g.rush_td,0) + coalesce(g.rec_td,0))', label: 'TD', raw: true },
});
const CFB_STATS = NFL_STATS;
// The four the toggle offers. `scoretd` is the CFB module's own and is not
// one of them.
export const STAT_KEYS = Object.freeze(['pass', 'rush', 'rec', 'td']);
export const statLabel = (k) => NFL_STATS[k]?.label ?? k;

/**
 * SEASON LEADERS, and this reader is NEW - the recon found only
 * seasonTotals(bdlPlayerId), which is one player's own page.
 *
 * Measured on PROD: 305 ms for the NFL, 224 ms for CFB over 13,718 rows.
 * One stat at a time, because the toggle is a URL param and only one is on
 * screen; four ordered CTEs would read three columns nobody is looking at.
 *
 * THE TWO CODES KEY TO DIFFERENT IDENTITY TABLES - the same trap the Week
 * Leaders module fell into. cfb_player_game_stats.player_id -> players.id;
 * nfl_player_game_stats.nfl_player_id -> nfl_players.id, bridged to a profile
 * through external_ids->>'bdl_player_id'. Two explicit queries, no shared
 * template with an interpolated join.
 */
export async function seasonLeaders(leagueSlug, { season, stat = 'pass', limit = 5 } = {}) {
  const def = (leagueSlug === 'cfb' ? CFB_STATS : NFL_STATS)[stat];
  if (!def || season == null) return [];
  const expr = def.raw ? def.col : `g.${def.col}`;
  const q = leagueSlug === 'cfb'
    ? `SELECT p.full_name AS name, p.slug, count(*)::int AS games,
              SUM(${expr})::int AS value, t.abbreviation, t.name AS team_name,
              t.color_primary, t.color_secondary
         FROM cfb_player_game_stats g
         JOIN matches m ON m.id = g.match_id
         JOIN leagues l ON l.id = m.league_id AND l.slug = $1
         JOIN players p ON p.id = g.player_id
         LEFT JOIN teams t ON t.id = p.current_team_id
        WHERE m.season_year = $2 AND m.season_phase = 'REG'
        GROUP BY p.id, p.full_name, p.slug, t.abbreviation, t.name, t.color_primary, t.color_secondary
       HAVING SUM(${expr}) > 0
        ORDER BY value DESC LIMIT $3`
    : `SELECT np.full_name AS name, pl.slug, count(*)::int AS games,
              SUM(${expr})::int AS value, t.abbreviation, t.name AS team_name,
              t.color_primary, t.color_secondary
         FROM nfl_player_game_stats g
         JOIN matches m ON m.id = g.match_id
         JOIN leagues l ON l.id = m.league_id AND l.slug = $1
         JOIN nfl_players np ON np.id = g.nfl_player_id
         LEFT JOIN players pl ON pl.external_ids->>'bdl_player_id' = np.bdl_player_id::text
         LEFT JOIN teams t ON t.id = g.team_id
        WHERE m.season_year = $2 AND m.season_phase = 'REG'
        GROUP BY np.id, np.full_name, pl.slug, t.abbreviation, t.name, t.color_primary, t.color_secondary
       HAVING SUM(${expr}) > 0
        ORDER BY value DESC LIMIT $3`;
  const rows = await sql.query(q, [leagueSlug, season, limit]).catch(() => []);
  return rows.map((r) => ({
    name: r.name, slug: r.slug ?? null, games: r.games, value: Number(r.value),
    abbreviation: r.abbreviation ?? null, teamName: r.team_name ?? null,
    colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null },
  }));
}

/**
 * TD LEADERS for CFB (R5). Never called Golden Boot - that is a World Cup
 * trophy and this is a football touchdown count.
 */
export async function tdLeaders(leagueSlug, { season, limit = 3 } = {}) {
  return seasonLeaders(leagueSlug, { season, stat: 'scoretd', limit });
}
