// lib/scores/yours.js - the YOURS band: the games this reader has a claim on.
//
// ONE READER, PURE, NO DATABASE. Everything it needs is already in the page's
// hand: scoresV2 calls stakeForMatches() once for the whole slate, and this
// decides from that map. A second query here would be a second opinion about
// the same question, and the two would drift the first time either changed -
// the same argument that keeps the Top 25 filter reading `extras` rather than
// asking the AP reader again.
//
// WHAT COUNTS, AND WHAT DELIBERATELY DOES NOT.
// A game is YOURS when the reader did one of two things:
//   · FOLLOWED (STARRED) A TEAM that is playing in it - stake.follow
//   · SET AN ALERT on the match, or on either team - stake.alerts
// It is NOT yours because a pick or a Weekly player happens to be in it.
// Those are stakes too and they are why MINE exists (?mine=1), but MINE
// answers "where is my money" and this band answers "which games are mine to
// watch". A pick expires with the board and a Weekly player moves every week;
// a star and an alert are standing instructions. Folding picks in here would
// make the band the Mine filter with a different name, and on a Sunday it
// would swallow the whole slate.
//
// stake.alerts IS ALREADY MASTER-GATED. stakeForMatches reads alert_prefs
// `WHERE user_id = … AND master`, so a reader who switched the game off at the
// master toggle is not carrying a set alert, and this band does not claim them.
// That rule lives there, once, and is not restated here as a second check.
//
// SIGNED OUT, THERE IS NO BAND. Not an empty band with a label, not a
// sign-in prompt where games go - nothing. A reader with no account has no
// games, and chrome that exists only to say so is chrome that costs a slot.

import { gamesSub } from '../gridiron/scoresV2Shape.js';

/** Does this reader have a standing claim on the game behind this stake row? */
export function isYours(stakeEntry) {
  if (!stakeEntry) return false;
  // `follow` names WHICH side is followed ('home' | 'away' | null), so its
  // truthiness is the question "is a followed team playing here".
  return Boolean(stakeEntry.follow) || stakeEntry.alerts === true;
}

/**
 * LIVE FIRST, THEN BY KICKOFF. A game being played outranks one that has not
 * started however early it kicks, because the band exists to be looked at
 * during the slate. Within each half the clock decides, and a missing kickoff
 * sorts last rather than throwing the comparator.
 */
export function yoursOrder(a, b) {
  const live = (g) => (g.status === 'live' ? 0 : 1);
  if (live(a) !== live(b)) return live(a) - live(b);
  const t = (g) => {
    const n = new Date(g.kickoffAt ?? 0).getTime();
    return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
  };
  return t(a) - t(b);
}

/** The reader's games out of a slate, ordered. Empty when signed out. */
export function yoursGames(games, stake, { signedIn = false } = {}) {
  if (!signedIn || !stake || !games?.length) return [];
  return games.filter((g) => isYours(stake.get(g.id))).sort(yoursOrder);
}

/**
 * THE BAND, PREPENDED, AND THE REST IS THE REST.
 *
 * A game in the band is REMOVED from the groups below it. "The rest of the
 * slate follows" is the ruling, and a card drawn twice on one screen is a
 * reader wondering which of the two is the real one. A group emptied by the
 * lift is dropped rather than left as a heading over nothing.
 *
 * The band is a group of the same shape as every other, which is what keeps
 * this a reader change and not a card redesign: ScoresV2 maps over groups and
 * never asks what kind a group is.
 */
export function withYoursBand(groups, { games, stake, signedIn = false } = {}) {
  const mine = yoursGames(games, stake, { signedIn });
  if (!mine.length) return groups;
  // Only lift a game out of a group that is actually being drawn - the band
  // must not resurrect a game the day filter or the Top 25 pill excluded.
  const drawn = new Set(groups.flatMap((g) => g.games.map((x) => x.id)));
  const band = mine.filter((g) => drawn.has(g.id));
  if (!band.length) return groups;
  const lifted = new Set(band.map((g) => g.id));
  // THE HEADING MUST COUNT THE CARDS UNDER IT. A group's sub is written when
  // the group is built, before this lift exists, so "14 games" sat over 12
  // cards on the live board the day the band shipped. Any group whose sub
  // LEADS WITH A COUNT declares it by carrying subTail, and its sentence is
  // rebuilt from the post-lift length through the same helper that wrote it -
  // never by pattern-matching the string back apart.
  const rest = groups
    .map((grp) => {
      const games = grp.games.filter((g) => !lifted.has(g.id));
      if (games.length === grp.games.length) return grp;   // untouched, keep it whole
      return grp.subTail == null
        ? { ...grp, games }
        : { ...grp, games, sub: gamesSub(games.length, grp.subTail) };
    })
    .filter((grp) => grp.games.length);
  const live = band.filter((g) => g.status === 'live').length;
  return [
    {
      key: 'yours',
      // Sentence case in the data, uppercased by .sv2-gh h2 - the same way
      // "Live now" reaches the screen as LIVE NOW. House grammar, one place.
      title: 'Yours',
      sub: gamesSub(band.length, live ? ` · ${live} live` : ''),
      games: band,
    },
    ...rest,
  ];
}
