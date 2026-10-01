// lib/mlb/status.js - match statuses that mean "this game will not be played".
//
// 'cancelled' is the provider's word (or the resync's, when the feed drops a
// game); 'not_needed' is ours, for a decided series' leftovers
// (lib/mlb/notNeeded.js, migration 120). Every reader that draws a game, opens
// a card on it, offers its players or prices it skips both. PURE.
export const NOT_PLAYED = Object.freeze(['cancelled', 'not_needed']);
export const isNotPlayed = (status) => NOT_PLAYED.includes(String(status ?? ''));
