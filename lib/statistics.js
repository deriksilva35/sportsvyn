// lib/statistics.js — match_statistics sync atom for the live-poll path.
//
// API-Sports /fixtures/statistics?fixture=X returns [{ team, statistics }, ...]
// — typically two sides (home + away), each with an array of { type, value }
// entries. Pre-kickoff the response is empty []. Mid-match each side has
// ~18 stat entries covering possession, shots, passes, fouls, cards, etc.
// Values are mixed: integers for counts, percentage strings ("45%"),
// nulls for unavailable stats (expected_goals is commonly null for
// friendlies on the current plan).
//
// syncMatchStatistics(matchDbId, statsArray, { homeTeamApiId,
//                                               awayTeamApiId,
//                                               fixtureApiId }):
//   - Empty array → { written: 0, hadData: false } (canonical not-ready)
//   - Otherwise: per side, flip prior is_current=true rows to false,
//     INSERT a fresh row with the normalized stats jsonb keyed by type.
//
// Mirrors lib/lineups.js conventions. team_side derives from team_api_id
// match (same defensive Q2 fallback as lib/events.js — never throw, log
// + default to 'home' if the team.id matches neither side).

import { sql } from './db.js';

function deriveTeamSide(eventTeamId, { homeTeamApiId, awayTeamApiId, fixtureApiId, matchDbId }) {
  if (eventTeamId === homeTeamApiId) return 'home';
  if (eventTeamId === awayTeamApiId) return 'away';
  console.error(
    `syncMatchStatistics: side team.id=${eventTeamId} matches neither home (${homeTeamApiId}) nor away (${awayTeamApiId}) ` +
      `for fixture ${fixtureApiId} (match_id=${matchDbId}); defaulting team_side='home'.`,
  );
  return 'home';
}

function normalizeSide(rawSide, teamSide) {
  if (!rawSide?.statistics || !Array.isArray(rawSide.statistics)) return null;
  // Flatten the [{type, value}] array into a single object keyed by type.
  // Preserve mixed types (number / string / null) — render layer handles.
  const stats = {};
  for (const s of rawSide.statistics) {
    if (s?.type) stats[s.type] = s.value ?? null;
  }
  if (Object.keys(stats).length === 0) return null;
  return { team_side: teamSide, stats };
}

export async function syncMatchStatistics(matchDbId, statsArray, options = {}) {
  if (!Array.isArray(statsArray) || statsArray.length < 2) {
    return { written: 0, hadData: false };
  }

  const { homeTeamApiId, awayTeamApiId, fixtureApiId } = options;

  // Each side carries its own team.id — match against home/away rather
  // than trusting positional order. Same robustness as lib/events.js.
  const sides = statsArray
    .map((side) => {
      const teamSide = deriveTeamSide(side?.team?.id, {
        homeTeamApiId, awayTeamApiId, fixtureApiId, matchDbId,
      });
      return normalizeSide(side, teamSide);
    })
    .filter(Boolean);

  if (sides.length === 0) return { written: 0, hadData: false };

  let written = 0;
  for (const side of sides) {
    await sql`
      WITH update_old AS (
        UPDATE match_statistics SET is_current = false
        WHERE match_id = ${matchDbId}
          AND team_side = ${side.team_side}
          AND is_current = true
        RETURNING 1
      )
      INSERT INTO match_statistics (
        match_id, team_side, stats, is_current, fetched_at
      ) VALUES (
        ${matchDbId}, ${side.team_side},
        ${JSON.stringify(side.stats)}::jsonb, true, now()
      )
    `;
    written++;
  }
  return { written, hadData: true };
}
