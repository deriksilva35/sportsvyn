// lib/gridiron/recordsLoader.js — the record chips for a slate, in one place.
//
// TWO CALLERS, ONE READ. /scores and the league landings both draw the same
// card with the same chip on it, and both were about to resolve the season and
// call recordChipMap themselves. Two copies of a read is where the two
// surfaces start disagreeing about which season a record belongs to - and a
// record from the wrong season is not a smaller error than no record at all.
//
// THE SEASON IS RESOLVED HERE, ONCE, from the same resolver the pollers use.

import { recordChipMap } from '../standings/read.js';
import { resolveSeasonYear } from '../pollers/seasonResolver.js';

export async function loadRecordChips({ now = new Date() } = {}) {
  try {
    return await recordChipMap(resolveSeasonYear(new Date(now)));
  } catch {
    // A chip is decoration. A scoreboard must never fail to render because a
    // standings row is missing.
    return new Map();
  }
}
