// lib/pickem/dayGroups.js - the Pick'em board's day sections, PURE.
//
// THE DAY HEADINGS ARE THE READER'S DAYS (sun-16 item B). They used to be the
// games' ET calendar days, on the argument that "Sunday" is a property of the
// schedule. On screen it was not: every row under the heading prints its time
// in the reader's zone, so a London reader saw a "12:20 AM" game filed under
// "Sunday" when for them it was Monday morning - the heading and the row
// beneath it disagreeing about the day. A heading is display, so it follows the
// rows: the same zone (useViewerZone), the same formatter (lib/time/display).
//
// NOTHING ON THIS BOARD IS A RULE OF THE ET DAY. Each game locks at its own
// kickoff (an instant, not a day); the week a football board covers and the
// day an NBA board covers are decided at creation (lib/pickem/create.js,
// lib/nba/dayPickem.js) and only NAMED here - the NBA board's own name,
// dayLabel(contest.dayEt) in the header, stays its ET sports day, because that
// is which board it is, not when anything happens.

import { dayKeyIn, weekdayLong } from '../time/display.js';

/**
 * Games grouped by their kickoff's calendar day IN THE READER'S ZONE, in the
 * order the games already come in (kickoff order, lib/pickem/entry.js
 * gameRows()). Each group also carries whether every game in it shares one
 * lock instant ('lock {local}') or not ('lock per game').
 *
 * tz under lib/time/display.js's contract: null = the labelled ET fallback
 * (the server's first paint with no sv_tz), a string = that zone.
 */
export function groupByLockDay(games, tz) {
  const groups = [];
  const byKey = new Map();
  for (const g of games) {
    const key = dayKeyIn(g.kickoff_at, { tz });
    if (!byKey.has(key)) {
      const group = { key, label: weekdayLong(g.kickoff_at, { tz }), games: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).games.push(g);
  }
  for (const group of groups) {
    const first = group.games[0].kickoff_at;
    group.sameLock = group.games.every((g) => g.kickoff_at === first);
    group.lockAt = group.sameLock ? first : null;
  }
  return groups;
}
