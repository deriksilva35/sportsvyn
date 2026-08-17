// lib/games/lobby.js - the games lobby's view. PURE.
//
// THE STANDINGS LAW APPLIES TO EVERY NUMBER ON THIS PAGE. /games is the
// arcade's front door and it aggregates four games at once, which makes it the
// single most likely place for an open-day result to leak by accident. So the
// rule is stated once here and enforced by construction: every figure on every
// pane comes from a day that has REVEALED or a contest that has SETTLED, with
// exactly one exception - the viewer's own state in the game they are playing
// right now, which is theirs to know.
//
// CARD STATE COMES FROM DATA, NEVER FROM A DEPLOY. A game is ghosted because no
// contest exists for it yet, and it goes live the moment one does. Nothing here
// reads a date and decides Pick 'em has started; it reads whether Pick 'em has
// a board. That is what lets Aug 25 and Sep 8 happen without a release.

export const GAME_ORDER = ['daily', 'pickem', 'weekly', 'draft'];

export const GAME_META = {
  daily:  { key: 'daily',  name: 'The Daily',  href: '/daily',  blurb: 'One board. Six slots. Three minutes.' },
  pickem: { key: 'pickem', name: 'Pick ’em', href: '/pickem', blurb: 'Call the winners. NFL and college.' },
  weekly: { key: 'weekly', name: 'The Weekly', href: '/weekly', blurb: 'One lineup a week, from the real slate.' },
  draft:  { key: 'draft',  name: 'The Draft',  href: '/draft',  blurb: 'Six rounds against the room.' },
};

export const PANES = ['games', 'leaderboards', 'answer', 'history'];
export const PANE_LABEL = {
  games: 'Games', leaderboards: 'Leaderboards', answer: 'Latest answer', history: 'History',
};
export const normalizePane = (p) => (PANES.includes(String(p)) ? String(p) : 'games');

/**
 * One card's state.
 *
 * GHOSTED IS AN HONEST STATE, not a placeholder: it carries the date the game
 * opens so the card says something true rather than teasing. It becomes live
 * when `contest` arrives, which is a data event.
 *
 * @param {object} a
 * @param {string} a.key
 * @param {object|null} a.contest  the open/current contest, or null
 * @param {object|null} a.mine     the viewer's own state in that game
 * @param {string|null} a.opensLabel  what to say while ghosted
 */
export function cardState({ key, contest = null, mine = null, opensLabel = null }) {
  const meta = GAME_META[key];
  if (!meta) return null;
  if (!contest) {
    return { ...meta, state: 'ghost', opensLabel: opensLabel ?? 'Coming soon', playable: false };
  }
  // The viewer's own state is the ONLY per-user thing a card may carry, and
  // only ever about themselves.
  const state = mine?.settled ? 'settled' : mine?.entered ? 'entered' : 'open';
  return {
    ...meta,
    state,
    playable: state !== 'settled',
    closesLabel: contest.closesLabel ?? null,
    // Never another player's anything.
    you: mine ? { score: mine.score ?? null, tier: mine.tier ?? null, streak: mine.streak ?? null } : null,
  };
}

/**
 * The signed-in reader's season line.
 * THROUGH-REVEALED ONLY, like every standing: it is the same numbers the
 * overall board is built from, so the two can never disagree on this page.
 */
export function seasonStrip({ handle = null, standing = null, pickem = null } = {}) {
  if (!standing && !pickem) return null;
  return {
    handle,
    points: standing?.points ?? 0,
    played: standing?.played ?? 0,
    daysPlayable: standing?.daysPlayable ?? 0,
    hof: standing?.hof ?? 0,
    mvp: standing?.mvp ?? 0,
    rank: standing?.rank ?? null,
    // Absent until Pick 'em has settled something - a 0-0 record on a game
    // nobody has played reads as a loss rather than as "not started".
    pickem: pickem ?? null,
  };
}

/**
 * A leaderboard section that has nothing to show yet says WHEN, not nothing.
 * An empty board with no explanation reads as broken; "populates after the
 * first settle" reads as early.
 */
export function boardSection({ key, name, table = null, populatesLabel = null }) {
  if (table?.top?.length) return { key, name, state: 'live', table };
  return { key, name, state: 'pending', populatesLabel: populatesLabel ?? 'Populates after the first settle' };
}
