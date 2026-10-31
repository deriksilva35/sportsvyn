// lib/scores/featured.js - which game the landscape board features, and why. PURE.
//
// The pick, in the order the design gives it:
//   1. signed in: the FIRST game of inYourGamesBlock (lib/widget/shape.js) -
//      the reader's stake games, live first, then by kickoff;
//   2. else the first live game on the day;
//   3. else nothing: the board renders no card rather than inventing one.
//
// THE STAKES COME FROM WHAT scoresV2 ALREADY READ (extras.get(id).stake). The
// widget's other stake sources - series, october, run, six and the draft - need
// readLineups/readDraftRows (about ten queries on the widget feed); this board
// does not add them, so those labels exist below but only fire if a caller
// hands `lineups` in. Today the scores page does not, so a pick comes from
// Pick'em or the Weekly.

import { inYourGamesBlock } from '../widget/shape.js';

/** The eyebrow words for a stake kind (a row's `via` entry). Hyphens only. */
export const VIA_LABEL = Object.freeze({
  weekly: 'IN YOUR WEEKLY',
  draft: 'IN YOUR DRAFT',
  pickem: 'YOUR PICK',
  series: 'IN YOUR GAMES',
  october: 'IN YOUR GAMES',
  run: 'IN YOUR GAMES',
  six: 'IN YOUR GAMES',
});

// WHICH KIND NAMES THE CARD when a game carries several: the most specific
// stake first (a Weekly player or a draft seat), the single pick after them.
const VIA_PRIORITY = ['weekly', 'draft', 'pickem', 'series', 'october', 'run', 'six'];

export function viaLabel(via = []) {
  const k = VIA_PRIORITY.find((x) => via.includes(x));
  return k ? VIA_LABEL[k] : 'IN YOUR GAMES';
}

/**
 * @param games   the day's games (scoresV2 dayGames)
 * @param extras  Map(gameId -> extras), as scoresV2 builds it
 * @returns { g, x, label, via } | null
 */
export function pickFeatured({ games = [], extras = new Map(), signedIn = false, now = new Date(), lineups = {} } = {}) {
  if (signedIn) {
    const stakes = new Map();
    for (const g of games) { const s = extras.get(g.id)?.stake; if (s) stakes.set(g.id, s); }
    const [row] = inYourGamesBlock(games, stakes, now, lineups);
    if (row) {
      const g = games.find((x) => x.id === row.gameId);
      if (g) return { g, x: extras.get(g.id) ?? {}, label: viaLabel(row.via), via: row.via };
    }
  }
  const live = games.find((g) => g.status === 'live');
  return live ? { g: live, x: extras.get(live.id) ?? {}, label: 'LIVE NOW', via: [] } : null;
}
