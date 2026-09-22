// lib/push/liveActivityState.js - the six fields, and the ONE place that
// builds them.
//
// SPLIT OUT OF liveActivity.js, which imports node:http2. The web side now
// needs the same six for the bridge message the shell sends to the native
// side, and a client bundle cannot carry an HTTP/2 client. Same reason
// lib/push/sheetRules.js exists apart from the sheet: the rule has to be
// reachable from both sides and testable from neither.
//
// THE CONTRACT (LIVE ACTIVITY TOKENS AND UPDATES):
//   { awayAbbr, awayScore, homeAbbr, homeScore, period, clock,
//     possession, situation, lastPlay, kickoffAt }
// Exactly these, no more, until both sides agree an eleventh.
//
// THE SECOND THREE ARE THE LIVE LINE (LIVE ACTIVITY - THE LIVE LINE relay).
// A card carrying only a score and a clock says the same thing for four
// minutes of a goal-line stand; possession, the down and the last play are
// what a reader is actually watching. They are STRINGS for the same reason
// period and clock are - the widget prints them and derives nothing.
//
// THEY COME FROM THE READERS THE GAME PAGE USES, not from a second opinion:
// lastLivePlay() for the snap that sets possession and the situation,
// lastActionPlay() for the words, downDistanceLabel() and spotLabel() for the
// line itself. A card that disagreed with the gamecast under it would be
// worse than a card with no line at all.

import { shortOf, sportOf, BASEBALL, hasClock } from '../live/vocabulary.js';
import { situationLine, newestScoringPlay } from '../mlb/strip.js';
import { abbrOf } from '../live/teamAbbr.js';
import {
  lastLivePlay, lastActionPlay, downDistanceLabel, spotLabel,
} from '../gridiron/driveStrip.js';

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const str = (v) => (v == null ? '' : String(v));
/**
 * AN ISO INSTANT OR NOTHING. kickoff_at arrives as a Date from the driver and
 * as a string from a page that already serialised it; the widget wants one
 * shape it can parse, and an unparseable string there is worse than an absent
 * one - it would print a date that is not a date. Anything that is not a real
 * instant becomes '', which native 1.3 reads as "no kickoff known" and falls
 * back to "Pre-game".
 */
