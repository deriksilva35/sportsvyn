// lib/games/personal.js - the reader's own record, across revealed days. PURE.
//
// ============================================================================
// THROUGH-REVEALED ONLY, AND THAT INCLUDES THE READER'S OWN OPEN DAY
// ============================================================================
// Every other surface on the site has one exception to the standings law: your
// own state in the game you are playing right now is yours to know, so the
// Daily's receipt shows you your score before midnight.
//
// THIS FILE HAS NO SUCH EXCEPTION, and the reason is that these are STANDINGS,
// not a receipt. An average that moved the moment you locked, a best score that
// updated at 9am, a streak that already counted today - each would be a number
// that disagrees with the leaderboard sitting two panes away, and one of them
// would have to be wrong. Worse, a "played 12/11" is not a rounding error a
// reader forgives; it is the page telling them it cannot count.
//
// So the contract is stronger than "do not leak someone else's score": a
// reader's OWN locked entry on an open day must contribute NOTHING here. The
// test asserts it byte-for-byte - the same user with and without an open-day
// entry must serialize identically - and every function below takes rows that
// the caller has already filtered to revealed days.

import { tierFor, guessResult, TIERS } from '../daily/reveal.js';
import { editionLabel, editionNo } from '../daily/homeModule.js';

/** The tier labels, best first - the order they are counted and displayed in. */
export const TIER_ORDER = TIERS.map((t) => t.label);

/**
 * One history row's YOU column.
 *
 * ABSENT, NOT NULL, FOR A SIGNED-OUT READER. A `you: null` on every row is a
 * per-user shape on a payload with no user, and a component would render an
 * empty column rather than no column. Same ruling as the lobby's card block.
 *
 * @returns {object|undefined} undefined when there is nothing to say
 */
export function youCell({ signedIn, entry = null, perfect = null }) {
  if (!signedIn) return undefined;
  // A day the reader did not play, or opened and never locked, gets an em-dash
  // rather than a zero. A DNF has no result to report and a 0.0 would be a lie.
  if (!entry || entry.locked_at == null || entry.score == null) return { played: false };
  const score = Number(entry.score);
  const t = tierFor(score, perfect);
  return { played: true, score, tier: t?.label ?? null, pct: t?.pct ?? null };
}

/**
 * The reader's season record.
 *
 * @param {object}  a
 * @param {boolean} a.signedIn
 * @param {Array}   a.days  REVEALED days only, newest first, each
 *                          { date, season_year, week, perfect, entry }
 * @returns {object|null} null when there is nothing to report
 */
export function yourStats({ signedIn, days = [] } = {}) {
  if (!signedIn) return null;
  const playable = days.length;
  if (playable === 0) return null;

  const played = [];
  for (const d of days) {
    const e = d.entry;
    if (!e || e.locked_at == null || e.score == null) continue;
    const perfect = d.perfect == null ? null : Number(d.perfect);
    const t = tierFor(Number(e.score), perfect);
    played.push({
      date: d.date,
      edition: editionLabel(editionNo(d.date)),
      score: Number(e.score),
      pct: t?.pct ?? null,
      tier: t?.label ?? null,
      guess: guessResult(e, { season_year: d.season_year, week: d.week }),
    });
  }

  // A reader who has not played a revealed day yet gets the shape with zeroes
  // rather than null: "0 of 3" is a true and useful thing to see on the page,
  // where a missing module would just look like the feature is broken.
  const tiers = Object.fromEntries(TIER_ORDER.map((l) => [l, 0]));
  for (const p of played) if (p.tier) tiers[p.tier] += 1;

  const withPct = played.filter((p) => p.pct != null);
  const avgPct = withPct.length
    ? Math.round((withPct.reduce((a, p) => a + p.pct, 0) / withPct.length) * 10) / 10
    : null;

  // TIES GO TO THE OLDER EDITION: the first time you hit a number is when you
  // did it, and a later equal score did not beat it.
  //
  // `played` runs NEWEST FIRST, so this is >= and not >. With a strict >, the
  // first row seen wins a tie - and the first row seen is the most recent day,
  // which is exactly backwards. Every equal score that follows is older, so
  // letting each one replace the incumbent leaves the oldest holding it.
  let best = null;
  for (const p of played) if (!best || p.score >= best.score) best = p;

  // THREE BUCKETS OVER DAYS A GUESS WAS ACTUALLY MADE. Counting a day with no
  // guess as a miss would punish not playing the bonus, which is optional by
  // design; `guessed` carries the denominator so the record cannot be read as
  // a percentage of days played.
  const g = { guessed: 0, exact: 0, seasonRight: 0, missed: 0 };
  for (const p of played) {
    if (!p.guess) continue;
    g.guessed += 1;
    if (p.guess.seasonRight && p.guess.weekRight) g.exact += 1;
    else if (p.guess.seasonRight) g.seasonRight += 1;
    else g.missed += 1;
  }

  // CONSECUTIVE FROM THE MOST RECENT REVEALED DAY. `days` arrives newest first,
  // so a break is the first unplayed day - and because today is not in `days`
  // at all, a streak cannot be extended by an entry that has not closed.
  let streak = 0;
  for (const d of days) {
    const e = d.entry;
    if (!e || e.locked_at == null || e.score == null) break;
    streak += 1;
  }

  return {
    playable,
    played: played.length,
    avgPct,
    best: best ? { score: best.score, edition: best.edition, date: best.date } : null,
    tiers,
    guess: g,
    streak,
  };
}
