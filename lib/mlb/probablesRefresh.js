// lib/mlb/probablesRefresh.js - the starters for every MLB game in the next 36
// hours, written onto the match row every fifteen minutes (tue-4).
//
// WHY THIS EXISTS. The live poller's pre-kick pass (services/live-poller/
// poll.mjs mlbProbables) only sees a game four hours before first pitch, so an
// 18:00Z Wild Card game carried `probables: null` all morning - the card said
// "No line yet" and October's arm picker offered "starter not announced" -
// while BDL had both starters since the night before. This pass reads the
// same source (/mlb/v1/lineups, lib/mlb/probables.js) for the whole horizon in
// one call per 25 games and writes metadata.probables through the one writer
// that already owns that key (lib/mlb/detail.js writeMlbProbables).
//
// IT NEVER WIPES. A reading with a side missing keeps the stored side: BDL
// dropping an announcement for one fetch is not the club un-announcing him,
// and a card that flickered back to TBA would be worse than one a pass late.
// A different NAME on a side replaces it - that is a scratch, and the whole
// point of re-reading.

import { sql as defaultSql } from '../db.js';
import { fetchLineupRows, probablesFromLineupRows } from './probables.js';
import { writeMlbProbables } from './detail.js';

export const REFRESH_MS = 15 * 60 * 1000;
export const HORIZON_HOURS = 36;

/**
 * PURE. What to store, given what is stored and what was just read, or null
 * when nothing would change. A side is replaced by a reading of that side and
 * kept when the reading lacks it.
 */
export function mergeProbables(stored, reading) {
  if (!reading) return null;
  const next = {
    away: reading.away ?? stored?.away ?? null,
    home: reading.home ?? stored?.home ?? null,
  };
  if (!next.away && !next.home) return null;
  // FIELD BY FIELD, not JSON text: jsonb hands the stored object back with its
  // keys reordered, and a text compare called every pass a change.
  const same = (a, b) => (a == null && b == null)
    || (a != null && b != null && String(a.id) === String(b.id) && a.name === b.name && (a.hand ?? null) === (b.hand ?? null));
  if (stored && same(stored.away, next.away) && same(stored.home, next.home)) return null;
  return next;
}

/**
 * One pass. Returns { considered, fetched, wrote } and never throws past the
 * caller's own catch - the poller logs it and carries on.
 */
export async function refreshMlbProbables({
  sql = defaultSql, now = new Date(), horizonHours = HORIZON_HOURS,
  fetchRows = fetchLineupRows, write = writeMlbProbables,
} = {}) {
  const t = new Date(now).toISOString();
  const games = await sql`
    SELECT m.id, m.external_ids->>'bdl_game_id' AS bdl,
           a.abbreviation AS away_abbr, h.abbreviation AS home_abbr,
           m.metadata->'probables' AS probables
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.status = 'scheduled'
       AND m.external_ids->>'bdl_game_id' IS NOT NULL
       AND m.kickoff_at BETWEEN ${t}::timestamptz
                            AND ${t}::timestamptz + make_interval(hours => ${Number(horizonHours)})
     ORDER BY m.kickoff_at
     LIMIT 60`;
  const out = { considered: games.length, fetched: 0, wrote: 0 };
  if (!games.length) return out;

  const rows = await fetchRows(games.map((g) => g.bdl));
  out.fetched = rows.length;
  const byGame = new Map();
  for (const r of rows) {
    const k = String(r?.game_id);
    if (!byGame.has(k)) byGame.set(k, []);
    byGame.get(k).push(r);
  }
  for (const g of games) {
    const reading = probablesFromLineupRows(byGame.get(String(g.bdl)) ?? [], { awayAbbr: g.away_abbr, homeAbbr: g.home_abbr });
    const next = mergeProbables(g.probables, reading);
    if (next && await write(sql, g.id, next)) out.wrote += 1;
  }
  return out;
}
