// lib/weekly/seasonLine.js - WHAT A PLAYER HAS DONE THIS SEASON, for the
// Weekly's pool panel.
//
// ============================================================================
// THE PANEL WAS RANKING THIS WEEK'S PICKS BY A CAREER AVERAGE
// ============================================================================
// poolRows sorts on ppgOf(resume), and that resume string is CAREER PPR per
// game over every REG game in the corpus (2015 on), frozen into the board at
// creation - so a 34-year-old on 120 games outranked a back in the middle of a
// career year, and the row's second line spent its width on a college and a
// draft slot from a decade ago. Neither fact is about the week being played.
//
// THIS SEASON, AND ONLY FINALS. An in-flight game is not in an average: a man
// three carries into the first quarter would otherwise drag his own PPG down
// while you are looking at him. matches.status = 'final' is the whole rule,
// and it is why this cannot be read off the same rows the live layer uses.
//
// THE SCORER IS THE PRODUCT'S ONE SCORER. fantasyPoints(..., 'ppr') - full
// PPR, the same call the settle and the live layer make. THIS FILE IS lib,
// not a surface: slotState.test.mjs's guard forbids app/weekly/page.js,
// WeeklyRoom.js, app/draft/page.js and lib/draft/liveCard.js from importing
// the scorer, and this module is none of them. The panel gets a number, not
// a scoring rule.
//
// SUMMED IN SQL, SCORED ONCE. scoring.js is linear - per-unit coefficients,
// no thresholds, no bonuses - so points(sum of games) equals sum(points per
// game) exactly, and it is MORE accurate than adding per-game figures that
// have each been rounded to a tenth. careerIndex() makes the same argument
// for the same reason (lib/daily/create.js).

import { sql } from '../db.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';

const n = (v) => Number(v ?? 0);

/**
 * The season line a pool row shows, per position, from season TOTALS.
 *
 * ZERO COMPONENTS STILL PRINT. A quarterback with 0 interceptions has earned
 * that 0 and a reader is entitled to see it; blanking it would leave the line
 * reading as though the number were unknown. Hyphens, never em dashes (house
 * rule).
 *
 * @param {string|null} pos nfl_players.position
 * @param {object} t summed season components
 * @returns {string|null}
 */
export function seasonLineFor(pos, t) {
  if (!t) return null;
  const yds = (v) => n(v).toLocaleString('en-US');
  switch (pos) {
    case 'QB':
      return `${yds(t.passYds)} yds · ${n(t.passTd)} TD · ${n(t.int)} INT · ${yds(t.rushYds)} rush`;
    case 'RB':
      return `${yds(t.rushYds)} rush · ${n(t.rec)} rec · ${yds(t.recYds)} yds · ${n(t.rushTd) + n(t.recTd)} TD`;
    case 'WR':
    case 'TE':
      return `${n(t.rec)} rec · ${yds(t.recYds)} yds · ${n(t.recTd)} TD`;
    // Anything else (a K, a DST, a position we do not hold) gets no line
    // rather than a line about the wrong statistics.
    default:
      return null;
  }
}

/**
 * Every player's THIS-SEASON games, PPR per game, and season line.
 *
 * ONE QUERY. The Weekly's board is 873 players and the panel re-renders on
 * every keystroke; a read per row is not a thing this page can afford, so the
 * whole season arrives as one grouped scan and the panel does lookups.
 *
 * @param {number|string} season
 * @returns {Promise<Map<number, {gp: number, ppg: number, line: string|null}>>}
 */
export async function seasonStats(season) {
  if (season == null) return new Map();
  const rows = await sql`
    SELECT s.nfl_player_id                             AS id,
           np.position                                 AS pos,
           count(DISTINCT s.match_id)::int             AS gp,
           sum(COALESCE(s.pass_cmp, 0))::int           AS pass_cmp,
           sum(COALESCE(s.pass_att, 0))::int           AS pass_att,
           sum(COALESCE(s.pass_yds, 0))::int           AS pass_yds,
           sum(COALESCE(s.pass_td, 0))::int            AS pass_td,
           sum(COALESCE(s.pass_int, 0))::int           AS pass_int,
           sum(COALESCE(s.rush_att, 0))::int           AS rush_att,
           sum(COALESCE(s.rush_yds, 0))::int           AS rush_yds,
           sum(COALESCE(s.rush_td, 0))::int            AS rush_td,
           sum(COALESCE(s.tgt, 0))::int                AS tgt,
           sum(COALESCE(s.rec, 0))::int                AS rec,
           sum(COALESCE(s.rec_yds, 0))::int            AS rec_yds,
           sum(COALESCE(s.rec_td, 0))::int             AS rec_td,
           sum(COALESCE(s.fumbles_lost, 0))::int       AS fumbles_lost,
           sum(COALESCE(s.fgm, 0))::int                AS fgm,
           sum(COALESCE(s.fga, 0))::int                AS fga,
           sum(COALESCE(s.xp, 0))::int                 AS xp
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id
      JOIN nfl_players np ON np.id = s.nfl_player_id
     WHERE l.slug = 'nfl'
       AND m.season_year = ${season}
       AND m.season_phase = 'REG'
       -- FINALS ONLY. A game in progress is not in the average.
       AND m.status = 'final'
     GROUP BY s.nfl_player_id, np.position`;

  const out = new Map();
  for (const r of rows) {
    const gp = Number(r.gp);
    if (!Number.isFinite(gp) || gp <= 0) continue;
    // The summed row, named the way toStatLine names a single game's, so the
    // one scorer can read it directly.
    const totals = toStatLine(r);
    const pts = fantasyPoints(totals, 'ppr');
    out.set(Number(r.id), {
      gp,
      ppg: Math.round((Number.isFinite(pts) ? pts : 0) / gp * 10) / 10,
      line: seasonLineFor(r.pos, totals),
    });
  }
  return out;
}
