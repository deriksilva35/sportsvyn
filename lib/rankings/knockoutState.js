// lib/rankings/knockoutState.js — read-time signals for pruning the published
// ranking boards to the knockout field. ONE query over the KO matches; pure
// read, no writes. Co-located with the rankings readers (lib/rankings.js).
//
//   r32FieldTeamIds   : Set of team_ids resolved into stage='round_of_32'
//                       (home or away) — the FROZEN 32-team field the PLAYER
//                       board is held to for the whole tournament.
//   eliminatedTeamIds : Set of team_ids that LOST a completed (status='final')
//                       KO match. Loser logic is penalties-aware and matches
//                       the bracket resolver exactly: lower regulation score
//                       loses; if level, lower shootout tally loses; if level
//                       with null/equal pens, NO loser (partial-data guard).
//
// TEAM board filters entries to NOT IN eliminatedTeamIds (a team that hasn't
// lost a KO match stays — equivalent to "still alive", and self-sizing as
// rounds eliminate teams). A fresh lean query is used rather than
// getKnockoutBracket() — we only need team_ids + scores, not flags/slots.

import { sql } from '../db.js';

// Stages whose LOSER earns a progression discount. A team out at the semifinal
// or later reached SF+, so it keeps full weight and is absent from the map. QF
// is 'quarter' in this DB.
const DISCOUNT_STAGES = new Set(['round_of_32', 'round_of_16', 'quarter']);

// Progression discount curve: the further a team went before losing, the
// lighter the discount. Still-alive teams and SF+ exits are not in the exit map
// and resolve to 1.00 (no discount).
const PROGRESSION_T = { round_of_32: 0.85, round_of_16: 0.90, quarter: 0.95 };

// exitRound -> team multiplier T. null/undefined (still alive or SF+) -> 1.00.
export function progressionMultiplier(exitRound) {
  return PROGRESSION_T[exitRound] ?? 1.0;
}

export async function getKnockoutPruneState({ leagueSlug = 'fifa-wc-2026' } = {}) {
  const rows = await sql`
    SELECT m.stage, m.status,
           m.home_team_id, m.away_team_id,
           m.home_score, m.away_score, m.home_penalties, m.away_penalties
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${leagueSlug}
       AND m.stage IN ('round_of_32','round_of_16','quarter','semi','third_place','final')
  `;

  const r32FieldTeamIds = new Set();
  const eliminatedTeamIds = new Set();
  const exitRoundByTeamId = new Map(); // team_id -> 'round_of_32' | 'round_of_16' | 'quarter'

  for (const m of rows) {
    if (m.stage === 'round_of_32') {
      if (m.home_team_id) r32FieldTeamIds.add(m.home_team_id);
      if (m.away_team_id) r32FieldTeamIds.add(m.away_team_id);
    }

    // Eliminated = the loser of a COMPLETED KO match (both teams resolved).
    if (m.status === 'final' && m.home_team_id && m.away_team_id
        && m.home_score != null && m.away_score != null) {
      let loser = null;
      if (m.home_score < m.away_score)      loser = m.home_team_id;
      else if (m.away_score < m.home_score) loser = m.away_team_id;
      else {
        const hp = m.home_penalties, ap = m.away_penalties;
        if (hp != null && ap != null && hp !== ap) {
          loser = hp < ap ? m.home_team_id : m.away_team_id;
        }
        // level + null/equal pens -> no loser (partial-data guard)
      }
      if (loser != null) {
        eliminatedTeamIds.add(loser);
        // Same `loser` the block above resolved -- record its exit round for
        // the progression discount. Only R32/R16/QF exits are discounted; SF+
        // losers are omitted (they keep T=1.00).
        if (DISCOUNT_STAGES.has(m.stage)) exitRoundByTeamId.set(loser, m.stage);
      }
    }
  }

  return { r32FieldTeamIds, eliminatedTeamIds, exitRoundByTeamId };
}
