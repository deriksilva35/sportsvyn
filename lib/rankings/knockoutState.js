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
      if (loser != null) eliminatedTeamIds.add(loser);
    }
  }

  return { r32FieldTeamIds, eliminatedTeamIds };
}
