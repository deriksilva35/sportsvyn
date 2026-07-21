// lib/fantasy/board.js — pure snake-board derivation for the room's BOARD page.
// Data in (config + picks + whose-turn), grid out. No DB, no React — so the snake
// geometry and cell mapping are unit-testable the same way roster.js is.
//
// The board is teams columns x rounds rows. Snake order means odd rounds run
// left->right (team 0..N-1) and even rounds run right->left, so a team's column
// is fixed while its pick NUMBER zig-zags down the rounds.

import { deriveRounds } from './config.js';

/**
 * @param {{teamsCount:number, rosterSlots:Record<string,number>}} config
 * @param {Array<{overallPick:number, position:string, playerName:string, slotPos?:string, synthetic?:boolean}>} picks
 * @param {{userTeamIndex:number, currentOverall:number|null}} ctx
 * @returns {{teams:number, rounds:number, columns:Array, rows:Array}}
 */
export function buildBoard(config, picks, ctx = {}) {
  const teams = config.teamsCount ?? config.teams_count;
  const rounds = deriveRounds(config.rosterSlots ?? config.roster_slots);
  const { userTeamIndex = null, currentOverall = null } = ctx;
  const byOverall = new Map((picks ?? []).map((p) => [p.overallPick, p]));

  // Overall pick number (1-based) for a given round + team column, under snake order.
  const overallAt = (round, teamIndex) => {
    const posInRound = round % 2 === 1 ? teamIndex : teams - 1 - teamIndex;
    return (round - 1) * teams + posInRound + 1;
  };

  const columns = Array.from({ length: teams }, (_, teamIndex) => ({
    teamIndex,
    label: teamIndex === userTeamIndex ? 'YOU' : String(teamIndex + 1),
    isYou: teamIndex === userTeamIndex,
  }));

  const rows = [];
  for (let round = 1; round <= rounds; round++) {
    const cells = [];
    for (let teamIndex = 0; teamIndex < teams; teamIndex++) {
      const overall = overallAt(round, teamIndex);
      const pick = byOverall.get(overall) ?? null;
      const onClock = currentOverall != null && overall === currentOverall;
      cells.push({
        overall,
        teamIndex,
        pick,
        mine: teamIndex === userTeamIndex,
        onClock,
        empty: !pick && !onClock,
      });
    }
    rows.push({ round, cells });
  }
  return { teams, rounds, columns, rows };
}

// Last name, truncated — the board cell only has room for a short token.
export function boardName(fullName, max = 8) {
  if (!fullName) return '';
  const parts = String(fullName).trim().split(/\s+/);
  return parts[parts.length - 1].slice(0, max);
}
