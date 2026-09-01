// lib/live/scoreEvent.js — the Wire's score event. PURE.
//
// THE POLLER SEES THESE FIRST, WHICH IS THE WHOLE POINT OF IT EXISTING. A
// five-minute cron cannot emit "SEA 14, NE 10 · Q2 8:41" and have it still be
// true. At thirty seconds it can, and next relay these are what alerts
// subscribe to.

import { wireKey } from '../wire/hash.js';

/** "SEA 14, NE 10 · Q2 8:41" - away first, the way a scoreboard reads. */
// NULL IS REJECTED BEFORE Number() SEES IT, and this is not defensive noise.
// Number(null) is 0, not NaN, so a missing score would pass a finite check and
// render "NE 0, SEA 14" - a scoreline we invented, emitted to the Wire as an
// event, deduped on those very numbers and therefore never corrected. Both
// feeds leave the score null for stretches of a live game, so this is the
// ordinary case and not an edge one.
const points = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function scoreHeadline({ awayAbbr, awayScore, homeAbbr, homeScore, liveState }) {
  if (!awayAbbr || !homeAbbr) return null;
  if (points(awayScore) == null || points(homeScore) == null) return null;
  const line = `${awayAbbr} ${points(awayScore)}, ${homeAbbr} ${points(homeScore)}`;
  const p = liveState?.period, c = liveState?.clock;
  // The clock qualifies the score and is dropped whole when absent, never
  // rendered as a half-fact.
  return p && c ? `${line} · Q${p} ${c}` : line;
}

/**
 * ONE EVENT PER SCORE STATE, EVER.
 *
 * The key is the match and the two scores, so a poll that sees the same
 * scoreline again - which at 30s is most polls - collides on the dedupe_hash
 * and writes nothing. The CLOCK IS NOT IN THE KEY, deliberately: it moves every
 * second, and keying on it would emit an event per poll for a score that had
 * not changed, which is exactly the flood this key exists to prevent. The clock
 * still rides the headline, so the event says when the score happened.
 *
 * A SAFETY SCORED AT 14-10 AFTER A 14-10 EARLIER IN THE GAME cannot happen -
 * football scores are monotonic, so a repeated pair is always the same state.
 */
export function scoreEventKey(matchId, homeScore, awayScore) {
  return wireKey('score', matchId, homeScore, awayScore);
}

export function toScoreRow(m, liveState) {
  const headline = scoreHeadline({
    awayAbbr: m.away_abbr, awayScore: m.away_score,
    homeAbbr: m.home_abbr, homeScore: m.home_score, liveState,
  });
  if (!headline) return null;
  return {
    league_id: m.league_id,
    team_ids: [m.home_team_id, m.away_team_id].filter(Boolean),
    lane: 'score',
    headline,
    url: `/${m.league_slug}/game/${m.slug}`,
    source: 'Sportsvyn',
    // The moment WE saw it. The providers send no observation timestamp on
    // either feed - measured, both payloads - so claiming one would be an
    // invention. The latency instrument records the gap it can actually see.
    published_at: m.seen_at ?? null,
    dedupe_hash: scoreEventKey(m.id, m.home_score, m.away_score),
    payload: {
      matchId: m.id, homeScore: m.home_score, awayScore: m.away_score,
      liveState: liveState ?? null,
    },
  };
}
