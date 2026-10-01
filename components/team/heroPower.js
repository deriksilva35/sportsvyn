// components/team/heroPower.js - which numbers the team hero's rank block draws.
//
// THE RANK BLOCK READS THE SERVED LIST (tue-13). A gridiron page passes `power`
// from lib/rankings/servedBoard.js servedRankFor() - nfl-power-z for the NFL,
// cfb-top25 for CFB - and null there means "not on the served board", which
// draws no block: the teams.current_power_* columns are still written by the
// retired NFL Elo board and must not leak back in. A page that passes nothing
// (the World Cup) reads those columns exactly as before.
//
// ITS OWN FILE, and pure, so a node test can hold the rule without mounting the
// hero (which imports a client component).

export function heroPower(team, power = undefined) {
  if (power !== undefined) return power;
  if (team?.current_power_rank == null) return null;
  return { rank: team.current_power_rank, score: team.current_power_score, movement: team.current_rank_movement, label: 'Composite' };
}
