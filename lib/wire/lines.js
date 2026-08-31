// lib/wire/lines.js — the line moved.
//
// NO NEW LEDGER, AND NOT BECAUSE WE CUT A CORNER. odds_markets already carries
// previous_american_odds, previous_implied_prob, movement_24h_prob and
// previous_snapshot_at ON THE is_current ROW. The move is precomputed by the
// ingest that observed it, so this is one indexed read, no self-join and no
// snapshot table.
//
// THE THRESHOLD IS 1.0 PERCENTAGE POINT, measured on GAME MARKETS ONLY.
//
// The first measurement was wrong and the first dry run caught it. Taken over
// every current selection it looked as though 3pp kept a sane top 1.7% - but
// that population is dominated by PLAYER PROPS, which are far looser than game
// lines, and the emitter promptly produced "Jayden Reed Over +3.5", a prop
// wearing a game-line headline and naming no club. Restricted to spread, h2h
// and total the distribution is much tighter (2,466 current rows):
//     >= 0.5pp   79 selections on scheduled games
//     >= 0.75pp  32
//     >= 1.0pp   22          <- here
//     >= 1.5pp    5
//     >= 3.0pp    3
// At 3pp the wire would carry roughly one line headline a day. At 0.5pp it
// carries most of the board. 1.0 keeps the moves a reader would notice.
//
// THE HOUR BUCKET IS WHAT MAKES IT BEARABLE. movement_24h_prob is a rolling
// 24-hour figure, so a game that moved five points yesterday stays over the
// threshold all day. Keying on the hour means one headline per match per market
// per hour no matter how often the cron looks.

import { sql } from '../db.js';
import { wireKey, hourBucket } from './hash.js';

export const MOVE_THRESHOLD_PP = 1.0;

/**
 * THE HEADLINE, and each market type gets its own grammar because each states
 * a different fact.
 *
 *   spread  "TTU −13.5 at HOU · 7 books"      the number is a handicap
 *   total   "Over 44.5 · USC at SJSU · 7 books"   the number belongs to the game
 *   h2h     "FSU to 62% · 7 books"            the number is a probability
 *
 * The first draft ran every type through the spread grammar. Totals came out as
 * "Over +3" - a plus sign on a points total - and h2h came out as nothing at
 * all, because an h2h row stores no selection_value and the formatter returned
 * null, so every moneyline move was being silently dropped.
 *
 * U+2212 for the sign and U+2192 for the arrow: a hyphen beside an abbreviation
 * reads as part of the name, and the surface's dash grammar is hyphens.
 */
export function lineHeadline(r) {
  // "1 books" is the kind of thing that makes a wire look automated.
  const books = r.num_books ? ` · ${r.num_books} book${r.num_books === 1 ? '' : 's'}` : '';
  const fixture = r.home_abbr && r.away_abbr ? `${r.away_abbr} at ${r.home_abbr}` : null;

  if (r.market_type === 'total') {
    const v = numOrNull(r.selection_value);
    if (v === null || !r.selection_label) return null;
    return `${r.selection_label} ${trim(v)}${fixture ? ` · ${fixture}` : ''}${books}`;
  }

  if (r.market_type === 'h2h') {
    const who = r.selection_abbr;
    const pct = numOrNull(r.implied_probability);
    if (!who || pct === null) return null;
    // The opponent, not the whole fixture: "KENT to 3% · KENT at SC" said the
    // club twice.
    const at = r.opponent_abbr ? ` at ${r.opponent_abbr}` : '';
    return `${who} to ${Math.round(pct)}%${at}${books}`;
  }

  // spread
  const who = r.selection_abbr;
  const v = signed(r.selection_value);
  if (!who || !v) return null;
  const at = r.opponent_abbr ? ` at ${r.opponent_abbr}` : '';
  return `${who} ${v}${at}${books}`;
}

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};
const trim = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function signed(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (s.toUpperCase() === 'PK') return 'PK';
  const n = numOrNull(s);
  if (n === null) return null;
  if (n === 0) return 'PK';
  return `${n < 0 ? '−' : '+'}${trim(Math.abs(n))}`;
}

