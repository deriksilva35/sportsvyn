// lib/leagues/gameTypes.js - the games a player league can be built from.
// PURE and client-safe.
//
// REGISTERED NOW, USED BY LEAGUES V1 LATER. Survivor ships before the league
// builder does, so its key is written down here first: the builder's game
// picker, the standings deriver and survivor_pools.league_id (migration 118)
// all name a game by these keys, and a key that exists in one place only is a
// key two places will spell differently.

export const LEAGUE_GAME_TYPES = Object.freeze([
  { key: 'pickem', label: "Pick'em", sports: ['nfl', 'cfb'] },
  { key: 'weekly', label: 'The Weekly', sports: ['nfl'] },
  { key: 'survivor', label: 'Survivor', sports: ['nfl'] },
  { key: 'draft', label: 'The Draft', sports: ['nfl'] },
  { key: 'daily', label: 'The Daily', sports: [] },
  { key: 'october', label: 'October', sports: ['mlb'] },
  { key: 'run', label: 'The Run', sports: ['mlb'] },
]);

export const LEAGUE_GAME_KEYS = Object.freeze(LEAGUE_GAME_TYPES.map((g) => g.key));

/** @returns {boolean} */
export const isLeagueGame = (key) => LEAGUE_GAME_KEYS.includes(key);
