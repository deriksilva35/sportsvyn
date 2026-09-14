// lib/house/personas.js - WHO THE HOUSE IS, AND WHAT EACH ONE CLAIMS TO DO.
//
// FIVE LABELLED ENTRIES, OPENLY THE HOUSE. Not filler, not padding, and never
// anonymous: every house row carries a marker and a method line beside the
// handle, so a reader who sees one on a leaderboard can tell in one glance
// that it is us and what rule produced it.
//
// A PERSONA THAT HAS NO METHOD ON A GAME DOES NOT ENTER IT (ruling R1). The
// honest version of "The Fade plays every game" is that The Fade has no
// opinion without a line, so it has no row on a board that has no lines. An
// absent row says that; a faked one says the opposite.
//
// THE BOOK IS NOT HERE YET (ruling R2). Its rule is "the model where one
// exists, the market where it does not", and there is no gridiron model: the
// only fitted one in the tree is a Davidson three-outcome fit on World Cup
// soccer, and the two gridiron power lists carry one preseason edition each
// from 27 July. Shipping it today would file the same entry as The Chalk and
// call one of them a model. Its handle is reserved so nobody takes it.

/** The four that ship. The Book joins when a gridiron model exists. */
export const PERSONAS = Object.freeze([
  {
    key: 'chalk',
    handle: 'The_Chalk',
    name: 'The Chalk',
    blurb: 'Takes the obvious one, every time.',
    // THE CHALK DOES NOT PLAY THE DAILY. Measured over the six boards
    // that existed when this was built, the obvious pick at every slot
    // scored 99.5% and was the outright optimum on three of them - the
    // one-player-per-team constraint almost never binds on a twelve-card
    // board, so "the chalk" there is not a strategy, it is the answer
    // key. A house entry that wins every day is not a persona a reader
    // can play against, so it has no row, the same as The Fade's.
    plays: Object.freeze(['pickem', 'weekly', 'draft']),
    method: Object.freeze({
      pickem: 'The favorite on every priced game.',
      // RULING R3: it is career PPG, and the line says career PPG. There is
      // no projection in this product today, and calling PPG one would be the
      // method line lying about the method. When the projection relay lands,
      // this string changes and nothing else does.
      weekly: 'Highest career PPG at every slot.',
      draft: 'Best available by ADP, every pick.',
    }),
  },
  {
    key: 'fade',
    handle: 'The_Fade',
    name: 'The Fade',
    blurb: 'Takes the underdog, inside the number.',
    // RULING R1: no line on the Daily's board and no line on a Weekly slot,
    // so The Fade has nothing to be contrarian about on either.
    plays: Object.freeze(['pickem', 'draft']),
    method: Object.freeze({
      // RULING R5: an unpriced game is skipped, not guessed. The board then
      // shows fewer picks than everybody else's, which is the truth.
      pickem: 'The underdog on priced games inside FADE_MAX points. Unpriced games are skipped.',
      draft: 'The player the room is sliding, not the one it is reaching for.',
    }),
  },
  {
    key: 'gut',
    handle: 'The_Gut',
    name: 'The Gut',
    blurb: 'Noisy on purpose.',
    plays: Object.freeze(['daily', 'pickem', 'weekly', 'draft']),
    method: Object.freeze({
      daily: 'Weighted random over the top tier at every slot.',
      pickem: 'Weighted random, favourite-leaning, on every priced game.',
      weekly: 'Weighted random over the top tier at every slot.',
      draft: 'Weighted random over the top tier on the board.',
    }),
  },
  {
    key: 'homer',
    handle: 'The_Homer',
    name: 'The Homer',
    blurb: 'Backs the same teams, always.',
    plays: Object.freeze(['daily', 'pickem', 'weekly', 'draft']),
    method: Object.freeze({
      // RULING R1: Homer plays the Daily when its teams are among the twelve,
      // takes its own where present and the chalk elsewhere - and says so,
      // because a reader watching it take a Chief in a week with no Chiefs
      // card deserves to know which half of the rule produced that.
      daily: 'Its own teams where the board has them, the chalk everywhere else.',
      pickem: 'Its own teams, always, whatever the number says.',
      weekly: 'Its own teams first, the chalk to fill the rest.',
      draft: 'Its own teams first, best available to fill the rest.',
    }),
  },
]);

/** Reserved now, shipped later (ruling R2). */
export const PARKED = Object.freeze([
  { key: 'book', handle: 'The_Book', name: 'The Book' },
]);

/** Every handle the house owns, shipped or parked - the reserve list. */
export const HOUSE_HANDLES = Object.freeze(
  [...PERSONAS, ...PARKED].map((p) => p.handle),
);

export const PERSONA_BY_KEY = Object.freeze(
  Object.fromEntries(PERSONAS.map((p) => [p.key, p])),
);

/**
 * THE HOMER'S TEAMS. A fixed set, by abbreviation, and fixed is the point -
 * a homer that changes its mind is not a homer. Two from each conference so
 * a Pick'em board rarely leaves it with nothing, and so the set is not a
 * one-city joke nobody outside that city reads.
 */
export const HOMER_TEAMS = Object.freeze(['KC', 'GB', 'DAL', 'BUF']);

/** How far from pick-em The Fade will still take a dog. Points. */
export const FADE_MAX = 7;

/** Does this persona have a method on this game at all? */
export function playsGame(personaKey, game) {
  const p = PERSONA_BY_KEY[personaKey];
  return Boolean(p && p.plays.includes(game));
}

/**
 * The method line a leaderboard prints beside the handle, for the game whose
 * board the reader is looking at.
 * @returns {string|null} null when this persona does not play that game
 */
export function methodLine(personaKey, game) {
  const p = PERSONA_BY_KEY[personaKey];
  if (!p || !p.plays.includes(game)) return null;
  const line = p.method[game] ?? null;
  return line ? line.replace('FADE_MAX', String(FADE_MAX)) : null;
}

const BY_HANDLE = new Map([...PERSONAS, ...PARKED].map((p) => [p.handle.toLowerCase(), p]));

/** The persona behind a handle, or null. Case-insensitive, @ tolerated. */
export function personaByHandle(handle) {
  const h = String(handle ?? '').replace(/^@/, '').toLowerCase();
  return BY_HANDLE.get(h) ?? null;
}
