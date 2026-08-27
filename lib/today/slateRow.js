// lib/today/slateRow.js - what a game row SAYS, decided once.
//
// ONE LIVE DECISION-MAKER, TWO PRESENTATIONS. TodaysGames renders a compact
// three-column row; the Today band's week slate renders the mock's srow
// grammar. Both have to answer the same questions - is it live, is it final,
// what does the WHEN column read, who won, is it an exhibition - and answering
// them twice is how the two drift until a game is LIVE in one place and
// scheduled in the other on the same screen.
//
// So the decisions live here, pure, and the components only lay them out.
//
// THE WHEN COLUMN CARRIES ONE FACT AT A TIME, which is TodaysGames' rule and
// is kept: the kickoff before the game, the live marker during it, FINAL
// after. A time next to a finished game is noise; a score next to a game that
// has not kicked off is a lie.

const ET = 'America/New_York';

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, hour: 'numeric', minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short' });

// NULL-SAFE, because Intl throws on an invalid date and a row is not worth a
// page. matches.kickoff_at is nullable - a TBD fixture carries no time - and
// formatting undefined threw "Invalid time value" out of rowState, which would
// have taken down the whole band rather than one line of it.
const fmt = (f, d) => {
  if (d == null) return null;
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? f.format(t) : null;
};
export const kickoffTime = (d) => {
  const v = fmt(TIME, d);
  return v == null ? null : v.replace(' ', '').toLowerCase();
};
export const kickoffDay = (d) => fmt(DAY, d);

/**
 * The state of one game, as the row needs it.
 *
 * `played` is live OR final - the two states in which a score is a fact rather
 * than a guess, and the single flag both renderers use to decide whether to
 * print numbers at all.
 */
export function rowState(g) {
  const final = g?.status === 'final';
  const live = g?.status === 'live';
  const played = final || live;
  const homeWin = final && g.homeScore > g.awayScore;
  const awayWin = final && g.awayScore > g.homeScore;
  return {
    live, final, played, homeWin, awayWin,
    // The exclusion law governs ordering, not visibility: an exhibition shows,
    // badged, exactly as it does on /scores.
    isPreseason: g?.seasonPhase === 'PRE',
    // TBD rather than a blank when there is no kickoff to state.
    when: live ? 'LIVE' : final ? 'FINAL' : (kickoffTime(g?.kickoffAt) ?? 'TBD'),
    day: kickoffDay(g?.kickoffAt),
  };
}

/**
 * Slate order: LIVE first, then what has not kicked off by kickoff, then the
 * finals with their scores at the bottom.
 *
 * A reader scanning this module wants, in order: what is on now, what is next,
 * what happened. Sorting purely by kickoff would bury a live game under a
 * morning's worth of completed ones.
 */
export function orderSlate(games = []) {
  const bucket = (g) => (g.status === 'live' ? 0 : g.status === 'final' ? 2 : 1);
  return [...games].sort((a, b) => {
    const ba = bucket(a), bb = bucket(b);
    if (ba !== bb) return ba - bb;
    const ka = new Date(a.kickoffAt).getTime();
    const kb = new Date(b.kickoffAt).getTime();
    // Finals read newest-first; everything else soonest-first.
    return ba === 2 ? kb - ka : ka - kb;
  });
}

/** The module shows at most this many, then points at the full scoreboard. */
export const SLATE_ROW_CAP = 6;
