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
//   { awayAbbr, awayScore, homeAbbr, homeScore, period, clock }
// Exactly these, no more, until both sides agree a seventh.

import { shortOf } from '../live/vocabulary.js';

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const str = (v) => (v == null ? '' : String(v));

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
export function stateFromMatch(game) {
  return contentState({
    awayAbbr: game?.away?.abbreviation,
    awayScore: game?.awayScore,
    homeAbbr: game?.home?.abbreviation,
    homeScore: game?.homeScore,
    period: shortOf(game?.liveState),
    clock: game?.liveState?.clock,
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
