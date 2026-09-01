// lib/gridiron/kickoff.js — when a game is, said once. PURE: no JSX, no
// database, no clock of its own, and no timezone of its own either.
//
// THE ZONE IS ALWAYS AN ARGUMENT, NEVER A DEFAULT HIDDEN IN HERE. Every
// formatter in this file takes `tz` and does what it is told. A module that
// quietly fell back to America/New_York would put the old bug back one call
// site at a time: a reader in Denver seeing "5:20 PM" for a game that starts at
// 3:20 their time, with nothing on the card admitting which zone it meant.
//
// WHAT A PRE-GAME CARD SAYS. "Thu Sep 10 · 5:20 PM" - day of week, date, time.
// The day of week is the part a reader actually navigates by ("is that the
// Thursday game?"), and it was the part the card did not have: a bare "5:20 PM"
// on a list spanning Thursday to Monday is a time with no day attached, which
// on a week-unit list is not a fact anybody can use.

const cache = new Map();
function fmt(tz, opts) {
  const key = `${tz}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }); cache.set(key, f); }
  return f;
}

// NULL AND '' ARE REJECTED BEFORE new Date() SEES THEM, and this is not
// defensive noise. `new Date(null)` is not an invalid date - it is the EPOCH,
// so a game with no kickoff would come back as a perfectly valid 31 Dec 1969
// and be filed under a 1969 day header at the TOP of the slate, sorted there by
// a comparator doing exactly what it was told. Caught by the test for the
// missing-kickoff case, which is the only reason it is not in production.
const asDate = (iso) => {
  if (iso == null || iso === '') return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The two halves of a kickoff, in `tz`, or null.
 *
 * TWO PIECES RATHER THAN ONE STRING because the card needs to style them
 * differently and, on a grouped list, needs to DROP the day - a day header that
 * says "Thursday · Sep 10" over cards that each repeat "Thu Sep 10" is the same
 * fact three times on one screen.
 */
export function kickoffParts(iso, tz) {
  const d = asDate(iso);
  if (!d || !tz) return null;
  try {
    return {
      day: fmt(tz, { weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(/,/g, ''),
      time: fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(d),
    };
  } catch { return null; }
}

/** "Thu Sep 10 · 5:20 PM", the pre-game card's grammar. */
export function kickoffLabel(iso, tz) {
  const p = kickoffParts(iso, tz);
  return p ? `${p.day} · ${p.time}` : null;
}

/**
 * The calendar day a kickoff falls on IN `tz` - "2026-09-10".
 *
 * IT IS NOT iso.slice(0,10). A 8:20pm Eastern Thursday kickoff is 00:20 UTC on
 * FRIDAY, so slicing the ISO string puts every Thursday night game under a
 * Friday header - and for a reader west of UTC the error runs the other way.
 * The day a game belongs to is the day it is in the reader's zone, which is a
 * formatting question, not a string question.
 */
export function dayKey(iso, tz) {
  const d = asDate(iso);
  if (!d || !tz) return null;
  try {
    const p = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return null; }
}

/** "Thursday · Sep 10" - the day header's grammar, spelled out in full. */
export function dayHeading(iso, tz) {
  const d = asDate(iso);
  if (!d || !tz) return null;
  try {
    const weekday = fmt(tz, { weekday: 'long' }).format(d);
    const date = fmt(tz, { month: 'short', day: 'numeric' }).format(d).replace(/,/g, '');
    return `${weekday} · ${date}`;
  } catch { return null; }
}

// LIVE FIRST WITHIN THE DAY, then by kickoff. The same priority scoresSlice
// uses across the whole list, applied inside each day: a game in progress is
// why somebody opened the screen, and a Sunday header with a live game under it
// should show that game first even though four earlier kickoffs have finished.
const BAND = { live: 0, scheduled: 1, final: 2 };

/**
 * Group a slate into ordered days.
 *
 * A GAME WITH NO USABLE KICKOFF IS NOT DROPPED. It lands in a null-key group at
 * the end, because a game we cannot place in time is still a game on the slate,
 * and vanishing is the one behaviour a scoreboard must never have.
 */
export function groupByDay(games, tz) {
  const out = new Map();
  for (const g of games ?? []) {
    const key = dayKey(g?.kickoffAt, tz);
    if (!out.has(key)) {
      out.set(key, { key, heading: key ? dayHeading(g?.kickoffAt, tz) : null, games: [] });
    }
    out.get(key).games.push(g);
  }
  for (const grp of out.values()) {
    grp.games.sort((a, b) => {
      const ba = BAND[a?.status] ?? 1, bb = BAND[b?.status] ?? 1;
      if (ba !== bb) return ba - bb;
      return new Date(a?.kickoffAt ?? 0) - new Date(b?.kickoffAt ?? 0);
    });
  }
  return [...out.values()].sort((a, b) => {
    if (a.key === b.key) return 0;
    if (a.key == null) return 1;
    if (b.key == null) return -1;
    return a.key < b.key ? -1 : 1;
  });
}

/**
 * Does this list span more than one day? The question the day headers and the
 * "Today" / "This week" eyebrow both actually turn on.
 *
 * COUNTED FROM THE GAMES, NOT ASSUMED FROM THE LEAGUE. The landing called
 * itself "Today" whenever the league's unit was the day - CFB - while being
 * handed the whole week's slate, so a CFB landing said "Today" over games four
 * days apart. The unit is a statement about the schedule; this is a statement
 * about what is on the screen, and only the second one can honestly title it.
 */
export function spansMultipleDays(games, tz) {
  const seen = new Set();
  for (const g of games ?? []) {
    const k = dayKey(g?.kickoffAt, tz);
    if (k) seen.add(k);
    if (seen.size > 1) return true;
  }
  return false;
}
