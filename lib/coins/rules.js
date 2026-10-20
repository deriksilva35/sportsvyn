// lib/coins/rules.js - THE COIN METER'S RULES (Rules v0.1 s3-s5), PURE.
//
// Every number a player can be told lives here, once: the point table, the
// 100-point coin, the 10-coin week, the 10-entrant floor, the finish tiers and
// the default prize list. lib/coins/mint.js applies them to the database; the
// Drum page and the rules page print them.

export const POINTS = Object.freeze({
  firstPlay: 100, // first public game played in a week (any game): one coin on the spot
  settled: 25,    // each public contest completed and settled
  top25: 50,      // finish in the top 25%
  top10: 100,     // finish in the top 10%
  top3: 150,      // finish 1st, 2nd or 3rd
  win: 250,       // win a settled contest outright
  streak3: 50,    // play in 3 consecutive weeks (awarded at the third)
});
export const POINTS_PER_COIN = 100;
export const WEEK_CAP = 10;
export const MIN_ENTRANTS = 10;

/**
 * THE GAMES THAT EARN (s3): The Daily, The Weekly, The Draft (weekly),
 * Pick'em, The Run and October. "Each new public game Sportsvyn announces as
 * eligible" joins here from its week - NBA and EPL are named in the rules as
 * examples of games NOT yet announced, so the NBA day Pick'em, the Primetime
 * Draft (draft_game) and EPL Weekly 5 stay out until Derik announces them.
 */
export const ELIGIBLE = Object.freeze({
  weekly: null, // null = every sport
  draft: null,
  pickem: Object.freeze(['nfl', 'cfb', 'mlb']),
  run: null,
  october: null,
});
export const isEligibleContest = ({ game_type: g, sport }) =>
  Object.hasOwn(ELIGIBLE, g) && (ELIGIBLE[g] == null || ELIGIBLE[g].includes(String(sport)));

/**
 * THE FINISH (s3): ONE tier per contest, the best that applies - a winner is
 * also "top 3" and "top 10%", and is paid for the win, not for all four.
 * `rank` is the competition place (ties share it), `n` the scored field,
 * `atRank` how many share this place. Top 25% / 10% = place <= n x 25% / 10%.
 * -> { event, points } | null
 */
export function finishTier({ rank, n, atRank = 1 }) {
  if (!rank || !n || n < MIN_ENTRANTS) return null;
  if (rank === 1 && atRank === 1) return { event: 'win', points: POINTS.win };
  if (rank <= 3) return { event: 'top3', points: POINTS.top3 };
  if (rank * 10 <= n) return { event: 'top10', points: POINTS.top10 };
  if (rank * 4 <= n) return { event: 'top25', points: POINTS.top25 };
  return null;
}

/**
 * HOW MANY COINS TO MINT NOW (s3). The meter is cumulative: every point ever
 * earned, minus 100 for every coin ever minted, is progress; whole hundreds
 * mint, up to the week's cap. Points beyond the cap stay in the meter.
 */
export function mintQty({ totalPoints = 0, mintedEver = 0, mintedThisWeek = 0 }) {
  const progress = totalPoints - POINTS_PER_COIN * mintedEver;
  const whole = Math.max(0, Math.floor(progress / POINTS_PER_COIN));
  return Math.max(0, Math.min(whole, WEEK_CAP - mintedThisWeek));
}

/** The meter bar: points toward the next coin. */
export function meter({ totalPoints = 0, mintedEver = 0 }) {
  const progress = Math.max(0, totalPoints - POINTS_PER_COIN * mintedEver);
  const into = progress % POINTS_PER_COIN;
  return { into, toNext: POINTS_PER_COIN - into, banked: Math.floor(progress / POINTS_PER_COIN) };
}

/** The prizes a week posts when it opens (s5's typical week). */
export const DEFAULT_PRIZES = Object.freeze([
  Object.freeze({ prize_key: 'gc25', title: '$25 gift card', kind: 'gift_card', value_cents: 2500, count: 2 }),
  Object.freeze({ prize_key: 'gc10', title: '$10 gift card', kind: 'gift_card', value_cents: 1000, count: 5 }),
  Object.freeze({ prize_key: 'cap', title: 'Sportsvyn cap', kind: 'merch', value_cents: 2500, count: 1 }),
]);

/** s4: coins left in hand at the Close drop into the LOWEST-value drum (ties: most prizes, then key). */
export function lowestDrum(prizes = []) {
  return [...prizes].sort((a, b) => a.value_cents - b.value_cents || b.count - a.count || String(a.prize_key).localeCompare(String(b.prize_key)))[0] ?? null;
}

/** "about 1 in 107 per coin": all coins in a drum / prizes in it (s5). */
export function perCoinOdds({ coins = 0, count = 1 }) {
  if (!coins) return null;
  return Math.max(1, Math.round(coins / Math.max(1, count)));
}