const iso = (v) => {
  if (v == null || v === '') return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

/**
 * The six, and only the six. Reads its named fields off whatever it is handed
 * and drops the rest, so "no more" holds by construction rather than by
 * everyone remembering.
 *
 * Scores are integers: the widget decodes them into Int, and a string there is
 * a decode failure, which on a Live Activity looks like a card that quietly
 * stopped moving - the hardest failure to see from the server. period and
 * clock stay strings exactly as the poller has them ("Q3", "7:28").
 */
export function contentState(s = {}) {
  return {
    awayAbbr: str(s.awayAbbr),
    awayScore: int(s.awayScore),
    homeAbbr: str(s.homeAbbr),
    homeScore: int(s.homeScore),
    period: str(s.period),
    clock: str(s.clock),
    // THE LIVE LINE. Empty strings, never null: the widget's fields cannot
    // hold "nothing", and a game with no play feed is a game whose line is
    // blank rather than a decode failure.
    possession: str(s.possession),
    situation: str(s.situation),
    lastPlay: str(s.lastPlay),
    // THE TENTH, AND THE ONLY OPTIONAL ONE BY AGREEMENT. Native 1.3 (2) reads
    // it for the PRE-KICK state - "Sat 9:00 AM" where it would otherwise say
    // "Pre-game" - so absent is fine and present is better. It is also the
    // only field on the card that does not change once the game starts.
    kickoffAt: iso(s.kickoffAt),
  };
}

/**
 * THE LIVE LINE, from the plays the game page already reads.
 *
 * TWO PLAYS, NOT ONE, and they are different questions. lastLivePlay() is the
 * SNAP - it skips the timeouts and the two-minute warning, which BDL files
 * with a down and a zeroed yard line, so reading them as a snap puts
 * "4th & G at the goal line" on a lock screen for a game sitting at midfield
 * (served that way on 9 Sep). lastActionPlay() is the WORDS - the last row
 * that actually said something, stoppages skipped for the same reason.
 *
 * POSSESSION IS THE OFFENSE'S ABBREVIATION, not a side name: it is what the
 * strip's own headline shows, and three letters is what fits.
 *
 * NOTHING IS GUESSED. No plays, or a play with no down, gives empty strings -
 * the same honest gap gamecastState() calls 'between'.
 *
 * @param plays      playsFor()'s rows, oldest first
 * @param homeTeamId to decide which side is on offense
 * @param teamAbbr   Map(teamId -> abbreviation)
 */
export function liveLine({ plays = [], homeTeamId = null, teamAbbr = new Map() } = {}) {
  const snap = lastLivePlay(plays);
  const words = lastActionPlay(plays);
  if (!snap && !words) return { possession: '', situation: '', lastPlay: '' };

  const offenseId = snap?.offenseTeamId ?? null;
  const possession = offenseId == null ? '' : (teamAbbr.get(offenseId) ?? '');
  const defenseId = offenseId == null || homeTeamId == null
    ? null
    : (Number(offenseId) === Number(homeTeamId) ? null : Number(homeTeamId));
  // The defence's abbreviation is only needed for a spot on ITS half of the
  // field; spotLabel handles the rest.
  const defenseAbbr = defenseId == null
    ? [...teamAbbr.entries()].find(([id]) => Number(id) !== Number(offenseId))?.[1] ?? ''
    : (teamAbbr.get(defenseId) ?? '');

  const dd = snap ? downDistanceLabel(snap.down, snap.distance, snap.yardsToGoal) : null;
  const spot = snap ? spotLabel(snap.yardsToGoal, possession, defenseAbbr) : null;
  return {
    possession,
    situation: [dd, spot].filter(Boolean).join(' · '),
    lastPlay: str(words?.text ?? ''),
  };
}

/**
 * A GAME -> ITS CONTENT STATE. One source for the push path and the bridge
 * path, which is the whole point: a card that says one thing when the phone is
 * locked and another when the app is open is worse than no card.
 *
 * THE INPUT IS getGamePage()'s SHAPE (lib/gridiron/gameDetail.js) - nested
 * home/away with abbreviation, camelCase scores, liveState carrying period and
 * clock. That is the shape the game page already holds, so the page passes what
 * it has; callers holding a raw poll row alias their columns into this shape
 * rather than building the six a second way.
 *
 * A SCHEDULED GAME IS ZEROES AND EMPTY STRINGS, not null: there is no honest
 * scoreline before kickoff, and the widget's Int fields cannot hold "nothing".
 * Starting an Activity on a scheduled game is a debug affordance, not a
 * product one.
 *
 * THE PERIOD IS A LABEL, NOT THE STORED NUMBER. live_state.period is an
 * INTEGER in this database - 1..4 and 5 for OT (lib/live/vocabulary.js's
 * liveState() coerces it) - and the contract's period is a string the widget
 * prints: "Q3". Passing the raw column through puts a bare "2" on the lock
 * screen, which is the kind of wrong that reads as a bug in the app. shortOf()
 * is the ONE derivation every other display already reads through, halftime
 * included ('HT' for period 2 with a zeroed clock), so the card says exactly
 * what the scoreboard says.
 */
/**
 * THE SAME TEN FIELDS, FILLED FOR BASEBALL. No eleventh, no rename, and no iOS
 * change: the widget prints these strings and derives nothing, so a sport is a
 * different set of strings in the same slots.
 *
 *   period      "Top 7th"            - shortOf, which already speaks baseball
 *   clock       ""                   - there is none, and "0:00" would be a lie
 *   possession  the BATTING side     - "who has the ball" is "who is batting"
 *   situation   "2 out · 3-2 · runners 1st, 3rd"   - the card's own line
 *   lastPlay    the newest scoring play
 *
 * POSSESSION IS THE BATTING SIDE and that is not a stretch: the field means
 * "whose turn it is to score", which in the top of an inning is the away team
 * and in the bottom the home team. Between halves nobody is batting, and the
 * field goes empty rather than naming the side that just finished.
 */
export function baseballLine(game) {
  const ls = game?.liveState ?? null;
  if (!ls) return { possession: '', situation: '', lastPlay: '' };
  const half = String(ls.half ?? '');
  const batting = half === 'Top' ? 'away' : half === 'Bottom' ? 'home' : null;
  const side = batting === 'away' ? game?.away : batting === 'home' ? game?.home : null;
  // THE SITUATION LINE WITHOUT ITS FIRST PART. situationLine() leads with
  // "Top 7th", which the card wants and the Activity does not - `period`
  // already carries it, and saying it twice on a lock screen wastes the only
  // line the widget has.
  const full = situationLine(ls) ?? '';
  const situation = full.split(' · ').slice(1).join(' · ');
  return {
    possession: side ? (side.abbreviation ?? '') : '',
    // BASES EMPTY IS A STATEMENT AND IS KEPT; unknown bases simply contribute
    // nothing, which is why this is the line's own words and not a rebuild.
    situation,
    lastPlay: str(newestScoringPlay(game?.scoringPlays ?? [])?.text ?? ''),
  };
}

export function stateFromMatch(game, line = null) {
  const sport = sportOf(game?.leagueSlug);
  if (sport === BASEBALL) {
    return contentState({
      awayAbbr: abbrOf(game?.away ?? {}),
      awayScore: game?.awayScore,
      homeAbbr: abbrOf(game?.home ?? {}),
      homeScore: game?.homeScore,
      period: shortOf(game?.liveState, BASEBALL),
      // EMPTY, NOT THE PROVIDER'S ZERO. hasClock() is the one place that says
      // this sport has no clock, and the widget's field cannot hold "nothing"
      // - so it holds the empty string the contract already allows.
      clock: hasClock(sport) ? game?.liveState?.clock : '',
      kickoffAt: game?.kickoffAt ?? game?.kickoff_at ?? null,
      ...(line ?? baseballLine(game)),
    });
  }
  return contentState({
    // THROUGH THE ONE RULE, NOT THE RAW COLUMN. 105 of 243 CFB teams have no
    // `abbreviation` (lib/live/teamAbbr.js, written for exactly this), and
    // this was the last surface still reading the column directly: Portland
    // State at Oregon, kicking 7:30 PM PT, built a card reading " 0, ORE 0"
    // with an empty away side. Every other surface - the Scores tab, Today,
    // the Wire headline, the push payload - has resolved through abbrOf since
    // that defect closed.
    awayAbbr: abbrOf(game?.away ?? {}),
    awayScore: game?.awayScore,
    homeAbbr: abbrOf(game?.home ?? {}),
    homeScore: game?.homeScore,
    period: shortOf(game?.liveState),
    clock: game?.liveState?.clock,
    kickoffAt: game?.kickoffAt ?? game?.kickoff_at ?? null,
    // THE LINE IS OPTIONAL, AND ITS ABSENCE IS NOT A BUG. Every caller that
    // holds plays passes them; the ones that do not - the Alerts sheet
    // starting an Activity from a page that has the game but not the feed -
    // get three empty strings rather than a second, thinner reader invented
    // here to fill them.
    ...(line ?? {}),
  });
}

/**
 * THE DEEP LINK the Activity carries in its static attributes. Absolute, as
 * the contract amendment requires - it crosses the bridge as a whole URL, not
 * as an id the native side has to resolve.
 *
 * The league slug comes from the game rather than being hard-coded 'nfl':
 * app/cfb/game/[slug] is a real route, and an Activity for a CFB game pointed
 * at /nfl/game/<cfb-slug> would open a 404. For an NFL game this produces
 * exactly the contract's https://sportsvyn.com/nfl/game/<slug>.
 */
export const SITE_ORIGIN = 'https://sportsvyn.com';

export function gameUrlFor(game) {
  if (!game?.slug || !game?.leagueSlug) return null;
  return `${SITE_ORIGIN}/${game.leagueSlug}/game/${game.slug}`;
}
