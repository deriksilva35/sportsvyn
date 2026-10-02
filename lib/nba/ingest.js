// lib/nba/ingest.js - one BDL NBA game row -> the things we own. PURE.
//
// ONE SHAPE, TWO ROUTES. /nba/v1/games and /nba/v1/box_scores/live carry the
// same game fields (id, date, datetime, status, status_state, period, time,
// postseason, both scores, q1-q4 / ot1-ot3 per side, timeouts_remaining,
// in_bonus); the live route adds each side's players[]. Measured 1 Oct 2026.
//
// STATUS IS status_state, THE MACHINE FIELD. `status` is prose: on a scheduled
// row it is the tip datetime ("2026-10-20T19:00:00Z"), on a final "Final".
// mapLiveStatus counts an unknown token and writes nothing.
//
// THE CLOCK IS parseNbaLive's AND NOTHING ELSE'S. Its in-progress spelling has
// never been observed (first live game 20 Oct; preseason is not in the feed),
// so a `time` it cannot read leaves the chip empty and is RECORDED in the
// unmapped list as `nba-time:<string>` - visible in the poller's journal and
// its window ledger, never guessed.
//
// THE TIP IS `datetime`, already UTC 'Z'. `date` is the American calendar day
// the game is filed under (a 01:30Z tip on the 21st is dated the 20th), which
// is what the slug takes.

import { mapLiveStatus, parseNbaLive } from '../live/vocabulary.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** PURE. The game's line score: [{ period, home, away }] for every period played or begun. */
export function nbaLineScore(row) {
  const keys = ['q1', 'q2', 'q3', 'q4', 'ot1', 'ot2', 'ot3'];
  const out = [];
  keys.forEach((k, i) => {
    const h = num(row?.[`home_${k}`]); const a = num(row?.[`visitor_${k}`]);
    if (h == null && a == null) return;
    out.push({ period: i + 1, home: h, away: a });
  });
  return out;
}

/**
 * PURE. The metadata.detail keys the poller writes for an NBA game: the line
 * score, timeouts left and whether each side is in the bonus. Null when the
 * row says nothing (a scheduled game has no line yet), so the writer is not
 * asked to write an empty object.
 *
 * NESTED UNDER detail, NOT TOP-LEVEL, and the writer merges it one level down
 * (lib/nba/detail.js), so final_seen_at - written into the same object by
 * lib/live/write.js - survives every poll.
 */
export function nbaDetailOf(row) {
  const lineScore = nbaLineScore(row);
  const timeouts = { home: num(row?.home_timeouts_remaining), away: num(row?.visitor_timeouts_remaining) };
  const bonus = {
    home: typeof row?.home_in_bonus === 'boolean' ? row.home_in_bonus : null,
    away: typeof row?.visitor_in_bonus === 'boolean' ? row.visitor_in_bonus : null,
  };
  const has = lineScore.length || timeouts.home != null || timeouts.away != null || bonus.home != null || bonus.away != null;
  if (!has) return null;
  return { line_score: lineScore, timeouts, bonus };
}

/** PURE. The row -> status, scores, live state, and what scheduling needs. */
export function fromBdlNba(row, unmapped) {
  const status = mapLiveStatus('bdl', row?.status_state, unmapped);
  let liveState = null;
  if (status === 'live') {
    liveState = parseNbaLive(row?.period, row?.time);
    if (!liveState && Array.isArray(unmapped)) unmapped.push(`nba-time:${row?.period ?? '?'}/${row?.time ?? '(none)'}`);
  }
  return {
    providerId: row?.id == null ? null : String(row.id),
    status,
    homeScore: num(row?.home_team_score),
    awayScore: num(row?.visitor_team_score),
    liveState,
    kickoffAt: row?.datetime ?? null,
    day: /^\d{4}-\d{2}-\d{2}/.test(String(row?.date ?? '')) ? String(row.date).slice(0, 10) : null,
    seasonYear: num(row?.season),
    seasonPhase: row?.postseason === true ? 'POST' : (row?.postseason === false ? 'REG' : null),
    istStage: row?.ist_stage ?? null,
    period: num(row?.period),
  };
}
