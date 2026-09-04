// lib/daily/seasonStatLine.js — nfl_player_season_totals row -> the camelCase
// shape lib/fantasy/scoring.js's fantasyPoints() reads. PURE.
//
// NOT lib/fantasy/playerStats.js's toStatLine()/toDefenseLine(). Those are
// built for nfl_player_game_stats, which carries `fr` (fumble recoveries)
// and `tgt` (targets); nfl_player_season_totals has neither column - checked
// against migrations/087 and 088's own column lists. Reusing toDefenseLine()
// would read r.fr as undefined every time, which happens to score correctly
// as zero (scoring.js's n() treats undefined as 0) but for the wrong reason -
// "no data" and "zero recoveries" are different claims, and this file keeps
// them apart by never asking for a column that cannot exist.
export function toSeasonStatLine(r) {
  return {
    passYds: r.pass_yds, passTd: r.pass_td, int: r.pass_int,
    rushYds: r.rush_yds, rushTd: r.rush_td,
    rec: r.rec, recYds: r.rec_yds, recTd: r.rec_td,
    // fumbles_lost is NULL across the WHOLE 46-season range, by ruling: one
    // scoring rule has to hold for every era, and this table never carries a
    // value that would make a modern-only fumble term honest. n() treats
    // null the same as "not tracked here", which is the correct read.
    fumblesLost: r.fumbles_lost,
    fgm: r.fgm, xp: r.xp,
    sacks: r.sacks, defInt: r.def_int, defTd: r.def_td,
  };
}
