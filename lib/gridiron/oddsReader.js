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

// getTitleContenders(leagueId, n) — top-N championship-futures contenders by
// de-vigged implied prob, from the current futures rows, with movement vs the
// prior edition (movement_24h_prob; null/flat until a baseline accrues).
// Pure: title-futures rows (already ordered by implied desc) -> ranked contenders.
export function shapeContenders(rows) {
  return rows.map((r, i) => ({
    rank: i + 1,
    teamId: r.team_id,
    name: r.team_name ?? r.selection_label,
    abbr: r.team_abbr ?? null,
    slug: r.team_slug ?? null,
    impliedPct: r.implied == null ? null : Number(r.implied),
    american: r.american_odds ?? null,
    moveProb: r.move_prob == null ? null : Number(r.move_prob),
    numBooks: r.num_books ?? (r.source_books?.length ?? null),
    fetchedAt: r.fetched_at ?? null,
  }));
}

export async function getTitleContenders(leagueId, n = 12) {
  if (leagueId == null) return [];
  const rows = await sql`
    SELECT o.selection_label, o.team_id, o.american_odds,
           o.implied_probability::float AS implied, o.decimal_odds::float AS decimal,
           o.movement_24h_prob::float AS move_prob, o.num_books, o.source_books, o.fetched_at,
           t.name AS team_name, t.abbreviation AS team_abbr, t.slug AS team_slug
      FROM odds_markets o
      LEFT JOIN teams t ON t.id = o.team_id
     WHERE o.league_id = ${leagueId} AND o.market_scope = 'futures'
       AND o.market_type = 'championship_winner' AND o.is_current = true
     ORDER BY o.implied_probability DESC NULLS LAST, o.id ASC
     LIMIT ${n}`;
  return shapeContenders(rows);
}

// ---------------------------------------------------------------------------
// THE SPREAD, HOME-BASED AND SIGNED — for the Pick'em board card.
// ---------------------------------------------------------------------------
// ONE SURFACE, ONE SOURCE. This reads the SAME odds_markets rows the Market
// page reads, through the same guards (market_scope 'match', is_current, and
// the same fetcher_version constant), and resolves the side with the SAME
// sideFor() the head-to-head shaper uses. It is a second QUESTION of one
// pipeline, not a second odds reader — a board card showing a line the Market
// page disagrees with would be worse than a board card with no line.
//
// SIGNED AND HOME-BASED: the value is the HOME side's handicap, so negative
// means the home team is favoured. The favourite is derivable from that sign,
// which is why the board wire carries one key and not two.
const SPREAD_FETCHER = 'odds-api-v4';

export async function getSpreadHome(matchIds) {
  const ids = [...new Set((matchIds ?? []).filter((x) => x != null))];
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT o.match_id, o.selection_label, o.selection_value,
           h.name AS home_name, a.name AS away_name
      FROM odds_markets o
      JOIN matches m ON m.id = o.match_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE o.match_id = ANY(${ids})
       AND o.market_scope = 'match'
       AND o.market_type = 'spread'
       AND o.is_current = true
       AND o.fetcher_version = ${SPREAD_FETCHER}`;
  return shapeSpreadRows(rows);
}

/** PURE: raw spread rows -> Map(matchId -> home-based signed number). */
export function shapeSpreadRows(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (out.has(r.match_id)) continue;
    const side = sideFor(r.selection_label, r.home_name, r.away_name);
    const v = r.selection_value == null ? null : Number(r.selection_value);
    if (!Number.isFinite(v)) continue;
    // A row we cannot attribute to a side is DROPPED, not guessed. Absence
    // over inference: a spread on the wrong team is a lie, an absent spread
    // is a quiet card.
    if (side === 'home') out.set(r.match_id, v);
    else if (side === 'away') out.set(r.match_id, -v);
  }
  return out;
}

/**
 * THE TOTAL, one number per match.
 *
 * SAME PIPELINE, SAME GUARDS as getSpreadHome above - market_scope='match',
 * is_current, the pinned fetcher version. A second reader for the total would
 * be a second answer to "what is the line on this game", and the two would
 * disagree the first time either was touched.
 *
 * OVER AND UNDER CARRY THE SAME NUMBER, so unlike the spread there is no side
 * to resolve: the first priced row for a match is the total. A row whose value
 * is missing is dropped rather than defaulted - 0 is not a total anybody set.
 */
export async function getTotalPoints(matchIds) {
  const ids = [...new Set((matchIds ?? []).filter((x) => x != null))];
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT o.match_id, o.selection_value
      FROM odds_markets o
     WHERE o.match_id = ANY(${ids})
       AND o.market_scope = 'match'
       AND o.market_type = 'total'
       AND o.is_current = true
       AND o.fetcher_version = ${SPREAD_FETCHER}`;
  return shapeTotalRows(rows);
}

/** PURE: raw total rows -> Map(matchId -> number). */
export function shapeTotalRows(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (out.has(r.match_id)) continue;
    const v = r.selection_value == null ? null : Number(r.selection_value);
    if (!Number.isFinite(v) || v <= 0) continue;
    out.set(r.match_id, v);
  }
  return out;
}
