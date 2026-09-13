// lib/weekly/slotState.js - WHAT ONE LINEUP SLOT SAYS RIGHT NOW. PURE.
//
// THE RULE HAS ONE DEFINITION AND THREE READERS: the Today tab's Weekly hero,
// the Weekly room's six rows, and the Draft card's eight. It used to have one
// reader and lived inside its JSX, which is why the other two surfaces showed
// a name and nothing else while the games were on.
//
// THE PAIR IT READS is the same pair the Today tab has always read: a row from
// liveEntryRows (id, name, team, points, played) and the player's GAME from
// the week's slate, matched on team abbreviation - the same join
// stakeForMatches performs. Neither half alone is enough:
//
//   points without the game  - a 0 beside a man who has not kicked off is not
//                              a low score, it is a wrong one.
//   the game without points  - "Q3 7:22" and no number is the four days of
//                              "trust us, something is happening" this whole
//                              live layer exists to end.
//
// NOT STARTED IS A WORD, NOT A ZERO. `points` comes back null until the game
// is under way, so a caller cannot accidentally print a zero it was handed.
// A player on a bye - or any player whose team has no game in this week's
// slate - is 'bye', which is a different fact from "has not kicked off yet"
// and must not borrow its kickoff line.
//
// THE NUMBER ITSELF IS NEVER COMPUTED HERE. It arrives on the row, from
// liveEntryRows -> poolWithScores -> lib/fantasy/scoring.js fantasyPoints.
// There is exactly one scorer in this product and this module is not a second
// one - it decides what to SHOW, never what a player is worth.

import { liveLabelOf } from '../gridiron/liveLabel.js';

/**
 * @param {object} a
 * @param {object} a.row   one liveEntryRows row: {slot,id,name,team,points,played}
 * @param {object} a.game  {status, metadata, kickoffAt} from the week's slate, or null
 * @returns {{kind, label, started, points, kickoffAt, counting}}
 *   kind      'empty' | 'bye' | 'scheduled' | 'live' | 'final'
 *   label     the short game state ('final', 'Q3 7:22') or null
 *   started   whether a number belongs on this row at all
 *   points    the number, or null when nothing has happened yet
 *   kickoffAt the iso to print when there is no number yet, or null
 */
export function slotState({ row = null, game = null } = {}) {
  const base = { kind: 'empty', label: null, started: false, points: null, kickoffAt: null };
  if (!row || row.id == null) return base;

  // NO GAME IN THE WEEK'S SLATE IS A BYE. It is also what an unmatched team
  // abbreviation looks like, and the two are indistinguishable from here - so
  // the label says the honest thing either way and never invents a kickoff.
  if (!game) {
    // A player who somehow has points without a game keeps them: the stat rows
    // are the authority on whether he played, not our slate join.
    return row.played
      ? { kind: 'final', label: 'final', started: true, points: Number(row.points), kickoffAt: null }
      : { ...base, kind: 'bye', label: 'bye' };
  }

  const final = game.status === 'final';
  const live = game.status === 'live';

  if (final) {
    return { kind: 'final', label: 'final', started: true, points: Number(row.points), kickoffAt: null };
  }
  if (live) {
    // "Live · Q3 7:22" -> "Q3 7:22". The row already reads as live from its
    // own treatment; repeating the word costs the clock its space.
    const label = (liveLabelOf('live', game.metadata) ?? 'Live').replace(/^Live · /, '');
    return { kind: 'live', label, started: true, points: Number(row.points), kickoffAt: null };
  }
  // SCHEDULED, AND THE TWO HALVES CAN DISAGREE. A stat row for a game the
  // slate still calls scheduled is a provider fault - one of the two is stale,
  // and we cannot tell which from here. So each half answers only what it is
  // the authority on: the SLATE keeps the state (this row is not claimed as
  // final or live), and the STAT ROWS decide whether there is a number. What
  // is not printed is the kickoff, because a man with stats has kicked off
  // whatever the slate says, and a time beside a score is the one reading that
  // is certainly wrong.
  if (row.played) {
    return { kind: 'scheduled', label: null, started: true, points: Number(row.points), kickoffAt: null };
  }
  return { kind: 'scheduled', label: null, started: false, points: null, kickoffAt: game.kickoffAt ?? null };
}

/**
 * Every row's state at once, plus the total of the ones that have a number.
 *
 * THE HEADER TOTAL IS THE SUM OF WHAT IS SHOWN. liveEntryRows' own `total`
 * counts every slot including the not-yet-started ones (they are 0, so it
 * agrees) - but stating the rule this way means the number in the header can
 * always be checked against the rows under it, which is the property a reader
 * actually uses.
 */
export function slotStates({ rows = [], gamesByTeam = new Map() } = {}) {
  const out = rows.map((row) => ({
    row,
    state: slotState({ row, game: row?.team ? gamesByTeam.get(row.team) ?? null : null }),
  }));
  const total = Math.round(out.reduce((a, x) => a + (x.state.points ?? 0), 0) * 10) / 10;
  return {
    rows: out,
    total,
    startedCount: out.filter((x) => x.state.started).length,
    slots: out.filter((x) => x.row?.id != null).length,
  };
}

/**
 * THE SIX THAT COUNT, out of the Draft's eight.
 *
 * bestBall already chose them - liveEntryRows returns exactly those six as its
 * rows - so this does not re-decide anything, it just names the ids so the
 * card can mark them. Re-running the choice here would be the second
 * implementation, and it would be the one on screen.
 */
export function countingIds(liveRows = []) {
  return new Set(liveRows.map((r) => r?.id).filter((id) => id != null));
}
