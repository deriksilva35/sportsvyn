// lib/scores/expandRead.js - what /api/scores/expand/[league]/[slug] reads.
//
// THE GAME PAGES' OWN READERS, nothing new (ruling e): getGamePage + the
// gamecast's playsFor for NFL and CFB (app/nfl/game/[slug]), getMlbGame +
// getMlbPlays for MLB (app/mlb/game/[slug]). Shaped by lib/scores/expand.js.
import { getGamePage } from '../gridiron/gameDetail.js';
import { gamecastFor } from '../gridiron/playsImport.js';
import { getMlbGame, getMlbPlays } from '../mlb/gameDetail.js';
import { getNbaGame, nbaPlays } from '../nba/gameDetail.js';
import { lineFor, gridironScoring, gridironLast, mlbScoring, mlbLast, nbaLast } from './expand.js';

export const EXPAND_LEAGUES = Object.freeze(['nfl', 'cfb', 'mlb', 'nba']);

/** The payload, or null when the league or the slug does not resolve. */
export async function readExpand(league, slug) {
  if (!EXPAND_LEAGUES.includes(league) || !slug) return null;
  if (league === 'nba') {
    const g = await getNbaGame(slug);
    if (!g) return null;
    const feed = await nbaPlays(g.id).catch(() => ({ latest: [] }));
    const abbrOf = (id) => (id === g.home?.id ? g.home?.abbreviation : id === g.away?.id ? g.away?.abbreviation : null);
    // NO KEY MOMENTS FOR BASKETBALL: every basket is a scoring play, so the
    // football list would be the whole game. scoring: null tells the drawer to
    // draw no such section (components/scores/ExpandCard.js), not "No scoring yet".
    return { league, slug, status: g.status, line: lineFor(g), scoring: null, last: nbaLast(feed.latest, abbrOf) };
  }
  if (league === 'mlb') {
    const g = await getMlbGame(slug);
    if (!g) return null;
    const box = [...(g.box?.hitters ?? []), ...(g.box?.pitchers ?? [])];
    const halves = await getMlbPlays(g.id, box).catch(() => []);
    return {
      league, slug, status: g.status,
      line: lineFor({ ...g, leagueSlug: 'mlb' }, { mlbGrid: g.lineScore }),
      scoring: mlbScoring(g.scoringPlays),
      last: mlbLast(halves),
    };
  }
  const game = await getGamePage(slug);
  if (!game || game.leagueSlug !== league) return null;
  const gc = await gamecastFor(game.id).catch(() => null);
  const plays = gc?.plays ?? [];
  return {
    league, slug, status: game.status,
    line: lineFor(game),
    scoring: gridironScoring({ plays, game, teamAbbr: gc?.teamAbbr ?? new Map() }),
    last: gridironLast(plays),
  };
}
