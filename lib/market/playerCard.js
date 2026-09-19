// lib/market/playerCard.js - one player, one game, every prop priced on him.
//
// THE CARD IS THE INDEX'S ROW, OPENED. It reads through propsBoard() rather
// than a query of its own: the board already links a vendor label to our
// players.id, computes the hit rate over the games we hold, and refuses a hit
// rate on the markets where our logs cannot answer (first/last scorer). A
// second reader here would be a second opinion about all three.
//
// THE HARD LINE. This returns prices, our own game logs, and the distance
// between them. It returns no position, no recommendation and no stance -
// there is no such store in this codebase and this relay does not add one.

import { sql } from '../db.js';
import { propsBoard, cardSeries } from './propsBoard.js';
import { loadLogs, lineFor } from './propStats.js';
import { seasonStats } from '../weekly/seasonLine.js';
import { resolveSeasonYear } from '../pollers/seasonResolver.js';

/**
 * @param slug    players.slug
 * @param matchId the game whose prices to show
 * @returns null when the player or the game is unknown, or when nothing on
 *          this player is priced for this game - a card with no props is a
 *          page about nothing, and the caller 404s rather than drawing it.
 */
export async function playerPropCard(slug, matchId) {
  const [player] = await sql`
    SELECT p.id, p.slug, p.full_name, p.position, p.current_team_id,
           t.abbreviation AS team_abbr, t.name AS team_name
      FROM players p LEFT JOIN teams t ON t.id = p.current_team_id
     WHERE p.slug = ${slug}`;
  if (!player) return null;

  const [game] = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.season_year, m.week,
           l.slug AS league_slug,
           h.abbreviation AS home_abbr, h.name AS home_name,
           a.abbreviation AS away_abbr, a.name AS away_name
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.id = ${Number(matchId)}`;
  if (!game) return null;

  // ONE GAME'S BOARD, then this player's rows off it. `game` is a first-class
  // filter on propsBoard - "the whole sheet for that match" - so this is the
  // cheapest way in, and the hit rates come back already computed.
  const board = await propsBoard({ league: game.league_slug, game: game.id, limit: 500 });
  const mine = board.rows.filter((r) => r.playerId === player.id);
  if (!mine.length) return null;

  // THE SEASON LINE, AND NOT A DEPTH CHART. "RB1" does not exist anywhere in
  // this codebase - nothing stores a positional rank within a team - so the
  // line is the position we hold plus the games and the ppg the Weekly and the
  // Draft room already print, through the one scorer.
  // The player's logs, once, for every row's chart.
  const logs = (await loadLogs({ [game.league_slug]: [player.id] }).catch(() => new Map()))
    .get(player.id) ?? null;

  let line = null;
  try {
    const stats = await seasonStats(game.season_year ?? resolveSeasonYear(new Date()));
    const s = stats.get(player.id) ?? null;
    if (s?.gp) line = { gp: s.gp, ppg: s.ppg };
  } catch { line = null; }

  return {
    player: {
      id: player.id, slug: player.slug, name: player.full_name,
      position: player.position ?? null,
      teamAbbr: [game.home_abbr, game.away_abbr].includes(player.team_abbr) ? player.team_abbr : null,
      seasonLine: line,
    },
    game: {
      id: game.id, slug: game.slug, leagueSlug: game.league_slug, status: game.status,
      kickoffAt: game.kickoff_at,
      home: { abbr: game.home_abbr, name: game.home_name },
      away: { abbr: game.away_abbr, name: game.away_name },
    },
    // Each row keeps everything the index row had, plus the five-bar series
    // built for THIS surface: crossing a season when it must, DNPs intact.
    // ONE loadLogs FOR THE WHOLE CARD - every row here is the same player, so
    // asking per row would be six queries for one answer.
    props: mine.map((r) => ({
      ...r,
      // THE MARKET'S OWN LINE WHERE THE ROW HAS NONE. An anytime-TD row
      // carries selection_value NULL - the market IS the line - and lineFor()
      // resolves that to 0.5, the same threshold hitRate() already measured
      // it against. Passing r.line raw would have left every TD row chartless
      // while its hit rate said 0 of 2, which reads as a bug in the chart.
      series: logs ? cardSeries(logs, r.marketType, lineFor(r.marketType, r.line)) : null,
    })),
  };
}
