// lib/ratings/elo.js - the gridiron Elo ladder. PURE: no DB, no clock, no I/O.
//
// THERE WAS NO RATING IN THIS PRODUCT BEFORE THIS FILE. The recon is worth
// restating because it is the reason every constant below had to be chosen
// rather than inherited: `grep -rni "\belo\b"` over the whole repo returned
// nothing, lib/matchProbability.js is a Davidson three-outcome model for World
// Cup SOCCER that consumes a rating it does not produce, and the two gridiron
// boards carry a "score" that is literally 99.99 minus the rank. Nothing here
// is a port of anything.
//
// THE LADDER. Standard Elo with a home-field term and a margin-of-victory
// multiplier, applied to chronological finals, zero-sum per game:
//
//   E_home = 1 / (1 + 10 ^ ((elo_away - (elo_home + hfa)) / 400))
//   S_home = 1 win / 0.5 tie / 0 loss
//   delta  = k * mult * (S_home - E_home)
//   elo_home += delta ;  elo_away -= delta
//
// THE MARGIN MULTIPLIER - AND THIS IS A CHOICE I MADE, NOT A RULE I FOUND.
// The relay says "margin multiplier as ruled"; no such ruling exists anywhere
// in this repository, and I am not going to pretend I read one. This is the
// FiveThirtyEight NFL form, which is the standard for football Elo and the one
// every published implementation uses:
//
//   mult = ln(|margin| + 1) * (2.2 / (favouredDiff * 0.001 + 2.2))
//
// where favouredDiff is the WINNER's pre-game rating minus the LOSER's, home
// advantage already applied. Two properties are the whole point of it:
//   · ln(|margin|+1) grows a blowout's effect but with diminishing returns, so
//     a 42-point win is worth more than a 14-point one and nowhere near three
//     times more.
//   · the 2.2 damping term SHRINKS the multiplier when a strong team beats a
//     weak one by a lot and GROWS it on an upset blowout. Without it, good
//     teams running up scores on bad ones is a rating treadmill.
// A TIE has no winner, so favouredDiff is taken as 0 and |margin| as 1: the
// multiplier is ln(2), the ratings still move toward the expectation, and a
// tie is not silently a no-op (which is what a bare ln(0+1) = 0 would make it).
// If the real ruling differs, this is the one function to change and every
// number downstream follows it.
//
// SEASON REGRESSION. At each season boundary every rating is pulled back
// toward START by `regress`, a FRACTION in [0,1]:
//
//   elo <- START + (elo - START) * (1 - regress)
//
// regress = 0 carries a season forward untouched; regress = 1 wipes the ladder
// to a blank slate every year. It fires on the first game of a NEW season
// number, not on a date, so a January playoff game belonging to the previous
// season_year regresses with that season and not before it.
//
// THE PRESEASON PRIOR. Regression alone says a team is what it was, only less
// so - which is the best a ladder can do with no outside information, and it
// is wrong every August. Rosters turn over, and in college they turn over
// completely. So where a season has ANCHORS - a preseason opinion expressed as
// a rating - the carried-forward number is averaged with it:
//
//   elo <- ( regressed  +  anchor ) / 2
//
// A MEAN, NOT A WEIGHTED BLEND, because there is no evidence available in
// August for weighting one over the other, and a 50/50 that anybody can
// recompute in their head beats a 0.63 that came from nowhere.
//
// TWO SHAPES, AND THEY ARE DIFFERENT QUESTIONS:
//   · A team ALREADY ON the ladder has both halves, so it gets the mean.
//   · A team arriving for the FIRST time in that season has no carried rating
//     at all, so it STARTS AT the anchor. Averaging an anchor with a 1500 it
//     never earned would drag every newcomer toward the middle and make the
//     preseason opinion count half as much for them as for everyone else.
//   · A team with no anchor keeps its regressed rating untouched - a mean over
//     the one source present, which is the same rule sitesComposite follows.
// `anchors` is Map(season -> Map(key -> elo)). What an anchor MEANS, and how a
// poll rank becomes one, is the caller's business, not the ladder's: see
// buildApAnchors() in lib/rankings/publishGridironEdition.js.
//
// THE FCS POOL IS ONE RATING, NOT 105. A rating is only meaningful for a team
// that plays the field repeatedly, and an FCS side plays one FBS opponent a
// year and never plays another FCS side on our schedule - 105 separate ratings
// would each be a single game's noise, and the FBS team that beat one would be
// rated against a number that means nothing. Every team whose classification
// is 'fcs' therefore shares the single key FCS_KEY. That pool loses most weeks,
// so it settles a long way below 1500, which is exactly the information an
// FBS team's win over it should carry.
//
// PRE-SEASON IS NOT EVIDENCE and is dropped by season_phase, not by date. PROD
// holds 49 final, fully-scored NFL 2026 PRE games; they are starters playing a
// quarter and they would move a rating as hard as a Week 1 result.
//
// DETERMINISM IS A PROPERTY OF THE SORT. Games are ordered by kickoff, then by
// id as a tiebreak, before a single rating moves - so two games kicking at the
// same instant are always applied in the same order and the same input always
// produces the same output, whatever order the caller's query returned.

