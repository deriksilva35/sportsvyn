// lib/gridiron/liveLabel.js - "Live · Q3 7:22", in one place.
//
// PURE, AND ON ITS OWN so a module that only needs the words does not have to
// import a file full of database reads to get them. lib/gridiron/todayReads.js
// re-exports it, which is how every existing caller keeps working.

import { shortOf } from '../live/vocabulary.js';

/**
 * The live label a card shows: "Live · Q3 7:22", "Live · HT", "Live · OT
 * 2:11", plain "Live", or null.
 *
 * THE PERIOD CODE COMES FROM shortOf(), NOT FROM `Q${period}`. This function
 * used to interpolate the raw integer, which is right for four quarters and
 * wrong either side of them: halftime read "Q2 00:00" and overtime read "Q5".
 * shortOf (lib/live/vocabulary.js) is the derivation every other live surface
 * already goes through - the Pick'em v2 row, the line score, the Live Activity
 * state - so a Weekly slot now says what the scoreboard says instead of
 * carrying a second opinion about the same live_state.
 *
 * NO CLOCK AT HALFTIME. "HT 00:00" states the same fact twice and the second
 * statement is a stopped clock, which reads as broken.
 */
export function liveLabelOf(status, metadata) {
  if (status !== 'live') return null;
  const live = metadata?.live_state ?? null;
  const short = shortOf(live);
  if (!short) return 'Live';
  const clock = short === 'HT' ? null : (live?.clock ?? null);
  return `Live · ${short}${clock ? ` ${clock}` : ''}`;
}

/** The two halves apart, for a caller that lays them out itself. */
export function livePartsOf(status, metadata) {
  if (status !== 'live') return { period: null, clock: null };
  const live = metadata?.live_state ?? null;
  const short = shortOf(live);
  return { period: short, clock: short === 'HT' ? null : (live?.clock ?? null) };
}
