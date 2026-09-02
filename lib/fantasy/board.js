// lib/fantasy/board.js — pure snake-board derivation for the room's BOARD page.
// Data in (config + picks + whose-turn), grid out. No DB, no React — so the snake
// geometry and cell mapping are unit-testable the same way roster.js is.
//
// The board is teams columns x rounds rows. Snake order means odd rounds run
// left->right (team 0..N-1) and even rounds run right->left, so a team's column
// is fixed while its pick NUMBER zig-zags down the rounds.

import { deriveRounds } from './config.js';
import { dstNickname } from './dstName.js';

/**
 * @param {{teamsCount:number, rosterSlots:Record<string,number>}} config
 * @param {Array<{overallPick:number, position:string, playerName:string, slotPos?:string, synthetic?:boolean}>} picks
 * @param {{userTeamIndex:number, currentOverall:number|null, seatLabels?:string[]|null, keepers?:Array<{overall:number, name:string, position:string, slotPos?:string, teamSlot?:number}>|null}} ctx
 * @returns {{teams:number, rounds:number, columns:Array, rows:Array}}
 */
export function buildBoard(config, picks, ctx = {}) {
  const teams = config.teamsCount ?? config.teams_count;
  const rounds = deriveRounds(config.rosterSlots ?? config.roster_slots);
  const { userTeamIndex = null, currentOverall = null } = ctx;
  const byOverall = new Map((picks ?? []).map((p) => [p.overallPick, p]));
  // UNMADE KEEPERS OWN THEIR CELLS. A keeper's overall is decided before the
  // draft starts; until the engine commits him there, the cell is his and is
  // rendered as such - never as empty, which reads as draftable. A made pick at
  // the same overall wins (it IS the commit), so the cell flips from keeper to
  // pick the moment the commit lands, with nothing else changing.
  const { keepers = null } = ctx;
  const keeperAt = new Map((keepers ?? []).map((k) => [k.overall, k]));

  // Overall pick number (1-based) for a given round + team column, under snake order.
  const overallAt = (round, teamIndex) => {
    const posInRound = round % 2 === 1 ? teamIndex : teams - 1 - teamIndex;
    return (round - 1) * teams + posInRound + 1;
  };

  // Column headers. `seatLabels` (optional) is the tracker's real manager names -
  // at a live table the columns are people, not numbers. The user's own column
  // still reads YOU: it is the one column that must never be misread, and a name
  // there would make you scan for yourself instead of seeing yourself.
  // Omitted (the sim) keeps the original YOU / 1..N numbering exactly.
  const { seatLabels = null } = ctx;
  const columns = Array.from({ length: teams }, (_, teamIndex) => ({
    teamIndex,
    label: teamIndex === userTeamIndex
      ? 'YOU'
      : (seatLabels?.[teamIndex] || String(teamIndex + 1)),
    isYou: teamIndex === userTeamIndex,
  }));

  const rows = [];
  for (let round = 1; round <= rounds; round++) {
    const cells = [];
    for (let teamIndex = 0; teamIndex < teams; teamIndex++) {
      const overall = overallAt(round, teamIndex);
      const pick = byOverall.get(overall) ?? null;
      const keeper = pick ? null : (keeperAt.get(overall) ?? null);
      const onClock = currentOverall != null && overall === currentOverall;
      cells.push({
        overall,
        teamIndex,
        pick,
        keeper,
        mine: teamIndex === userTeamIndex,
        onClock,
        empty: !pick && !keeper && !onClock,
      });
    }
    rows.push({ round, cells });
  }
  return { teams, rounds, columns, rows };
}

// Last name, truncated — the board cell only has room for a short token.
// A defense has no last name: "Houston Texans D/ST" is the club's nickname,
// "Texans" (the cell's position line already says DST). Without this the last
// token was "D/ST" for all 32.
export function boardName(fullName, max = 8) {
  if (!fullName) return '';
  const nick = dstNickname(fullName);
  if (nick) return nick.slice(0, max);
  const parts = String(fullName).trim().split(/\s+/);
  return parts[parts.length - 1].slice(0, max);
}