export function toRows(rows, { now = new Date() } = {}) {
  const bucket = hourBucket(now);
  const out = [];
  const seen = new Set();
  for (const r of rows ?? []) {
    // The query orders the bigger mover first within each match+market, so the
    // first row wins and its pair is dropped here rather than at the database.
    const pair = `${r.match_id}:${r.market_type}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const headline = lineHeadline(r);
    if (!headline) continue;
    out.push({
      league_id: r.league_id ?? null,
      team_ids: [r.home_team_id, r.away_team_id].filter(Boolean),
      lane: 'line',
      headline,
      url: r.slug ? `/${r.league_slug}/game/${r.slug}` : null,
      source: 'Sportsvyn',
      published_at: r.previous_snapshot_at ?? null,
      dedupe_hash: wireKey('line', r.match_id, r.market_type, bucket),
      payload: {
        matchId: r.match_id,
        marketType: r.market_type,
        to: r.selection_value,
        impliedPct: r.implied_probability ?? null,
        movePp: Number(r.movement_24h_prob),
        numBooks: r.num_books ?? null,
      },
    });
  }
  return out;
}

export async function lineMoves({ threshold = MOVE_THRESHOLD_PP, now = new Date() } = {}) {
  const rows = await sql`
    SELECT o.match_id, o.market_type, o.selection_label, o.selection_value,
           o.previous_implied_prob, o.movement_24h_prob, o.num_books,
           o.implied_probability,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           o.previous_snapshot_at,
           -- THE LEAGUE COMES FROM THE MATCH, NOT THE ODDS ROW.
           -- odds_markets.league_id is null on every current game-market row,
           -- so taking it from there gave all 77 line items a null league and
           -- the wire's league join dropped every one of them: they were being
           -- written and rendered nowhere. The match always knows its league.
           m.league_id,
           m.slug, m.home_team_id, m.away_team_id,
           l.slug AS league_slug,
           -- The moving side's own abbreviation, and its opponent's. Resolved
           -- by the same sideFor grammar the market reads use, in SQL here
           -- because we are already joining both clubs.
           CASE WHEN h.name IS NOT NULL AND o.selection_label ILIKE h.name || '%'
                THEN h.abbreviation
                WHEN a.name IS NOT NULL AND o.selection_label ILIKE a.name || '%'
                THEN a.abbreviation END AS selection_abbr,
           CASE WHEN h.name IS NOT NULL AND o.selection_label ILIKE h.name || '%'
                THEN a.abbreviation
                WHEN a.name IS NOT NULL AND o.selection_label ILIKE a.name || '%'
                THEN h.abbreviation END AS opponent_abbr
      FROM odds_markets o
      JOIN matches m ON m.id = o.match_id
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE o.is_current AND o.market_scope = 'match'
       -- GAME MARKETS ONLY. market_scope='match' also carries player props -
       -- the first dry run emitted "Jayden Reed Over +3.5", which is a prop
       -- line wearing a game-line headline and names no club at all. Props are
       -- their own lane if they are ever one.
       AND o.market_type IN ('spread', 'h2h', 'total')
       AND o.movement_24h_prob IS NOT NULL
       AND abs(o.movement_24h_prob) >= ${threshold}
       AND m.status = 'scheduled'
     -- ONE ROW PER MATCH+MARKET. Both sides of a two-way market move together
     -- and share a dedupe key, so emitting both would insert one and silently
     -- drop the other - a coin flip over which side the headline names. The
     -- larger absolute move wins, which is the side that actually moved.
     ORDER BY o.match_id, o.market_type, abs(o.movement_24h_prob) DESC
     LIMIT 200`;
  return toRows(rows, { now });
}
