// lib/gridiron/leagueLanding.js — the league landing's pure shaping. NO JSX,
// no database, no clock of its own. Every claim the screen makes about a rank,
// a record, a movement arrow or a game's state is decided here, where it can
// be tested without rendering anything.

import { spansMultipleDays, soleDayKey, dayOffset, dayHeading, dayKey } from './kickoff.js';

/** "9-3" / "9-3-1", or null. A chip may only claim knowledge. */
export function railRecord(r) {
  const w = r?.wins, l = r?.losses, t = r?.ties;
  if (w == null || l == null) return null;
  if ((w ?? 0) + (l ?? 0) + (t ?? 0) === 0) return null;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/**
 * Which way a team moved, or null.
 *
 * NULL ON THE FIRST WEEK IS THE WHOLE RULE. With no prior ranking there is no
 * movement to report, and rendering a flat marker would state that a team held
 * its position - a claim we cannot make about a poll that has only ever run
 * once. A team that held its rank is also null: an arrow means CHANGED.
 */
export function railMovement(r) {
  const prev = r?.previous_rank;
  const now = r?.rank;
  if (prev == null || now == null) return null;
  if (Number(prev) === Number(now)) return null;
  return Number(now) < Number(prev) ? 'up' : 'down';
}

/** One rail chip. PURE. */
export function railChip(r) {
  return {
    teamId: r.team_id ?? null,
    rank: r.rank,
    // The abbreviation is the chip's identity; a row we could not attach to a
    // team falls back to the label it was seeded with rather than vanishing.
    abbr: r.abbreviation ?? r.name ?? '',
    record: railRecord(r),
    movement: railMovement(r),
  };
}

export function railChips(rows) {
  return (rows ?? []).map(railChip);
}

/**
 * THE SCREEN EYEBROW. "Week 1 · Sat Aug 29", or just the date.
 *
 * REG-ONLY LANDMARK LAW: a week number is a regular-season fact. Preseason and
 * postseason weeks count differently and a bare "Week 3" that silently means
 * preseason week 3 is worse than no week at all. A failed derivation - no
 * week, or a phase that is not REG - renders the date alone, which is always
 * true.
 */
export function landingEyebrow({ week, phase, date, tz = 'America/New_York' } = {}) {
  const d = date ? new Date(date) : null;
  const day = d && !Number.isNaN(d.getTime())
    ? new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(',', '')
    : null;
  const wk = phase === 'REG' && week != null ? `Week ${week}` : null;
  return [wk, day].filter(Boolean).join(' · ') || null;
}

/**
 * THE LIVE PILL. A count, or null at zero.
 *
 * HIDDEN AT 0, not rendered as "0 live". A zero in an alert-coloured pill is a
 * live-red badge saying nothing is live, which is the one thing that colour
 * must never say.
 */
export function livePill(games) {
  const n = (games ?? []).filter((g) => g?.status === 'live').length;
  return n > 0 ? n : null;
}

/**
 * WHICH GAMES BELONG TO A LEAGUE'S STRIP, and it is data on GAME_META rather
 * than a branch here: Pick'em runs for both codes, the other three are NFL.
 * A tile for a game that does not exist on this league would be a dead link
 * wearing a volt button.
 */
export function stripGamesFor(leagueSlug, meta) {
  return Object.entries(meta ?? {})
    .filter(([, m]) => (m?.leagues ?? []).includes(leagueSlug))
    .map(([key]) => key);
}

/**
 * IS THIS TILE'S ACTION OPEN? The primary-button law depends on this answer
 * and nothing else: a volt button appears only where a signed-in reader can do
 * something right now.
 *
 * SIGNED OUT IS NOT AN OPEN ACTION. The tile still shows the game and its
 * lock, because those are true for everybody, and its button reads "Sign in to
 * play" - a link, not a primary.
 */
export function tileIsOpen(card, { signedIn = false } = {}) {
  if (!signedIn) return false;
  // cardState's OWN vocabulary, not a second one invented here: 'ghost' has no
  // contest, 'entered' means the reader has already acted, 'settled' is over.
  // Only 'open' is an action waiting to be taken.
  return card?.state === 'open' && card?.playable === true;
}

/**
 * The number a tile shows, or null.
 *
 * THE NUMBER IS THE STATE, so it may only come from what the lobby card
 * actually carries about THIS reader. cardState hands over `you.score` and
 * `you.streak` and nothing else numeric; the picked/total, set-of-six and
 * seat/room counts the design asks for are not on it today. Where there is no
 * number we render none rather than compute a second opinion from another
 * reader - see the note in the relay report.
 */
export function tileNumber(card) {
  // THE READER OWNS THE NUMBER. gamesLobby computes it per game - picks over a
  // board, slots in a lineup, the room, the day's field - because only the
  // reader knows what each game counts. This just renders what it was handed,
  // and a game with nothing to count has no number rather than a zero.
  const c = card?.count;
  if (!c || c.value == null || c.value === '') return null;
  return { value: String(c.value), unit: c.unit ?? null };
}

/** The tiles a league's strip renders, in GAME_ORDER. PURE. */
export function stripTiles({ leagueSlug, meta, order, cards, signedIn = false }) {
  const allowed = new Set(stripGamesFor(leagueSlug, meta));
  return (order ?? [])
    .filter((k) => allowed.has(k))
    .map((k) => {
      const card = cards?.[k] ?? null;
      return { key: k, label: meta?.[k]?.label ?? k, card, open: tileIsOpen(card, { signedIn }) };
    });
}

/**
 * THE SCORES MODULE'S SLICE: live first, then upcoming, then final, capped.
 *
 * THE ORDER IS THE READER'S PRIORITY, not the clock's. A game in progress is
 * the reason somebody opened this screen; a final is the least urgent thing on
 * it and still worth showing. Within each band the kickoff order holds.
 */
const BAND = { live: 0, scheduled: 1, final: 2 };
export function scoresSlice(games, cap = 6) {
  const all = [...(games ?? [])].sort((a, b) => {
    const ba = BAND[a?.status] ?? 1, bb = BAND[b?.status] ?? 1;
    if (ba !== bb) return ba - bb;
    return new Date(a?.kickoffAt ?? 0) - new Date(b?.kickoffAt ?? 0);
  });
  return { shown: all.slice(0, cap), total: all.length, overflow: Math.max(0, all.length - cap) };
}

/** CFB counts a day; the NFL counts a week. The unit is the league's, not ours. */
export const LEAGUE_UNIT = Object.freeze({ cfb: 'day', nfl: 'week' });
export function leagueUnit(slug) { return LEAGUE_UNIT[slug] ?? 'week'; }

/**
 * WHAT THE SCORES MODULE MAY CALL ITSELF. "Today", or "This week".
 *
 * THE UNIT ALONE WAS NOT ENOUGH AND SHIPPED A FALSE HEADING. The module titled
 * itself from LEAGUE_UNIT - CFB counts a day, so "Today" - while the landing
 * handed it slate.byDay flattened, the whole WEEK. A CFB landing therefore
 * titled four days of football "Today", every week, with Saturday's games
 * under it on a Tuesday.
 *
 * SO THE HEADING ASKS THE GAMES, NOT THE LEAGUE. The unit says how a code's
 * schedule is shaped, which is a true and useful thing that is simply not the
 * question here; what titles a list is what is IN the list. A day-unit league
 * keeps "Today" only while every game on screen falls on one calendar day, and
 * degrades to "This week" the moment it does not.
 *
 * THE DAY IS THE READER'S, hence tz. A list that is one day in Eastern can be
 * two in Honolulu, and the heading has to agree with the day headers rendered
 * from the same function on the same games.
 */
export function moduleHeading(unit, games, tz = 'America/New_York', now = new Date()) {
  if (unit !== 'day') return 'This week';
  if (spansMultipleDays(games, tz)) return 'This week';

  // ONE DAY ON SCREEN IS NOT THE SAME CLAIM AS "TODAY", and the first fix here
  // stopped short of noticing that. It made "Today" true about DAY-SPANNING -
  // the module no longer titled four days of football as one - and left it
  // free to say "Today" over a single day that is not today. Measured on PROD:
  // /cfb read "Today" above six cards all dated Thu Sep 3, on Tue Sep 1.
  //
  // So the heading needs the clock as well as the games, and it takes it as an
  // argument rather than reaching for one - this module has no clock of its
  // own, by the rule at the top of the file, and a heading that reads the
  // machine's time could not be tested at any date but the day it was written.
  const key = soleDayKey(games, tz);
  if (!key) return 'This week';
  const offset = dayOffset(key, now, tz);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';

  // ANY OTHER SINGLE DAY NAMES ITSELF. Not "This week", which would be a
  // second kind of lie for a Saturday slate ten days out, and not a bare
  // weekday, which is ambiguous the moment a slate is more than a week away.
  // The same grammar the sticky day headers use, from the same function, so
  // the module title and the header below it cannot word the day differently.
  return dayHeading(games.find((g) => dayKey(g?.kickoffAt, tz) === key)?.kickoffAt, tz)
    ?? 'This week';
}
