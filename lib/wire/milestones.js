// lib/wire/milestones.js — somebody had a night.
//
// THRESHOLDS OVER STORED COLUMNS, NO LEDGER. The key is (match, player,
// milestone), so a player who crosses 300 passing yards emits once for that
// game however many times the cron re-reads the box score - and if he later
// crosses 400 that is a DIFFERENT milestone and emits again, which is right.
//
// CFB ONLY TODAY. cfb_player_game_stats carries 550 rows for 2026;
// nfl_player_game_stats has 181,182 rows but no 2026 regular-season games yet.
// The NFL arm is the same shape against the other table and joins the day
// there is a week to read.

import { sql } from '../db.js';
import { wireKey } from './hash.js';

/**
 * THE LIST, and each entry is a claim that this number is worth saying.
 * `at` is the threshold; `unit` is what the headline calls it.
 */
export const MILESTONES = Object.freeze([
  { key: 'pass300', col: 'pass_yds', at: 300, unit: 'pass yds' },
  { key: 'rush100', col: 'rush_yds', at: 100, unit: 'rush yds' },
  { key: 'rec100', col: 'rec_yds', at: 100, unit: 'rec yds' },
  { key: 'td3', col: 'total_td', at: 3, unit: 'TD' },
]);

/** "Jayden Maiava 286 pass yds, 2 TD" - the figure that earned the row first,
 *  then the touchdowns only when there are any. PURE. */
export function milestoneHeadline(r, m) {
  const n = Number(r[m.col]);
  if (!Number.isFinite(n)) return null;
  const td = Number(r.total_td);
  const tail = m.key !== 'td3' && Number.isFinite(td) && td > 0
    ? `, ${td} TD` : '';
  return `${r.full_name} ${n} ${m.unit}${tail}`;
}

export function toRows(rows) {
  const out = [];
  for (const r of rows ?? []) {
    for (const m of MILESTONES) {
      const n = Number(r[m.col]);
      if (!Number.isFinite(n) || n < m.at) continue;
      const headline = milestoneHeadline(r, m);
      if (!headline) continue;
      out.push({
        league_id: r.league_id,
        team_ids: [r.team_id].filter(Boolean),
        lane: 'milestone',
        headline,
        url: r.player_slug ? `/player/${r.player_slug}` : `/${r.league_slug}/game/${r.slug}`,
        source: 'Sportsvyn',
        published_at: r.final_seen_at ?? null,
        dedupe_hash: wireKey('milestone', r.match_id, r.player_id, m.key),
        payload: { matchId: r.match_id, playerId: r.player_id, milestone: m.key, value: n },
      });
    }
  }
  return out;
}

export async function cfbMilestones({ season, week } = {}) {
  if (!season || !week) return [];
  const rows = await sql`
    SELECT g.match_id, g.player_id, p.full_name, p.slug AS player_slug,
           g.pass_yds, g.rush_yds, g.rec_yds,
           COALESCE(g.pass_td, 0) + COALESCE(g.rush_td, 0) + COALESCE(g.rec_td, 0) AS total_td,
           m.slug, m.league_id, l.slug AS league_slug, p.current_team_id AS team_id,
           (m.metadata->'detail'->>'final_seen_at')::timestamptz AS final_seen_at
      FROM cfb_player_game_stats g
      JOIN matches m ON m.id = g.match_id
      JOIN leagues l ON l.id = m.league_id
      JOIN players p ON p.id = g.player_id
     WHERE m.season_year = ${season} AND m.week = ${week}
       AND m.season_phase = 'REG' AND m.status = 'final'
       AND (g.pass_yds >= 300 OR g.rush_yds >= 100 OR g.rec_yds >= 100
            OR COALESCE(g.pass_td,0) + COALESCE(g.rush_td,0) + COALESCE(g.rec_td,0) >= 3)`;
  return toRows(rows);
}
