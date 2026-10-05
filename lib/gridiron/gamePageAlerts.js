// lib/gridiron/gamePageAlerts.js - the bell and the Live Activity start on the
// arcade game page (thu-41). PURE.
//
// THE REBUILD DROPPED THEM. The pre-arcade /nfl/game and /cfb/game headers
// mounted AlertBell (follow -> game alerts) with the Live Activity row riding
// its sheet; the arcade page (components/gridiron/GamePageArcade.js) drew the
// shared CardFace and nothing else, so PIT@CLE pre-game had neither. This builds
// the same two inputs the dark pages build - the match the sheet reads and the
// Activity's url/state/final from lib/push/liveActivityState.js - so the
// arcade card's top row can mount the SAME bell with the same actions.
//
// THE GATES. The bell: the leagues the arcade page serves with game alerts
// (NFL, CFB, MLB). NBA gets neither the bell nor the Activity on this page
// (thu-41); the Activity additionally passes liveActivitySupported() (thu-18),
// the one rule the register route and the poller rider also ask.
import { stateFromMatch, gameUrlFor, liveActivitySupported } from '../push/liveActivityState.js';

export const ARCADE_BELL_LEAGUES = Object.freeze(['nfl', 'cfb', 'mlb']);

export function gamePageAlerts(game, { signedIn = false } = {}) {
  if (!game || !ARCADE_BELL_LEAGUES.includes(game.leagueSlug)) return null;
  return {
    signedIn: Boolean(signedIn),
    match: {
      id: game.id, slug: game.slug, leagueSlug: game.leagueSlug,
      homeAbbr: game.home?.abbreviation ?? '', awayAbbr: game.away?.abbreviation ?? '',
      homeTeamId: game.home?.id ?? null, homeSlug: game.home?.slug ?? null,
      kickoffAt: game.kickoffAt,
    },
    liveActivity: liveActivitySupported(game.leagueSlug)
      ? { url: gameUrlFor(game), state: stateFromMatch(game), final: game.status === 'final', live: game.status === 'live' }
      : null,
  };
}
