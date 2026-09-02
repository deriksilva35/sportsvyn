// lib/fantasy/collegeStats.js — season summaries for the college half of the board.
//
// WHY THIS IS NOT playerStats.js. That module resolves identity through
// sim_player_pool.matched_player_id -> nfl_players, and a college player has no
// row there by design (nameMatch.js is scoped to league='nfl', because six
// college players and three school defenses matched NFL identities on name
// alone). College identity is a different join against a different roster:
// players.full_name + position -> cfb_player_game_stats.
//
// THE SCORING IS THE HOUSE SCORING, deliberately. seasonSummary/fantasyPoints
// from scoring.js, over a game log, so a college PPG and an NFL PPG are the
// same arithmetic on the same scale and a reader comparing them is comparing
// like with like. What differs is the SEASON, which is why every summary this
// module returns is stamped with one.
//
// COALESCE ON EVERY CATEGORY. CFB game rows leave inapplicable categories NULL
// rather than 0: of 63,257 rows in the 2025 season, `rec` is non-null on 13,899,
// rush_yds on 9,983, pass_yds on 2,914. A SQL SUM over those columns returns
// NULL for almost everyone - measured on a sample of nine, eight came back NULL
// and the ninth returned 12.1 points against a true 316.7, because he happened
// to have a carry, a catch AND a pass attempt. A wrong number that looks
// plausible is worse than no number.
//
// THIS MODULE SUMS IN JS, not in SQL, so scoring.js's n() would have coalesced
// anyway. The COALESCE is in the query regardless, because the aggregation could
// reasonably move into SQL one day and the NULLs would then be waiting - and
// because a reader comparing this to the incident should see the fix at the
// boundary where the incident happened. The test pins the query, not the hope.
//
// AN UNRESOLVED PLAYER GETS NO ENTRY, never a zero. The room renders nothing
// for a missing summary, which is the honest reading of "we could not find him"
// - and it is common: a Fantrax name of "Cook, Cameron" does not reach a CFBD
// roster that says "Cam Cook", and the two nearest candidates are at different
// schools, so bridging it would be a guess about whether they are the same man.

import { sql } from '../db.js';
import { seasonSummary } from './scoring.js';

// The most recent COMPLETE college season. 2026 has begun (one week loaded at
// the time of writing), and mixing a one-game 2026 average into a list beside
// full 2025 seasons would make the new week look like a collapse or a
// breakout for everyone at once. Bumped deliberately, the same way
// playerStats.js bumps SEASON_YEAR.
export const CFB_SEASON = 2025;

/** The house stat line, from a CFB game row. Every category COALESCEd to 0. */
function toCollegeStatLine(r) {
  return {
    passYds: r.pass_yds, passTd: r.pass_td, int: r.pass_int,
    rushYds: r.rush_yds, rushTd: r.rush_td,
    rec: r.rec, recYds: r.rec_yds, recTd: r.rec_td,
    fumblesLost: r.fum_lost,
    fgm: r.fgm, xp: r.xpm,
  };
}

/**
 * ffcPlayerId -> { points, ppg, games, season, school } for college pool rows.
 *
 * IDENTITY BY NAME + POSITION, NEVER SCHOOL. A player's school is the one
 * Fantrax lists him at NOW; his stats are at the school he last PLAYED for, and
 * the two differ for every transfer - measured, Caleb Hawkins is OkSt on the
 * board and North Texas in the 2025 log, Cam Coleman is Texas on the board and
 * Auburn in the log. Matching on school would drop exactly the players who moved.
 * The school in the returned summary is the one the STATS are from, so a row can
 * say where the number was earned.
 *
 * AMBIGUITY IS NOT A MATCH. Two players sharing a normalized name and position
 * yield no summary at all rather than the first one found.
 */
export async function getCollegeSeasonSummaries(ffcPlayerIds, scoringFormat = 'ppr') {
  const ids = [...new Set((ffcPlayerIds ?? []).map(String))];
  if (!ids.length) return {};

  // The pool rows tell us who these ids are. league='ncaaf' scopes it: an NFL id
  // handed to this function must find nothing here, not fall through to a
  // college player of the same name.
  const pool = await sql`
    SELECT DISTINCT ffc_player_id, name, position FROM sim_player_pool
     WHERE ffc_player_id = ANY(${ids}) AND league = 'ncaaf'`;
  if (!pool.length) return {};

  const names = [...new Set(pool.map((p) => p.name))];
  const rows = await sql`
    SELECT p.full_name, p.position, gs.player_id, gs.team_name,
           COALESCE(gs.pass_yds,0)  AS pass_yds,  COALESCE(gs.pass_td,0) AS pass_td,
           COALESCE(gs.pass_int,0)  AS pass_int,  COALESCE(gs.rush_yds,0) AS rush_yds,
           COALESCE(gs.rush_td,0)   AS rush_td,   COALESCE(gs.rec,0)      AS rec,
           COALESCE(gs.rec_yds,0)   AS rec_yds,   COALESCE(gs.rec_td,0)   AS rec_td,
           COALESCE(gs.fum_lost,0)  AS fum_lost,  COALESCE(gs.fgm,0)      AS fgm,
           COALESCE(gs.xpm,0)       AS xpm
      FROM players p
      JOIN cfb_player_game_stats gs ON gs.player_id = p.id
     WHERE p.full_name = ANY(${names}) AND gs.season = ${CFB_SEASON}`;

  // Group by (name, position) -> the distinct players wearing it, then by player.
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.full_name}|${r.position}`;
    if (!byKey.has(key)) byKey.set(key, new Map());
    const perPlayer = byKey.get(key);
    if (!perPlayer.has(r.player_id)) perPlayer.set(r.player_id, []);
    perPlayer.get(r.player_id).push(r);
  }

  const out = {};
  for (const p of pool) {
    const perPlayer = byKey.get(`${p.name}|${p.position}`);
    if (!perPlayer || perPlayer.size !== 1) continue;   // unknown or ambiguous -> nothing
    const games = [...perPlayer.values()][0];
    if (!games.length) continue;
    const summary = seasonSummary(games.map((g) => ({ stats: toCollegeStatLine(g) })), scoringFormat);
    out[String(p.ffc_player_id)] = {
      ...summary,
      season: CFB_SEASON,
      school: games[0].team_name ?? null,
    };
  }
  return out;
}
