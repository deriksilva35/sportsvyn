// lib/gridiron/oddsReader.js — gridiron h2h odds read for the display surfaces.
//
// Distinct from the soccer match-page read (which is 3-way and keyed on
// market_type='match_winner' with 'home'/'draw'/'away' selection labels):
// gridiron h2h rows use market_type='h2h', TWO rows per match, and
// selection_label = the actual TEAM NAME (The Odds API naming, e.g. "Alabama
// Crimson Tide"). We orient each row to home/away by matching that label against
// our team names (school-only for CFB) with the same normalize+prefix rule the
// join uses — and we DO select movement_24h_* (the match page omits them).
//
// getH2hOdds is BATCH: one query for a whole slate's match ids (no per-card N+1).

import { sql } from './../db.js';
import { normalizeName } from './nameMatch.js';

// Which side does an Odds API selection_label belong to? Handles CFB where our
// name ("Alabama") is a prefix of the label ("Alabama Crimson Tide").
export function sideFor(label, homeName, awayName) {
  const n = normalizeName(label);
  const h = normalizeName(homeName ?? '');
  const a = normalizeName(awayName ?? '');
  const hit = (t) => Boolean(t) && (n === t || n.startsWith(`${t} `) || t.startsWith(`${n} `));
  const hitH = hit(h);
  const hitA = hit(a);
  if (hitH && !hitA) return 'home';
  if (hitA && !hitH) return 'away';
  if (n === h) return 'home'; // exact tiebreak
  if (n === a) return 'away';
  return null;
}

// Pure: raw joined rows -> Map(matchId -> oriented odds). Exported for unit test.
// A match missing a clean two-sided read is dropped (absence over inference).
export function shapeH2hRows(rows) {
  const byMatch = new Map();
  for (const r of rows) {
    let e = byMatch.get(r.match_id);
    if (!e) {
      e = {
        matchId: r.match_id,
        home: null,
        away: null,
        numBooks: r.num_books ?? (r.source_books?.length ?? null),
        sourceBooks: r.source_books ?? [],
        fetchedAt: r.fetched_at ?? null,
      };
      byMatch.set(r.match_id, e);
    }
    const side = sideFor(r.selection_label, r.home_name, r.away_name);
    if (side == null) continue;
    const payload = {
      abbr: side === 'home' ? (r.home_abbr ?? r.home_name) : (r.away_abbr ?? r.away_name),
      american: r.american_odds ?? null,
      implied: r.implied == null ? null : Number(r.implied),
      decimal: r.decimal == null ? null : Number(r.decimal),
      moveProb: r.move_prob == null ? null : Number(r.move_prob),
      moveOdds: r.move_odds == null ? null : Number(r.move_odds),
    };
    e[side] = payload;
  }
  for (const [k, e] of byMatch) {
    if (!e.home || !e.away || e.home.implied == null || e.away.implied == null) byMatch.delete(k);
  }
  return byMatch;
}

// getH2hOdds(matchIds) -> Map(matchId -> { home, away, numBooks, sourceBooks, fetchedAt }).
// One query for the whole slate.
export async function getH2hOdds(matchIds) {
  const ids = [...new Set((matchIds ?? []).filter((x) => x != null))];
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT o.match_id, o.selection_label, o.american_odds,
           o.implied_probability::float AS implied, o.decimal_odds::float AS decimal,
           o.movement_24h_prob::float AS move_prob, o.movement_24h_odds AS move_odds,
           o.num_books, o.source_books, o.fetched_at,
           h.name AS home_name, h.abbreviation AS home_abbr,
           a.name AS away_name, a.abbreviation AS away_abbr
      FROM odds_markets o
      JOIN matches m ON m.id = o.match_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE o.match_id = ANY(${ids})
       AND o.market_scope = 'match'
       AND o.market_type = 'h2h'
       AND o.is_current = true`;
  return shapeH2hRows(rows);
}