/** Every rating starts here, and regression pulls back toward it. */
export const START_ELO = 1500;

/** The one key every FCS team shares. A string, so it can never collide with a team id. */
export const FCS_KEY = 'FCS';

/** Defaults: NFL-shaped. CFB passes its own - see publishGridironEdition.js. */
export const DEFAULT_K = 20;
export const DEFAULT_HFA = 55;
export const DEFAULT_REGRESS = 1 / 3;

/** Phases that never rate. PRE is starters playing a quarter. */
const EXCLUDED_PHASES = new Set(['PRE']);

/**
 * The rating key for one side of a game. An FCS team is the pool; everyone
 * else is their own team id, coerced to a Number so a string id from one
 * query and a numeric id from another cannot become two ladders.
 */
export function eloKey(teamId, classification) {
  if (String(classification ?? '').toLowerCase() === 'fcs') return FCS_KEY;
  // NULL AND '' ARE NOT ZERO. Number(null) is 0 and Number('') is 0, both
  // finite, so a missing id would otherwise become the team whose key is 0 and
  // every unresolved row would pile into one phantom ladder.
  if (teamId == null || teamId === '') return null;
  const n = Number(teamId);
  return Number.isFinite(n) ? n : null;
}

/** ln(|margin| + 1) damped by the favourite's rating edge. See the header. */
export function marginMultiplier(margin, favouredDiff) {
  const m = Math.abs(Number(margin));
  const tie = !(m > 0);
  const size = tie ? 1 : m;
  const diff = tie ? 0 : Number(favouredDiff);
  return Math.log(size + 1) * (2.2 / (diff * 0.001 + 2.2));
}

/** The home side's expected score, home advantage applied to the home rating. */
export function expectedHome(eloHome, eloAway, hfa) {
  return 1 / (1 + 10 ** ((eloAway - (eloHome + hfa)) / 400));
}

/**
 * RUN THE LADDER.
 *
 * @param games  finals, in any order. Each row:
 *   { id, season, phase, kickoffAt, homeId, awayId, homeScore, awayScore,
 *     homeClass, awayClass }
 *   phase is matched against EXCLUDED_PHASES; classification decides pooling.
 *   A row missing a score, a key, or either side is SKIPPED, not guessed.
 * @param k        rating movement per game before the multiplier
 * @param hfa      home advantage in rating points, added to the home side
 * @param regress  fraction pulled back toward START_ELO at a season boundary
 * @param anchors  Map(season -> Map(key -> elo)); a preseason opinion averaged
 *                 with the regressed rating at that season's boundary, and used
 *                 as the starting rating for a team first seen in that season
 *
 * @returns Map(key -> { elo, games, history }) where key is a team id or
 *   FCS_KEY, and history is that side's games oldest-first, each carrying
 *   { gameId, season, phase, kickoffAt, opp, home, result, margin,
 *     eloBefore, eloAfter, delta }.
 *   eloBefore is the rating the game was played AT - after any season
 *   regression - which is what makes a regression observable from the outside.
 */
