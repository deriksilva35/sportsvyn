// lib/games/lobby.js - the games lobby's view. PURE.
//
// THE STANDINGS LAW APPLIES TO EVERY NUMBER ON THIS PAGE. /games is the
// arcade's front door and it aggregates four games at once, which makes it the
// single most likely place for an open-day result to leak by accident. So the
// rule is stated once here and enforced by construction: every figure on every
// pane comes from a day that has REVEALED or a contest that has SETTLED, with
// exactly one exception - the viewer's own state in the game they are playing
// right now, which is theirs to know.
//
// CARD STATE COMES FROM DATA, NEVER FROM A DEPLOY. A game is ghosted because no
// contest exists for it yet, and it goes live the moment one does. Nothing here
// reads a date and decides Pick'em has started; it reads whether Pick'em has
// a board. That is what lets Aug 25 and Sep 8 happen without a release.

export const GAME_ORDER = ['daily', 'pickem', 'weekly', 'draft'];

// THE ONE SPELLING (relay 2a-fix item 4): a straight apostrophe, no space, no
// smart-quote pasted from a doc. Every display name for the four games comes
// from here so there is exactly one place to misspell it.
export const GAME_NAMES = { daily: 'The Daily', pickem: "Pick'em", weekly: 'The Weekly', draft: 'The Draft' };

// THE HOOK COPY IS RATIFIED (games legibility pass, Aug 22) - one sentence,
// key nouns bolded with ** markers (components/games/chrome renders them),
// hyphens only. The chips answer "is this worth opening" before the tap:
// time cost, cadence, the game's key rule.
// LEAGUE MEMBERSHIP IS DATA, NOT A BRANCH. The league landings show the games
// that actually run for that code, and the answer differs: Pick'em runs both
// college Saturdays and NFL Sundays, while the Daily, the Weekly and the Draft
// are NFL only - their pools, their sim and their board are all NFL. A tile on
// /cfb for a game with no college board would be a dead link wearing a primary
// button, so the list lives here beside the game rather than as an `if` on the
// surface that renders it.
export const GAME_META = {
  daily: {
    key: 'daily', leagues: ['nfl'], name: GAME_NAMES.daily, href: '/daily', num: '01',
    blurb: 'One board. Six slots. Three minutes.',
    hook: 'Draft **six stars** from a week in NFL history. The sim replays it at **midnight ET**.',
    chips: ['2 min', 'every day', 'guess the season'],
  },
  pickem: {
    key: 'pickem', leagues: ['nfl', 'cfb'], name: GAME_NAMES.pickem, href: '/pickem', num: '02',
    blurb: 'Call the winners. NFL and college.',
    hook: 'Call the winner of **every game** on the board - college Saturdays, NFL Sundays.',
    chips: ['1 min', 'weekly', 'locks per game'],
  },
  weekly: {
    key: 'weekly', leagues: ['nfl'], name: GAME_NAMES.weekly, href: '/weekly', num: '03',
    blurb: 'One lineup a week, from the real slate.',
    hook: 'Roster **any six NFL players**. Real-game scoring, best five count.',
    chips: ['90 sec', 'every NFL week'],
  },
  draft: {
    key: 'draft', leagues: ['nfl'], name: GAME_NAMES.draft, href: '/draft', num: '04',
    blurb: 'Six rounds against the room.',
    hook: 'Snake draft vs **a full AI room**. Pick your seat, beat the clock.',
    chips: ['10 min', 'weekly · ranked'],
  },
};

// THE HERO (relay 2a item 3) - one game's pitch, two lines, ratified per
// game and never freehand elsewhere. Order within each array is the line
// break the mock renders (join with <br/>, never a single sentence).
export const HERO_TAGLINE = {
  daily: ['Nine slots.', 'Twelve teams.'],
  pickem: ['Call the', 'winners.'],
  weekly: ['Six slots.', 'No clock.'],
  draft: ['Eight rounds.', 'No bench.'],
};

/** The hero's one button, per game - same ratified-copy reasoning as the
 * tagline above. */
export const HERO_CTA = {
  daily: 'Play now',
  pickem: 'Make your picks',
  weekly: 'Set your six',
  draft: 'Take a seat',
};

/**
 * THE HERO EYEBROW'S RIGHT SPAN (relay 2c item 3) - what hero.locksAt
 * actually IS differs by game, and the word has to say so. Weekly and Draft
 * share one global locks_at for everyone; Pick'em's is the nearest UNMET
 * per-game lock among this viewer's own open picks (appointmentHero()'s own
 * candidate.locksAt), a moving target as the board plays out - "locks" would
 * claim a single deadline that does not exist for this game.
 */
