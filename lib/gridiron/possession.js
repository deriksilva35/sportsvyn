// lib/gridiron/possession.js - WHICH SIDE HAS THE BALL. One reader, both
// surfaces (POSSESSION DOT ON THE BOARD relay).
//
// THE DOT REPLACED A SENTENCE. The Scores card's situation line said
// "ALA ball" and the game page's strip said "at ALA 41 · ALA ball"; the Live
// Activity has never said either - it marks the team in possession with a
// volt dot after its abbreviation, which is the same fact in a glance instead
// of in three words. Both web surfaces now say it the same way, so a reader
// who looks at the lock screen and then at the board is reading one grammar.
// The down, the distance and the spot are untouched: they are what the
// sentence never carried.
//
// WHY ONE READER AND NOT TWO. The two surfaces hold different shapes - the
// board has driveStripFor()'s row, the game page has buildDriveChart()'s -
// and each needs the answer to exactly one question. Asked twice, it gets
// answered twice, and the first divergence is a card dotting the away side
// while the strip beneath it dots the home one. It is asked here.
//
// 'home' | 'away' | null, AND NULL IS A REAL ANSWER, not a failure: soccer
// has no possession to mark, a game that is not live has nobody on offense,
// a game between drives has no down-bearing snap, and a ball that is not in
// play belongs to nobody. Nothing below guesses.

import { shortOf } from '../live/vocabulary.js';

/** The two codes that have a team in possession at all. */
const FOOTBALL = new Set(['nfl', 'cfb']);

export function isFootball(leagueSlug) {
  return FOOTBALL.has(String(leagueSlug ?? '').trim().toLowerCase());
}

/**
 * IS THE BALL IN SOMEONE'S HANDS RIGHT NOW?
 *
 * The last down-bearing snap survives the whistle, so the situation line
 * keeps saying "2nd & 6 · ALA 41" through halftime and through the break
 * between quarters - honestly, because that IS where the ball will be spotted.
 * The dot cannot ride along: it says a team HAS the ball, and at 0:00 of a
 * quarter nobody does. This is the one place that decides it.
 *
 * NO liveState IS NOT A STOPPAGE. A caller that does not hold the clock (a
 * simulated replay, which deliberately withholds it so the cut is not read
 * as the game as it stands now) gets the dot on the strength of the snap it
 * does hold, exactly as gamecastState() reads it.
 */
export function ballInPlay(liveState) {
  if (liveState == null) return true;
  // HALFTIME THROUGH THE SAME DERIVATION EVERY OTHER SURFACE READS.
  // shortOf() maps period 2 with a zeroed clock to 'HT'; the two shapes
  // beneath it are the ones gamecastState() also checks, kept in step
  // rather than reinvented.
  const short = shortOf(liveState) ?? '';
  if (short === 'HT' || short === 'HALFTIME') return false;
  if (/^half/i.test(String(liveState.periodLabel ?? ''))) return false;
  const clock = liveState.clock == null ? '' : String(liveState.clock).trim();
  if (/^half$/i.test(clock)) return false;
  // BETWEEN QUARTERS. A zeroed clock in any period is a break in play, and
  // it is the only signal either provider gives for one.
  if (/^0{1,2}:00$/.test(clock)) return false;
  return true;
}

const norm = (v) => String(v ?? '').trim().toUpperCase();

/**
 * THE READER. Which side is on offense, by the abbreviation each surface
 * actually prints.
 *
 * MATCHING ON THE PRINTED ABBREVIATION IS THE POINT, not a shortcut around a
 * team id. The dot has to land on the row the reader is looking at, and the
 * row is labelled with that string; a side resolved any other way could dot a
 * row whose abbreviation says something else. Where a team has no
 * abbreviation at all - 105 of 243 CFB teams - there is no match and no dot,
 * which is the same honest gap the spot label already has.
 *
 * THE LIVE GATE IS HERE, NOT AT THE CALL SITES. The dot belongs to a game
 * being played: a final's last drive still has an offense and its row would
 * wear the mark for good, which is the failure that never looks like one.
 * Both surfaces already know the same word for it - the board's cardVariant()
 * is g.status === 'live', and a game page replaying a cut passes the 'live'
 * it hands gamecastState() - so the gate is one comparison, made once.
 *
 * @param leagueSlug the game's league; anything but football answers null
 * @param status     the game's status; anything but 'live' answers null
 * @param possession the abbreviation of the team on offense
 * @param homeAbbr   the home row's abbreviation, as printed
 * @param awayAbbr   the away row's abbreviation, as printed
 * @param liveState  the clock, so a stoppage can withhold the dot
 */
export function possessionSide({
  leagueSlug = null, status = null, possession = null,
  homeAbbr = null, awayAbbr = null, liveState = null,
} = {}) {
  if (!isFootball(leagueSlug)) return null;
  if (String(status ?? '') !== 'live') return null;
  const ball = norm(possession);
  if (!ball) return null;
  if (!ballInPlay(liveState)) return null;
  const matchesHome = ball === norm(homeAbbr) && ball !== '';
  const matchesAway = ball === norm(awayAbbr) && ball !== '';
  // NEITHER, OR BOTH, IS NO ANSWER. Both can only happen when the two rows
  // carry the same string, and a dot on both rows is worse than none.
  if (matchesHome === matchesAway) return null;
  return matchesHome ? 'home' : 'away';
}
