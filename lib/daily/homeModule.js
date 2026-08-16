// lib/daily/homeModule.js - the Daily's module on the homepage.
//
// THE VIEW IS BUILT HERE AND THE COMPONENT ONLY PRINTS IT, because the thing
// that matters about this surface is what is ABSENT from it. The homepage is
// the widest-read page on the site and it renders for signed-out strangers, so
// a pre-close view that carried the season, the week or a player name would
// publish the answer to everyone who never played. That is a data rule, not a
// rendering preference, which is why it lives in a pure function with tests
// rather than inside JSX.
//
// THREE STATES, DERIVED, NEVER PASSED IN:
//   play      no entry, or signed out            -> the hook and one button
//   receipt   entry exists, day still open       -> your score, nothing else
//   revealed  the day has closed                 -> the answer, freely
// A day that has not opened yet, or does not exist, renders NOTHING. An empty
// frame on the homepage is worse than no module.
//
// SEASON AND WEEK ARE ONLY EVER SET IN 'revealed'. The two pre-close shapes do
// not carry the fields at all - not null, ABSENT - so a component cannot print
// them by accident and a test can assert on the serialized view.

import { tierFor, guessResult } from './reveal.js';
import { bandFor } from './play.js';

/** The first PROD board. Edition numbering counts from here. */
export const DAILY_EPOCH = '2026-08-16';

/**
 * "No. 001" for the epoch day, counting up.
 *
 * DERIVED, NOT STORED: the edition is a property of the date, so a column would
 * be a second source of truth that could disagree with the calendar. Computed
 * on the DATE parts only - both sides are parsed as UTC midnight, so a DST
 * boundary between the epoch and today cannot shift the count by one.
 */
export function editionNo(puzzleDate, epoch = DAILY_EPOCH) {
  const a = Date.parse(`${epoch}T00:00:00Z`);
  const b = Date.parse(`${puzzleDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const n = Math.round((b - a) / 86_400_000) + 1;
  return n >= 1 ? n : null;
}

/** Zero-padded to three, and it keeps growing past 999 rather than wrapping. */
export const editionLabel = (n) => (n == null ? null : String(n).padStart(3, '0'));

/**
 * THE ENTRIES FLOOR. A count is social proof or it is an empty room; there is
 * no middle. On day one "3 entries today" is a worse advertisement than saying
 * nothing, so the number is suppressed until it is worth printing.
 */
export const ENTRIES_FLOOR = 25;

/**
 * Build the homepage view.
 *
 * @param {object}  a
 * @param {string}  a.date      ET date of the board
 * @param {string}  a.dayState  'missing' | 'pending' | 'open' | 'closed'
 * @param {object}  a.day       the puzzle_days row (may be null)
 * @param {object}  a.entry     this user's puzzle_entries row, or null
 * @param {number[]} a.scores   locked scores for the day, for the band
 * @returns {object|null} null when the module must not render at all
 */
export function dailyHomeView({ date, dayState, day = null, entry = null, scores = [] } = {}) {
  if (dayState !== 'open' && dayState !== 'closed') return null;   // missing/pending: absent
  const edition = editionLabel(editionNo(date));
  const base = { date, edition };

  // ---- REVEALED -----------------------------------------------------------
  // The only shape allowed to carry season and week.
  if (dayState === 'closed') {
    const perfect = Number(day?.perfect?.total ?? 0) || null;
    // A closed day the reader never played still reveals - the answer is public
    // once the day is over, and hiding it from a non-player would be pretending
    // the board is still live.
    if (!entry || !entry.locked_at) {
      return { ...base, state: 'revealed', played: false, season: day?.season_year ?? null, week: day?.week ?? null, perfect };
    }
    const score = Number(entry.score);
    const guess = guessResult(entry, day);
    return {
      ...base,
      state: 'revealed',
      played: true,
      season: day?.season_year ?? null,
      week: day?.week ?? null,
      score,
      perfect,
      pct: perfect ? Math.round((score / perfect) * 100) : null,
      tier: tierFor(score, perfect)?.label ?? null,
      seasonRight: guess?.seasonRight ?? false,
      weekRight: guess?.weekRight ?? false,
      guessed: guess != null,
    };
  }

  // ---- OPEN: no entry (or signed out) -------------------------------------
  if (!entry || !entry.locked_at) return { ...base, state: 'play' };

  // ---- OPEN: the receipt --------------------------------------------------
  // Deliberately NO season, NO week, NO board content. The player knows what
  // they guessed because they typed it; everything else waits for midnight.
  const locked = (scores ?? []).filter((s) => s != null).map(Number);
  return {
    ...base,
    state: 'receipt',
    score: Number(entry.score),
    band: bandFor(entry.score, locked),
    guessSeason: entry.guess_season ?? null,
    guessWeek: entry.guess_week ?? null,
    // Absent below the floor rather than zero, so the component has nothing to
    // print instead of something to hide.
    entrants: locked.length >= ENTRIES_FLOOR ? locked.length : null,
  };
}