export const HERO_LOCK_LABEL = {
  daily: 'locks',
  pickem: 'next lock',
  weekly: 'locks',
  draft: 'locks',
};

// THE FOUR GAME TILES (relay 2a item 4) - one glyph, never an emoji chosen
// freehand at the call site.
export const GAME_GLYPHS = { daily: '🗓', pickem: '✅', weekly: '6️⃣', draft: '🪑' };

export const PANES = ['games', 'leaderboards', 'answer', 'history'];
export const PANE_LABEL = {
  games: 'Games', leaderboards: 'Leaderboards', answer: 'Latest answer', history: 'History',
};
export const normalizePane = (p) => (PANES.includes(String(p)) ? String(p) : 'games');

/**
 * THE PICK'EM SEASON BOARD'S SPORT FILTER (relay 2c item 7) - All / NFL /
 * CFB, a URL param like every other pane state on this page ("PANES ARE URL
 * PARAMS, NOT AN ISLAND" - lib/games/read.js's pickemTable() stays ONE
 * table across both sports; this only narrows which rows it counts.
 * `null` IS 'All', not a fourth string - an unrecognised value falls back
 * to it rather than to a specific sport, the same safe direction
 * normalizePane() takes for an unrecognised pane.
 */
export const PICKEM_SEASON_FILTERS = ['all', 'nfl', 'cfb'];
export function normalizePickemSeasonSport(v) {
  const s = String(v ?? 'all').toLowerCase();
  return PICKEM_SEASON_FILTERS.includes(s) && s !== 'all' ? s : null;
}

/**
 * One card's state.
 *
 * GHOSTED IS AN HONEST STATE, not a placeholder: it carries the date the game
 * opens so the card says something true rather than teasing. It becomes live
 * when `contest` arrives, which is a data event.
 *
 * @param {object} a
 * @param {string} a.key
 * @param {object|null} a.contest  the open/current contest, or null
 * @param {object|null} a.mine     the viewer's own state in that game
 * @param {string|null} a.opensLabel  what to say while ghosted
 */
export function cardState({ key, contest = null, mine = null, opensLabel = null, count = null }) {
  const meta = GAME_META[key];
  if (!meta) return null;
  if (!contest) {
    // A GHOSTED GAME CARRIES NO NUMBER. There is no contest to count, and a
    // number on a game that has not opened would be a claim about nothing.
    return { ...meta, state: 'ghost', opensLabel: opensLabel ?? 'Coming soon', playable: false, count: null };
  }
  // The viewer's own state is the ONLY per-user thing a card may carry, and
  // only ever about themselves.
  const state = mine?.settled ? 'settled' : mine?.entered ? 'entered' : 'open';
  return {
    ...meta,
    state,
    playable: state !== 'settled',
    closesLabel: contest.closesLabel ?? null,
    // THE COUNT IS COMPUTED BY THE READER, never by the tile. A surface that
    // derived its own number would be a second opinion about the same fact.
    count,
    // Never another player's anything.
    you: mine ? { score: mine.score ?? null, tier: mine.tier ?? null, streak: mine.streak ?? null } : null,
  };
}

/**
 * The signed-in reader's season line.
 * THROUGH-REVEALED ONLY, like every standing: it is the same numbers the
 * overall board is built from, so the two can never disagree on this page.
 */
export function seasonStrip({ handle = null, standing = null, pickem = null } = {}) {
  if (!standing && !pickem) return null;
  return {
    handle,
    points: standing?.points ?? 0,
    played: standing?.played ?? 0,
    daysPlayable: standing?.daysPlayable ?? 0,
    hof: standing?.hof ?? 0,
    mvp: standing?.mvp ?? 0,
    rank: standing?.rank ?? null,
    // Absent until Pick'em has settled something - a 0-0 record on a game
    // nobody has played reads as a loss rather than as "not started".
    pickem: pickem ?? null,
  };
}

/**
 * A leaderboard section that has nothing to show yet says WHEN, not nothing.
 * An empty board with no explanation reads as broken; "populates after the
 * first settle" reads as early.
 */
export function boardSection({ key, name, table = null, populatesLabel = null }) {
  if (table?.top?.length) return { key, name, state: 'live', table };
  return { key, name, state: 'pending', populatesLabel: populatesLabel ?? 'Populates after the first settle' };
}
