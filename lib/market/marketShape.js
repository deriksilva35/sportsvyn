// lib/market/marketShape.js - the pure half of reads.js (static /market):
// the league list and the movers predicate, with no database import.

export const MARKET_LEAGUES = Object.freeze(['cfb', 'nfl', 'epl']);

// Soccer prices the draw. Gridiron does not, and the difference is structural
// rather than cosmetic - it decides how many rows a card's h2h block has and
// which de-vig the ingest had to use.
export const THREE_WAY = Object.freeze(['epl']);

/**
 * MOVERS ONLY. Any selection on the card whose 24h probability move is
 * non-zero. NULL is not zero - a market with no baseline yet has not been
 * observed to hold still, it has not been observed at all.
 */
export function hasMovement(card) {
  return [...card.h2h, ...card.spread, ...card.total]
    .some((s) => s.moveProb != null && Math.abs(s.moveProb) > 0);
}
