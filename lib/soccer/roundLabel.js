// lib/soccer/roundLabel.js - THE TWO NAMES FOR AN EPL ROUND, one source each
// (ruling thu-36). PURE and client-safe.
//
//   Matchweek N   the football surfaces: /scores, the EPL match pages,
//                 /epl/standings, the league-week crumbs.
//   Gameweek N    inside EPL Weekly 5 (room, live, final, the /games row,
//   GW N          boards, push copy) - the fantasy game's own word.
//
// Every surface prints its round through ONE of these and never spells the word
// itself, so the two cannot drift into each other: lib/soccer/roundLabel.test.mjs
// walks the files and fails on a hand-typed "Matchweek " or "Gameweek ".

export const matchweekLabel = (n) => (n == null || n === '' ? null : `Matchweek ${n}`);
export const gameweekLabel = (n) => (n == null || n === '' ? null : `Gameweek ${n}`);
export const gameweekShort = (n) => (n == null || n === '' ? null : `GW ${n}`);
