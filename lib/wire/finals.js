// lib/wire/finals.js — the game ended.
//
// FORWARD-ONLY, AND THAT IS A DELIBERATE LIMIT rather than a shortcut.
// metadata.detail.final_seen_at is the flip timestamp, and it covers 45 of 76
// 2026 finals - 59%. The gap is games that finaled before the stamp writer
// shipped, plus the window the upsertGame defect was overwriting. Backfilling
// from that partial denominator would emit a wire that looks like a full
// history and is missing two games in five, which is worse than starting now.
// So the window is bounded: only finals stamped inside the tick window emit.

import { sql } from '../db.js';
import { wireKey } from './hash.js';

/** "Final: USC 42, San José State 26". PURE. Winner first - a final answers
 *  "who won" before "what was the score". */
export function finalHeadline(m) {
  // NULL IS NOT ZERO, and Number(null) is 0 - which would have rendered a game
  // with a missing score as "Final: B 1, A 0". Same law the game page keeps: a
  // 0 beside a team that has no stored score is not a low score, it is a wrong
  // one. Caught by test before it ever ran.
  if (m.home_score === null || m.home_score === undefined) return null;
  if (m.away_score === null || m.away_score === undefined) return null;
  const hs = Number(m.home_score); const as = Number(m.away_score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const home = m.home_name ?? m.home_abbr;
  const away = m.away_name ?? m.away_abbr;
  if (!home || !away) return null;
  if (hs === as) return `Final: ${away} ${as}, ${home} ${hs}`;
  return hs > as
    ? `Final: ${home} ${hs}, ${away} ${as}`
    : `Final: ${away} ${as}, ${home} ${hs}`;
}

export function toRows(rows) {
  const out = [];
  for (const m of rows ?? []) {
    const headline = finalHeadline(m);
    if (!headline) continue;
    out.push({
      league_id: m.league_id,
      team_ids: [m.home_team_id, m.away_team_id].filter(Boolean),
      lane: 'final',
      headline,
      url: `/${m.league_slug}/game/${m.slug}`,
      source: 'Sportsvyn',
      published_at: m.final_seen_at ?? null,
      // ONE PER MATCH, EVER. A game finals once.
      dedupe_hash: wireKey('final', m.id),
      payload: { matchId: m.id, homeScore: m.home_score, awayScore: m.away_score },
    });
  }
  return out;
}

export async function finals({ now = new Date(), windowMin = 20 } = {}) {
  const rows = await sql`
    SELECT m.id, m.slug, m.league_id, m.home_score, m.away_score,
           m.home_team_id, m.away_team_id, l.slug AS league_slug,
           h.name AS home_name, a.name AS away_name,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           (m.metadata->'detail'->>'final_seen_at')::timestamptz AS final_seen_at
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.status = 'final'
       AND (m.metadata->'detail'->>'final_seen_at')::timestamptz
             > ${new Date(now).toISOString()}::timestamptz - (${windowMin} || ' minutes')::interval
     ORDER BY (m.metadata->'detail'->>'final_seen_at')::timestamptz DESC
     LIMIT 40`;
  return toRows(rows);
}