export function runElo({
  games = [], k = DEFAULT_K, hfa = DEFAULT_HFA, regress = DEFAULT_REGRESS,
  anchors = new Map(),
} = {}) {
  const usable = [];
  for (const g of games ?? []) {
    if (EXCLUDED_PHASES.has(String(g?.phase ?? ''))) continue;
    // A MISSING SCORE IS NOT A ZERO. Number(null) and Number('') are both 0
    // and both finite, so a bare Number() guard would have rated an unscored
    // row as a 0-0 tie - or, with one side present, as a shutout. Checked
    // before the coercion, not after it.
    const num = (v) => (v == null || v === '' ? NaN : Number(v));
    const hs = num(g?.homeScore); const as = num(g?.awayScore);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const home = eloKey(g.homeId, g.homeClass);
    const away = eloKey(g.awayId, g.awayClass);
    if (home == null || away == null || home === away) continue;
    usable.push({ ...g, homeScore: hs, awayScore: as, homeKey: home, awayKey: away });
  }
  // THE SORT IS THE DETERMINISM. Kickoff first, id as the tiebreak, both
  // ascending, before anything is rated.
  usable.sort((a, b) => {
    const ta = new Date(a.kickoffAt).getTime(); const tb = new Date(b.kickoffAt).getTime();
    if (ta !== tb) return ta - tb;
    return Number(a.id) - Number(b.id);
  });

  const table = new Map();
  const anchorFor = (s, key) => anchors?.get?.(s)?.get?.(key) ?? null;
  // A TEAM'S FIRST RATING IS ITS ANCHOR WHERE IT HAS ONE. See "TWO SHAPES"
  // above: a newcomer starts AT the preseason opinion rather than halfway
  // between it and a 1500 it never played for.
  const seat = (key, s) => {
    if (!table.has(key)) {
      table.set(key, { elo: anchorFor(s, key) ?? START_ELO, games: 0, history: [] });
    }
    return table.get(key);
  };

  let season = null;
  for (const g of usable) {
    // SEASON BOUNDARY. Fires when the season NUMBER changes, on every seated
    // rating including sides that do not play in this game.
    if (season != null && g.season !== season) {
      for (const [key, row] of table) {
        const carried = regress > 0
          ? START_ELO + (row.elo - START_ELO) * (1 - regress)
          : row.elo;
        const anchor = anchorFor(g.season, key);
        row.elo = anchor == null ? carried : (carried + anchor) / 2;
      }
    }
    season = g.season;

    const H = seat(g.homeKey, g.season); const A = seat(g.awayKey, g.season);
    const beforeH = H.elo; const beforeA = A.elo;
    const margin = g.homeScore - g.awayScore;
    const sHome = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const eHome = expectedHome(beforeH, beforeA, hfa);
    // The favourite is the WINNER, and the home side carries its advantage
    // into the comparison because that is the edge it actually played with.
    const adjH = beforeH + hfa;
    const favouredDiff = margin > 0 ? adjH - beforeA : margin < 0 ? beforeA - adjH : 0;
    const delta = k * marginMultiplier(margin, favouredDiff) * (sHome - eHome);

    H.elo = beforeH + delta; A.elo = beforeA - delta;
    H.games += 1; A.games += 1;
    const base = { gameId: g.id, season: g.season, phase: g.phase ?? null, kickoffAt: g.kickoffAt, margin: Math.abs(margin) };
    H.history.push({
      ...base, opp: g.awayKey, home: true,
      result: margin > 0 ? 'W' : margin < 0 ? 'L' : 'T',
      eloBefore: beforeH, eloAfter: H.elo, delta,
    });
    A.history.push({
      ...base, opp: g.homeKey, home: false,
      result: margin < 0 ? 'W' : margin > 0 ? 'L' : 'T',
      eloBefore: beforeA, eloAfter: A.elo, delta: -delta,
    });
  }
  return table;
}

/**
 * The signed rating change over a side's last `n` rated games - the momentum
 * dimension's raw input. NULL on no history rather than 0, because "has not
 * played" and "has played and gone nowhere" are different facts and the
 * dimension treats them differently.
 */
export function deltaOverLast(history, n = 3) {
  if (!history?.length) return null;
  const tail = history.slice(-n);
  return tail.at(-1).eloAfter - tail[0].eloBefore;
}

/**
 * The last `n` games as the inputs blob records them: opponent, result, margin.
 * `label` turns a rating key into whatever the caller wants to print - an
 * abbreviation, usually. It DEFAULTS TO IDENTITY rather than to String(), so a
 * caller that passes no label gets the raw key back and a numeric team id does
 * not silently become the string '901'.
 */
export function lastResults(history, n = 3, label = (k) => k) {
  if (!history?.length) return [];
  return history.slice(-n).map((h) => ({ opp: label(h.opp), result: h.result, margin: h.margin }));
}
